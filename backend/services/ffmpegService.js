const { execFile, spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const config = require('../config');
const Logger = require('../utils/logger');
const logger = Logger.getInstance('FFmpeg-Service');
const { v4: uuidv4 } = require('uuid');

// ============================================================================
// CONSTANTS
// ============================================================================

// Multi-pass rendering progress distribution
const PROGRESS_WEIGHTS = {
  BASE_VIDEO: 0.4,    // Pass 1: 0-40%
  TEXT_OVERLAY: 0.3,  // Pass 2: 40-70%
  COMPOSITE: 0.3      // Pass 3: 70-100%
};

// Text processing batch size to avoid very long filter strings
const TEXT_BATCH_SIZE = 10;

// FFmpeg encoding defaults
const ENCODING_DEFAULTS = {
  codec: 'libx264',
  preset: 'veryfast', // faster export, minimal quality difference
  crf: '23',
  pixelFormat: 'yuv420p',
  pixelFormatAlpha: 'yuva420p',
  audioCodec: 'aac',
  audioBitrate: '128k'
};

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Calculate relative timing for a clip within the render window
 * @param {Object} clip - Clip with timelinePosition and timelineDuration
 * @param {number} inPoint - Render start time
 * @param {number} duration - Total render duration
 * @returns {Object} { relStart, relEnd, clipDuration, isWithinRange }
 */
function calculateClipTiming(clip, inPoint, duration) {
  const relStart = Math.max(0, clip.timelinePosition - inPoint);
  const relEnd = Math.min(duration, clip.timelinePosition + clip.timelineDuration - inPoint);
  const clipDuration = relEnd - relStart;
  const isWithinRange = clipDuration > 0 && relEnd > relStart;
  
  return { relStart, relEnd, clipDuration, isWithinRange };
}

/**
 * Build FFmpeg scale and pad filter to fit content into canvas
 * @param {number} W - Canvas width
 * @param {number} H - Canvas height
 * @param {boolean} withAlpha - Include alpha channel formatting
 * @returns {string} FFmpeg filter string
 */
function buildScalePadFilter(W, H, withAlpha = false) {
  const alphaFormat = withAlpha ? ',format=rgba' : '';
  return `scale=${W}:${H}:force_original_aspect_ratio=decrease,pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2${alphaFormat}`;
}

/**
 * Log filter_complex graph as plain INFO lines (no JSON payload)
 * @param {string} stepName - Rendering step name
 * @param {string} filterComplex - Full filter_complex string
 */
function logFilterComplexStructure(stepName, filterComplex) {
  if (!filterComplex) return;
  logger.info(`${stepName}: filter_complex structure start`);
  filterComplex
    .split(';')
    .map(line => line.trim())
    .filter(Boolean)
    .forEach(line => logger.info(`${line};`));
  logger.info(`${stepName}: filter_complex structure end`);
}

/**
 * Convert a filesystem path into a drawtext-compatible textfile value
 * @param {string} filePath
 * @returns {string}
 */
function toFfmpegFilterPath(filePath) {
  return path.resolve(filePath).replace(/\\/g, '/').replace(/'/g, "\\'");
}

// ============================================================================
// MAIN RENDER ENTRY POINT
// ============================================================================

/**
 * Main render function - orchestrates multi-pass video rendering
 * 
 * ARCHITECTURE:
 * - Collects and categorizes all clips from timeline tracks
 * - Respects track visibility (invisible tracks are skipped)
 * - Respects track mute status (muted tracks don't contribute audio)
 * - Routes to multi-pass renderer for all scenarios
 * 
 * @param {Object} project - Project data with tracks, resolution, fps
 * @param {number} inPoint - Render start time (seconds)
 * @param {number} outPoint - Render end time (seconds)
 * @param {string} outputPath - Output file path
 * @param {string} outputFormat - Output format (e.g., 'mp4')
 * @param {Function} onProgress - Progress callback (0-100)
 * @returns {Promise<void>}
 */
async function render({ project, inPoint, outPoint, outputPath, outputFormat, onProgress }) {
  const { tracks = [], resolution = { width: 1920, height: 1080 }, fps = 30 } = project;

  // -------------------------------------------------------------------------
  // PHASE 1: Collect and categorize clips from all tracks
  // -------------------------------------------------------------------------
  
  const allClips = [];
  
  tracks.forEach(track => {
    logger.debug('Processing track', { 
      trackType: track.type, 
      trackNumber: track.trackNumber,
      trackName: track.name,
      clipCount: (track.clips || []).length,
      visible: track.visible,
      muted: track.muted
    });
    
    // Skip invisible video/caption tracks entirely (don't render at all)
    if (track.visible === false && (track.type === 'video' || track.type === 'caption')) {
      logger.debug('Skipping invisible video/caption track', { trackName: track.name, trackType: track.type });
      return;
    }
    
    // Add each clip with metadata about its track
    (track.clips || []).forEach(clip => {
      const clipData = { 
        ...clip, 
        trackNumber: track.trackNumber, 
        trackType: track.type,
        trackVisible: track.visible !== false,
        trackMuted: track.muted === true  // Used to exclude audio from muted tracks
      };
      
      allClips.push(clipData);
      
      logger.debug('Added clip to processing', {
        clipType: clip.type,
        trackType: track.type,
        file: clip.filePath ? path.basename(clip.filePath) : clip.text ? `text: ${clip.text.substring(0, 20)}...` : 'N/A',
        timelinePosition: clip.timelinePosition,
        duration: clip.timelineDuration,
        trackVisible: clipData.trackVisible,
        trackMuted: clipData.trackMuted
      });
    });
  });

  logger.debug('All clips collected', { 
    totalClips: allClips.length,
    trackCount: tracks.length
  });

  // -------------------------------------------------------------------------
  // PHASE 2: Separate clips by type and sort by track layer
  // Lower track numbers render as bottom layers
  // -------------------------------------------------------------------------
  
  const videoClips = allClips
    .filter(c => c.type === 'video')
    .sort((a, b) => a.trackNumber - b.trackNumber);
  
  // Audio: exclude clips from muted tracks.
  // Include audio clips always, and include video clip audio unless explicitly muted (volume === 0).
  // This prevents accidental audio loss when legacy clips omit the volume property.
  const audioClips = allClips
    .filter(c => !c.trackMuted && (c.type === 'audio' || (c.type === 'video' && (c.volume === undefined || c.volume > 0))))
    .sort((a, b) => a.trackNumber - b.trackNumber);
  
  const imageClips = allClips
    .filter(c => c.type === 'image')
    .sort((a, b) => a.trackNumber - b.trackNumber);
  
  const textClips = allClips
    .filter(c => c.type === 'text')
    .sort((a, b) => a.trackNumber - b.trackNumber);

  logger.debug('Clips separated by type', {
    videoClips: videoClips.length,
    audioClips: audioClips.length,
    imageClips: imageClips.length,
    textClips: textClips.length,
    videoClipFiles: videoClips.map(c => path.basename(c.filePath || '')),
    audioClipSources: audioClips.map(c => ({
      type: c.type,
      file: path.basename(c.filePath || ''),
      trackNumber: c.trackNumber,
      volume: c.volume,
      timelinePosition: c.timelinePosition,
      timelineDuration: c.timelineDuration
    })),
    textClipTexts: textClips.map(c => c.text ? c.text.substring(0, 30) : 'N/A')
  });

  // -------------------------------------------------------------------------
  // PHASE 3: Calculate render window and setup rendering parameters
  // -------------------------------------------------------------------------
  
  const duration = outPoint - inPoint;
  const W = resolution.width;
  const H = resolution.height;

  logger.info('Render job started', {
    duration,
    videoClips: videoClips.length,
    audioClips: audioClips.length,
    imageClips: imageClips.length,
    textClips: textClips.length,
    tracks: tracks.length,
    inPoint,
    outPoint
  });

  // -------------------------------------------------------------------------
  // PHASE 4: Route to multi-pass renderer
  // All rendering now uses the 3-pass approach for consistency
  // -------------------------------------------------------------------------
  
  logger.info('Using multi-pass rendering', { 
    videoClips: videoClips.length,
    textClips: textClips.length,
    audioClips: audioClips.length
  });
  
  logger.debug('Multi-pass input arrays', {
    videoClips: videoClips.length,
    videoClipFiles: videoClips.map(c => ({ 
      file: path.basename(c.filePath || ''),
      pos: c.timelinePosition,
      dur: c.timelineDuration
    })),
    imageClips: imageClips.length,
    audioClips: audioClips.length,
    textClips: textClips.length,
    inPoint,
    outPoint,
    duration
  });
  
  return renderMultiPass({ 
    project, inPoint, outPoint, outputPath, outputFormat, onProgress,
    videoClips, audioClips, imageClips, textClips, duration, W, H, fps 
  });
}

// ============================================================================
// MULTI-PASS RENDERING ORCHESTRATOR
// ============================================================================

/**
 * Multi-pass rendering - separates rendering into 3 isolated passes
 * 
 * WHY MULTI-PASS?
 * - Avoids massive filter_complex strings that hit Windows command-line limits
 * - Allows independent processing of different content types
 * - Provides better progress tracking and debugging
 * - More reliable than single-pass with hundreds of text captions
 * 
 * PASSES:
 * 1. BASE VIDEO (0-40%): Render video/image clips on black canvas → base_*.mp4
 * 2. TEXT OVERLAY (40-70%): Render text clips on transparent canvas → text_*.mov (PNG/RGBA)
 * 3. COMPOSITE (70-100%): Overlay text on base, add audio → final output
 * 
 * @param {Object} params - Render parameters
 * @returns {Promise<void>}
 */
async function renderMultiPass({ project, inPoint, outPoint, outputPath, outputFormat, onProgress,
  videoClips, audioClips, imageClips, textClips, duration, W, H, fps }) {
  
  // Setup temp directory for intermediate files
  const tempDir = config.cachePath || path.join(__dirname, '../TMP/cache');
  if (!fs.existsSync(tempDir)) {
    fs.mkdirSync(tempDir, { recursive: true });
  }

  const baseVideoPath = path.join(tempDir, `base_${uuidv4()}.mp4`);
  const textOverlayPath = path.join(tempDir, `text_${uuidv4()}.mov`);  // MOV container for PNG codec with alpha
  const hasTextClips = textClips.length > 0;
  let textFiles = [];

  logger.debug('Multi-pass render initialized', {
    tempDir,
    baseVideoPath,
    textOverlayPath,
    passes: 3
  });

  try {
    // -----------------------------------------------------------------------
    // PASS 1: Render base video (video + image clips)
    // -----------------------------------------------------------------------
    logger.info('Pass 1/3: Rendering base video', { videoClips: videoClips.length, imageClips: imageClips.length });
    logger.debug('Pass 1: Starting base video render', { duration, resolution: `${W}x${H}`, fps });
    
    await renderBaseVideo({ 
      videoClips, 
      imageClips, 
      inPoint, 
      duration, 
      W, 
      H, 
      fps, 
      outputPath: baseVideoPath,
      onProgress: (pct) => onProgress && onProgress(Math.floor(pct * PROGRESS_WEIGHTS.BASE_VIDEO))
    });
    
    logger.debug('Pass 1: Base video completed', { 
      outputPath: baseVideoPath, 
      exists: fs.existsSync(baseVideoPath),
      size: fs.existsSync(baseVideoPath) ? fs.statSync(baseVideoPath).size : 0
    });

    // -----------------------------------------------------------------------
    // PASS 2: Render text overlay (transparent background) - only if needed
    // -----------------------------------------------------------------------
    if (hasTextClips) {
      logger.info('Pass 2/3: Rendering text captions', { textClips: textClips.length });
      logger.debug('Pass 2: Starting text overlay render', { textClips: textClips.length });
      
      const result = await renderTextOverlay({
        textClips, 
        inPoint, 
        duration, 
        W, 
        H, 
        fps, 
        outputPath: textOverlayPath,
        onProgress: (pct) => onProgress && onProgress(40 + Math.floor(pct * PROGRESS_WEIGHTS.TEXT_OVERLAY))
      });
      
      textFiles = result.createdTextFiles;
      
      logger.debug('Pass 2: Text overlay completed', { 
        outputPath: textOverlayPath,
        exists: fs.existsSync(textOverlayPath),
        size: fs.existsSync(textOverlayPath) ? fs.statSync(textOverlayPath).size : 0,
        textFilesCreated: textFiles.length
      });
    } else {
      logger.info('Pass 2/3: Skipped text overlay (no text clips)');
      if (onProgress) onProgress(70);
    }

    // -----------------------------------------------------------------------
    // PASS 3: Composite video + text, add audio
    // -----------------------------------------------------------------------
    logger.info('Pass 3/3: Compositing and adding audio');
    logger.debug('Pass 3: Starting composite', { audioClips: audioClips.length });
    
    await compositeWithAudio({
      baseVideoPath, 
      textOverlayPath: hasTextClips ? textOverlayPath : null,
      audioClips, 
      inPoint, 
      duration, 
      outputPath,
      onProgress: (pct) => onProgress && onProgress(70 + Math.floor(pct * PROGRESS_WEIGHTS.COMPOSITE))
    });
    
    logger.debug('Pass 3: Composite completed', { 
      outputPath,
      exists: fs.existsSync(outputPath),
      size: fs.existsSync(outputPath) ? fs.statSync(outputPath).size : 0
    });

    logger.info('Multi-pass render completed successfully');
    if (onProgress) onProgress(100);

  } finally {
    // Cleanup temporary files after all FFmpeg processes complete
    logger.debug('Cleaning up temporary files', { 
      baseVideoPath, 
      textOverlayPath,
      textFiles
    });
    
    try {
      // Clean up intermediate video files
      if (fs.existsSync(baseVideoPath)) {
        fs.unlinkSync(baseVideoPath);
      }
      if (fs.existsSync(textOverlayPath)) {
        fs.unlinkSync(textOverlayPath);
      }

      // Clean up text files used for drawtext filters
      for (const textFilePath of textFiles) {
        if (fs.existsSync(textFilePath)) {
          fs.unlinkSync(textFilePath);
        }
      }

    } catch (err) {
      logger.warn('Failed to cleanup temp files', { error: err.message });
    }
  }
}

// ============================================================================
// PASS 1: BASE VIDEO RENDERER
// ============================================================================

/**
 * Render base video: processes video and image clips on a black canvas
 * 
 * PROCESS:
 * 1. Creates a black base canvas for the full duration
 * 2. Overlays video clips: trim → scale → pad → overlay at timeline position
 * 3. Overlays image clips: loop → scale → pad → overlay with opacity
 * 4. Chains overlays sequentially (base → v0 → v1 → ... → imgN)
 * 
 * OUTPUT: MP4 file with h264 video, no audio (audio added in pass 3)
 * 
 * @param {Object} params - Rendering parameters
 * @returns {Promise<void>}
 */
async function renderBaseVideo({ videoClips, imageClips, inPoint, duration, W, H, fps, outputPath, onProgress }) {
  logger.debug('renderBaseVideo: Starting', { 
    videoClips: videoClips.length, 
    imageClips: imageClips.length,
    videoClipDetails: videoClips.map(c => ({ 
      file: path.basename(c.filePath), 
      timelinePos: c.timelinePosition,
      duration: c.timelineDuration 
    }))
  });
  
  const inputs = [];           // FFmpeg input files array
  let filterParts = [];        // FFmpeg filter_complex components
  let currentVideo = 'base';   // Track the current video stream label
  let inputIdx = 0;            // Input file index counter

  // Create black canvas as base layer
  // Format: color=c=black:s=WIDTHxHEIGHT:r=FPS:d=DURATION[label]
  filterParts.push(`color=c=black:s=${W}x${H}:r=${fps}:d=${duration}[base]`);
  logger.debug('renderBaseVideo: Created black base', { resolution: `${W}x${H}`, duration, fps });

  // Warn if no content to render (output will be solid black)
  if (videoClips.length === 0 && imageClips.length === 0) {
    logger.warn('renderBaseVideo: No video or image clips to render - output will be black!');
  }

  // -----------------------------------------------------------------------
  // Process video clips
  // -----------------------------------------------------------------------
  for (const clip of videoClips) {
    logger.debug(`renderBaseVideo: Processing video clip`, { 
      file: path.basename(clip.filePath || 'UNKNOWN'),
      timelinePosition: clip.timelinePosition,
      timelineDuration: clip.timelineDuration,
      inPoint,
      duration
    });
    
    // Calculate clip timing relative to render window
    const timing = calculateClipTiming(clip, inPoint, duration);
    
    logger.debug(`renderBaseVideo: Calculated timing`, { 
      relStart: timing.relStart, 
      relEnd: timing.relEnd,
      willSkip: !timing.isWithinRange
    });
    
    // Skip clips that fall completely outside the render window
    if (!timing.isWithinRange) {
      logger.warn(`renderBaseVideo: Skipping clip outside render range`, {
        file: path.basename(clip.filePath),
        timelinePosition: clip.timelinePosition,
        clipEnd: clip.timelinePosition + clip.timelineDuration,
        inPoint,
        duration
      });
      continue;
    }

    // Add video file as input
    inputs.push('-i', clip.filePath);
    const idx = inputIdx++;
    const label = `v${idx}`;
    const overlayLabel = `ov${idx}`;

    // Build filter chain for this clip:
    // 1. Trim to clip's source range and duration within render window
    // 2. Reset PTS (presentation timestamp) to start at 0
    // 3. Scale and pad to fit canvas (maintains aspect ratio, centers content)

    const scalePad = buildScalePadFilter(W, H, false);

    filterParts.push(
      `[${idx}:v]trim=start=${clip.srcStart}:duration=${timing.clipDuration},setpts=PTS-STARTPTS,${scalePad}[${label}]`
    );

    const comma = "\\,";

    // Overlay this clip on current base at its timeline position
    filterParts.push(
      `[${currentVideo}][${label}]overlay=enable=between(t${comma}${timing.relStart}${comma}${timing.relEnd}):x=0:y=0[${overlayLabel}]`
    );
    
    // Update current video stream to the overlay result
    currentVideo = overlayLabel;
    
    logger.debug(`renderBaseVideo: Added video clip ${idx}`, { 
      file: path.basename(clip.filePath),
      relStart: timing.relStart, 
      relEnd: timing.relEnd, 
      clipDuration: timing.clipDuration 
    });
  }

  // -----------------------------------------------------------------------
  // Process image clips
  // -----------------------------------------------------------------------
  for (const clip of imageClips) {
    const timing = calculateClipTiming(clip, inPoint, duration);
    
    if (!timing.isWithinRange) continue;

    // For images: use -loop 1 to repeat the single frame for duration
    inputs.push('-loop', '1', '-t', String(timing.clipDuration), '-i', clip.filePath);
    const idx = inputIdx++;
    const label = `img${idx}`;
    const overlayLabel = `imgov${idx}`;
    const opacity = clip.opacity !== undefined ? clip.opacity : 1;

    // Build filter for image: scale, pad, add alpha channel, apply opacity
    const scalePad = buildScalePadFilter(W, H, true);  // true = include alpha channel
    filterParts.push(
      `[${idx}:v]${scalePad},colorchannelmixer=aa=${opacity}[${label}]`
    );

    const comma = "\\\,";
    
    // Overlay image at its timeline position
    filterParts.push(
      `[${currentVideo}][${label}]overlay=enable=between(t${comma}${timing.relStart}${comma}${timing.relEnd}):x=0:y=0[${overlayLabel}]`
    );
    
    currentVideo = overlayLabel;
    
    logger.debug(`renderBaseVideo: Added image clip ${idx}`, { 
      file: path.basename(clip.filePath),
      relStart: timing.relStart, 
      relEnd: timing.relEnd,
      opacity
    });
  }

  // -----------------------------------------------------------------------
  // Finalize and execute FFmpeg command
  // -----------------------------------------------------------------------
  
  logger.debug('renderBaseVideo: Processing complete', {
    videoClipsProcessed: inputIdx,
    currentVideo,
    isStillBlackBase: currentVideo === 'base',  // If true, no clips were added!
    filterPartsCount: filterParts.length
  });

  // Build complete FFmpeg command
  const filterComplex = filterParts.join(';');
  logFilterComplexStructure('renderBaseVideo', filterComplex);
  const args = [
    '-y',              
    '-threads', '0',
    ...inputs,                      // All input files
    '-filter_complex', filterComplex,  // Complete filter graph
    '-map', `[${currentVideo}]`,    // Map final video stream to output
    '-t', String(duration),         // Output duration
    '-c:v', ENCODING_DEFAULTS.codec,      // Video codec
    '-preset', ENCODING_DEFAULTS.preset,  // Encoding speed
    '-crf', ENCODING_DEFAULTS.crf,        // Quality (lower = better)
    '-pix_fmt', ENCODING_DEFAULTS.pixelFormat,  // Pixel format
    '-movflags','+faststart',             // Overwrite output file
    '-an',                          // No audio in this pass
    outputPath
  ];

  logger.debug('renderBaseVideo: FFmpeg command prepared', { 
    totalInputs: Math.floor(inputs.length / 2), 
    filterPartsCount: filterParts.length,
    filterComplexLength: filterComplex.length,
    finalVideoStream: currentVideo,
    outputPath,
    hasVideoContent: inputIdx > 0,
    WARNING_BLACK_VIDEO: currentVideo === 'base'
  });

  return executeFFmpeg(config.ffmpegPath, args, duration, onProgress, 'renderBaseVideo');
}

// ============================================================================
// PASS 2: TEXT OVERLAY RENDERER
// ============================================================================

/**
 * Render text overlay: processes text clips on a transparent canvas
 * 
 * PROCESS:
 * 1. Creates transparent black canvas with alpha channel (RGBA)
 * 2. If no text clips: creates empty transparent video as pass-through
 * 3. If text clips exist: uses drawtext filter for each clip
 * 4. Processes text in batches to avoid extremely long filter strings
 * 5. Chains drawtext filters: transparent → txt0 → txt1 → ... → txtN
 * 
 * OUTPUT: MOV file with PNG codec and RGBA (full alpha transparency support)
 * 
 * @param {Object} params - Rendering parameters
 * @returns {Promise<Object>} { createdTextFiles: Array<string> }
 */
async function renderTextOverlay({ textClips, inPoint, duration, W, H, fps, outputPath, onProgress }) {
  logger.debug('renderTextOverlay: Starting', { textClips: textClips.length });
  
  // -----------------------------------------------------------------------
  // SPECIAL CASE: No text clips
  // Create empty transparent video that acts as pass-through in composite
  // -----------------------------------------------------------------------
  if (textClips.length === 0) {
    logger.info('renderTextOverlay: No text clips - creating empty transparent overlay');
    
    const args = [
      '-y',
      '-f', 'lavfi',
      '-i', `color=c=black@0.0:s=${W}x${H}:r=${fps}:d=${duration}`,  // @0.0 = fully transparent
      '-c:v', 'png',  // PNG codec properly supports alpha transparency
      '-pix_fmt', 'rgba',  // Use RGBA for PNG
      '-an',  // No audio needed
      outputPath
    ];
    
    logger.debug('renderTextOverlay: FFmpeg command for empty overlay', { 
      resolution: `${W}x${H}`,
      duration,
      fps,
      outputPath
    });
    
    await executeFFmpeg(config.ffmpegPath, args, duration, onProgress, 'renderTextOverlay');
    return { createdTextFiles: [] };
  }
  
  // -----------------------------------------------------------------------
  // NORMAL CASE: Process text clips
  // -----------------------------------------------------------------------
  
  let filterParts = [];
  let currentVideo = 'base';
  let textIdx = 0;
  const textFileDir = path.join(__dirname, '../../TMP/subtitles');
  const createdTextFiles = [];


  if (!fs.existsSync(textFileDir)) {
    fs.mkdirSync(textFileDir, { recursive: true });
  }

  // Create transparent base canvas
  // Format: color=c=black@0.0 (fully transparent black) with RGBA format
  filterParts.push(`color=c=black@0.0:s=${W}x${H}:r=${fps}:d=${duration},format=rgba[base]`);
  logger.debug('renderTextOverlay: Created transparent base', { resolution: `${W}x${H}`, duration, fps });

  // Process text in batches to keep filter strings manageable
  // Large projects with hundreds of captions would create massive filter strings
  const totalBatches = Math.ceil(textClips.length / TEXT_BATCH_SIZE);
  logger.debug('renderTextOverlay: Processing text in batches', { 
    totalBatches, 
    batchSize: TEXT_BATCH_SIZE 
  });
  
  try {
    for (let i = 0; i < textClips.length; i += TEXT_BATCH_SIZE) {
      const batch = textClips.slice(i, i + TEXT_BATCH_SIZE);
      const batchNum = Math.floor(i / TEXT_BATCH_SIZE) + 1;
      
      logger.debug(`renderTextOverlay: Processing batch ${batchNum}/${totalBatches}`, { 
        clipsInBatch: batch.length,
        clipRange: `${i}-${i + batch.length - 1}`
      });
      
      for (const clip of batch) {
        const timing = calculateClipTiming(clip, inPoint, duration);
        
        if (!timing.isWithinRange) continue;

        const textLabel = `txt${textIdx++}`;
        const rawText = clip.text || '';
        const textFilePath = path.join(textFileDir, `text_${uuidv4()}.txt`);


        fs.writeFileSync(textFilePath, rawText, 'utf8');
        createdTextFiles.push(textFilePath);



        // Use relative path for FFmpeg command and escape for filter syntax
        const relativeTextPath = path.relative(process.cwd(), textFilePath).replace(/\\/g, '/').replace(/'/g, "\\'");

        const fontColor = (clip.color || '#ffffff').replace('#', '0x');  // FFmpeg uses 0x prefix
        const fontSize = clip.fontSize || 48;
        
        // Position: default to center if not specified
        const x = clip.x !== undefined ? clip.x : '(w-text_w)/2';
        const y = clip.y !== undefined ? clip.y : '(h-text_h)/2';

        // Build drawtext filter from file path instead of inline text to avoid CLI escaping issues
        const comma = "\\\,";

        const filterPartString = `[${currentVideo}]drawtext=textfile=${relativeTextPath}:fontsize=${fontSize}:fontcolor=${fontColor}:x=${x}:y=${y}:enable=between(t${comma}${timing.relStart}${comma}${timing.relEnd})[${textLabel}]`;

        filterParts.push(
          filterPartString
        );
        
        currentVideo = textLabel;

        logger.debug('renderTextOverlay: Created text temp file', {
          textFilePath,
          relStart: timing.relStart,
          relEnd: timing.relEnd,
          preview: rawText.substring(0, 40)
        });
      }
    }

    logger.debug('renderTextOverlay: All text clips processed', { 
      totalTextClips: textIdx,
      filterPartsCount: filterParts.length,
      textFilesCreated: createdTextFiles.length
    });

    // -----------------------------------------------------------------------
    // Build complete FFmpeg command
    // -----------------------------------------------------------------------
    
    const filterComplex = filterParts.join(';');
    logFilterComplexStructure('renderTextOverlay', filterComplex);
    
    // Note: We don't use audio in text overlay as it's purely visual
    const args = [
      '-y',
      '-filter_complex', filterComplex,
      '-map', `[${currentVideo}]`,
      '-t', String(duration),
      '-c:v', 'png',  // PNG codec properly supports alpha transparency
      '-pix_fmt', 'rgba',  // Use RGBA pixel format for proper alpha channel
      '-r', String(fps),  // Set output framerate
      outputPath
    ];

    logger.debug('renderTextOverlay: FFmpeg command prepared', { 
      textClips: textClips.length, 
      filterComplexLength: filterComplex.length,
      outputPath
    });

    await executeFFmpeg(config.ffmpegPath, args, duration, onProgress, 'renderTextOverlay');
    
    logger.debug('renderTextOverlay: FFmpeg completed, returning text file paths for later cleanup', {
      textFilesCount: createdTextFiles.length
    });
    
    return { createdTextFiles };
  } catch (err) {
    // On error, clean up text files immediately since we won't reach the finally block
    logger.error('renderTextOverlay: Error during rendering, cleaning up text files', { error: err.message });
    for (const textFilePath of createdTextFiles) {
      try {
        if (fs.existsSync(textFilePath)) fs.unlinkSync(textFilePath);
      } catch (cleanupErr) {
        logger.warn('renderTextOverlay: Failed to cleanup text temp file', {
          textFilePath,
          error: cleanupErr.message
        });
      }
    }
    throw err;
  }
}


async function compositeWithAudio({ baseVideoPath, textOverlayPath, audioClips, inPoint, duration, outputPath, onProgress }) {

  logger.debug('compositeWithAudio: Starting', {
    baseVideoPath,
    textOverlayPath,
    audioClips: audioClips.length
  });

  const baseExists = fs.existsSync(baseVideoPath);
  const hasTextOverlay = !!textOverlayPath;
  const textExists = hasTextOverlay ? fs.existsSync(textOverlayPath) : false;

  if (!baseExists || (hasTextOverlay && !textExists)) {
    throw new Error(`Missing input files: base=${baseExists}, text=${textExists}`);
  }

  const inputs = ['-i', baseVideoPath];
  let filterParts = [];

  let audioInputIdx = hasTextOverlay ? 2 : 1;
  const audioInputs = [];
  const audioLabels = [];

  if (hasTextOverlay) {
    inputs.push('-i', textOverlayPath);

    // Base video (yuv420p) with PNG text overlay (rgba) using alpha blending
    // The overlay filter will automatically use the alpha channel from the PNG
    filterParts.push(
      '[0:v][1:v]overlay=x=0:y=0:format=auto[vout]'
    );

  } else {

    filterParts.push('[0:v]format=yuv420p[vout]');
  }

  let audioLabelIndex = 0;

  for (const clip of audioClips) {

    const timing = calculateClipTiming(clip, inPoint, duration);

    if (!timing.isWithinRange) {
      logger.debug('compositeWithAudio: Skipped audio clip (outside range)', {
        file: path.basename(clip.filePath),
        timelinePosition: clip.timelinePosition,
        timelineDuration: clip.timelineDuration,
        inPoint,
        duration
      });
      continue;
    }

    inputs.push('-i', clip.filePath);

    const inputIndex = audioInputIdx++;
    const label = `a${audioLabelIndex++}`;

    const vol = clip.volume !== undefined ? clip.volume : 1;
    const srcStart = clip.srcStart !== undefined ? clip.srcStart : 0;
    const adelayMs = Math.round(timing.relStart * 1000);

    // Extract and normalize audio: trim source -> delay -> volume -> format
    // aformat=sample_rates=48000:channel_layouts=stereo ensures all streams are compatible
    const filterStr = `[${inputIndex}:a]atrim=start=${srcStart}:duration=${timing.clipDuration},adelay=${adelayMs}|${adelayMs},volume=${vol},aformat=sample_rates=48000:channel_layouts=stereo[${label}]`;
    audioInputs.push(filterStr);
    audioLabels.push(`[${label}]`);

    logger.debug('compositeWithAudio: Added audio clip', {
      file: path.basename(clip.filePath),
      type: clip.type,
      inputIndex,
      audioLabel: label,
      srcStart,
      timelinePosition: clip.timelinePosition,
      relStart: timing.relStart,
      clipDuration: timing.clipDuration,
      adelayMs,
      volume: vol,
      filterStr
    });
  }

  let audioMap = null;

  if (audioInputs.length > 0) {

    filterParts.push(...audioInputs);
    
    logger.info('compositeWithAudio: Audio processing summary', {
      totalAudioClips: audioClips.length,
      processedAudioInputs: audioInputs.length,
      audioLabels: audioLabels.map((_, idx) => `a${idx}`),
      audioLabelCount: audioLabels.length
    });

    if (audioLabels.length === 0) {

      audioMap = null;
      logger.info('compositeWithAudio: No audio to map');

    }
    else if (audioLabels.length === 1) {

      audioMap = audioLabels[0];
      logger.info('compositeWithAudio: Single audio stream (pass-through)', {
        audioLabel: audioLabels[0]
      });

    }
    else {

      const amixInputs = audioLabels.join('');
      const amixFilter = `${amixInputs}amix=inputs=${audioLabels.length}:duration=longest:dropout_transition=0[aout]`;
      
      filterParts.push(amixFilter);
      audioMap = '[aout]';
      
      logger.info('compositeWithAudio: Multiple audio streams (using amix)', {
        streamCount: audioLabels.length,
        audioLabels: audioLabels,
        amixInputs,
        amixFilter
      });
    }
  }

  const filterComplex = filterParts.join(';');

  logFilterComplexStructure('compositeWithAudio', filterComplex);

  const args = [
    '-y',
    '-threads', '0',
    ...inputs,
    '-filter_complex', filterComplex,
    '-map', '[vout]'
  
  ];

  if (audioMap) {
    args.push('-map', audioMap);
  }

  args.push(
    '-t', String(duration),
    '-c:v', ENCODING_DEFAULTS.codec,
    '-preset', ENCODING_DEFAULTS.preset,
    '-crf', ENCODING_DEFAULTS.crf,
    '-pix_fmt', ENCODING_DEFAULTS.pixelFormat,
    '-movflags', '+faststart'
  );

  if (audioMap) {
    args.push(
      '-c:a', ENCODING_DEFAULTS.audioCodec,
      '-b:a', ENCODING_DEFAULTS.audioBitrate
    );
  }

  args.push(outputPath);
  logger.debug("FFmpeg full command", {cmd: config.ffmpegPath + " " + args.join(" ")});
  

  return executeFFmpeg(config.ffmpegPath, args, duration, onProgress, 'compositeWithAudio');

}

// ============================================================================
// FFMPEG EXECUTION HELPER
// ============================================================================

/**
 * Execute FFmpeg command with progress tracking and error handling
 * 
 * FEATURES:
 * - Spawns FFmpeg process with proper stdio configuration
 * - Parses FFmpeg stderr output to extract progress (time=HH:MM:SS.MS)
 * - Reports progress percentage via callback
 * - Logs progress every 10% to avoid log spam
 * - Captures and reports errors with stderr output
 * 
 * @param {string} ffmpegPath - Path to FFmpeg executable
 * @param {Array<string>} args - FFmpeg command arguments
 * @param {number} totalDuration - Expected output duration (for progress calculation)
 * @param {Function} onProgress - Progress callback (0-100)
 * @param {string} stepName - Name of this step (for logging)
 * @returns {Promise<void>}
 */
function executeFFmpeg(ffmpegPath, args, totalDuration, onProgress, stepName = 'FFmpeg') {

  logger.debug(`FFmpeg full command for ${stepName}:`, {cmd: config.ffmpegPath + " " + args.join(" ")});

  logger.debug(`${stepName}: Executing FFmpeg`, {
    ffmpegPath,
    argCount: args.length,
    duration: totalDuration
  });
  
  // Log command preview (truncate to avoid massive logs)
  const cmdPreview = args.slice(0, 10).join(' ') + (args.length > 10 ? ` ... (${args.length - 10} more args)` : '');
  logger.debug(`${stepName}: Command preview`, { command: `${ffmpegPath} ${cmdPreview}` });
  
  return new Promise((resolve, reject) => {
    
    const proc = spawn(ffmpegPath, args, {
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true
    });
    
    let stderr = '';         // Accumulate stderr for error reporting
    let lastProgress = -1;   // Track last reported progress (for 10% logging)

    logger.debug(`${stepName}: FFmpeg process spawned`, { pid: proc.pid });

    // -----------------------------------------------------------------------
    // Parse stderr output for progress updates
    // FFmpeg writes progress info to stderr in format: time=HH:MM:SS.MS
    // -----------------------------------------------------------------------
    proc.stderr.on('data', (data) => {
      const chunk = data.toString();
      stderr += chunk;

      // Extract time from FFmpeg output
      const timeMatch = chunk.match(/time=(\d+):(\d+):([\d.]+)/);
      if (timeMatch && onProgress) {
        // Convert HH:MM:SS to total seconds
        const secs = parseInt(timeMatch[1]) * 3600 + parseInt(timeMatch[2]) * 60 + parseFloat(timeMatch[3]);
        const pct = Math.min(99, Math.round((secs / totalDuration) * 100));
        
        // Log progress every 10% to avoid log spam
        if (Math.floor(pct / 10) > Math.floor(lastProgress / 10)) {
          logger.debug(`${stepName}: Progress ${pct}%`, { time: secs.toFixed(2), duration: totalDuration });
        }
        lastProgress = pct;
        
        // Report progress to callback
        onProgress(pct);
      }
    });

    // -----------------------------------------------------------------------
    // Handle process completion
    // -----------------------------------------------------------------------
    proc.on('close', (code) => {
      if (code === 0) {
        // Success
        if (onProgress) onProgress(100);
        logger.debug(`${stepName}: FFmpeg completed successfully`, { exitCode: code });
        resolve();
      } else {
        // Failure: include stderr tail in error message
        const errorMsg = `FFmpeg exited with code ${code}`;
        const stderrTail = stderr.slice(-1500);  // Last 1500 chars of stderr
        logger.error(`${stepName}: ${errorMsg}`, { code, stderr: stderrTail });
        reject(new Error(`${errorMsg}:\n${stderrTail}`));
      }
    });

    // -----------------------------------------------------------------------
    // Handle process errors (e.g., FFmpeg not found)
    // -----------------------------------------------------------------------
    proc.on('error', (err) => {
      logger.error(`${stepName}: FFmpeg process error`, { error: err.message, stack: err.stack });
      reject(err);
    });
  });
}

// ============================================================================
// MODULE EXPORTS
// ============================================================================

module.exports = { render };
