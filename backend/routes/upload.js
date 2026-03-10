const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const { execFile, spawn } = require('child_process');
const config = require('../config');
const progressSSE = require('./progress');
const transcriptService = require('../services/ai/transcriptService');
const metadataService = require('../services/ai/metadataService');

const router = express.Router();

//This file handles:
// ─── POST /api/upload ─────────────────────────────────────────────────────────
// ─── POST /api/upload/process ─────────────────────────────────────────────────
// ─── GET /api/upload/thumbnail/:filename ─────────────────────────────────────
// ─── GET /api/upload/file/:filename ──────────────────────────────────────────



// ─── Upload request/response logging ─────────────────────────────────────────
// router.use((req, res, next) => {

//   const startTime = process.hrtime.bigint();
//   const requestDetails = {
//     method: req.method,
//     path: req.originalUrl,
//     contentType: req.get('content-type') || null,
//     contentLength: req.get('content-length') || null,
//   };

//   console.info('[upload][request]', requestDetails);

//   res.on('finish', () => {
//     const elapsedMs = Number(process.hrtime.bigint() - startTime) / 1e6;
//     console.info('[upload][response]', {
//       method: req.method,
//       path: req.originalUrl,
//       statusCode: res.statusCode,
//       durationMs: Number(elapsedMs.toFixed(2)),
//       responseLength: res.getHeader('content-length') || null,
//       uploadedFile: req.file ? req.file.originalname : null,
//       uploadedSize: req.file ? req.file.size : null,
//     });
//   });

//   next();
// });

// ─── Multer Storage ───────────────────────────────────────────────────────────
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, config.uploadsPath),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `${uuidv4()}${ext}`);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: config.maxFileSizeMb * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase().replace('.', '');
    if (config.allowedExtensions.includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error(`File type .${ext} is not allowed`));
    }
  }
});

// ─── ffprobe helper ───────────────────────────────────────────────────────────
function probeFile(filePath) {
  return new Promise((resolve, reject) => {
    execFile(config.ffprobePath, [
      '-v', 'quiet',
      '-print_format', 'json',
      '-show_format',
      '-show_streams',
      filePath
    ], (err, stdout) => {
      if (err) return reject(err);
      try { resolve(JSON.parse(stdout)); }
      catch (e) { reject(e); }
    });
  });
}

// ─── Thumbnail generation ─────────────────────────────────────────────────────
function generateThumbnail(filePath, outputPath, options = {}) {
  const { isImage = false, timeOffset = '00:00:01' } = options;
  const ffArgs = isImage
    ? [
        '-i', filePath,
        '-frames:v', '1',
        '-vf', 'scale=200:-1',
        '-y', outputPath
      ]
    : [
        '-ss', timeOffset,
        '-i', filePath,
        '-frames:v', '1',
        '-vf', 'scale=200:-1',
        '-y', outputPath
      ];

  return new Promise((resolve, reject) => {
    execFile(config.ffmpegPath, ffArgs, (err) => {
      if (err) reject(err); else resolve(outputPath);
    });
  });
}

// ─── POST /api/upload ─────────────────────────────────────────────────────────
router.post('/', upload.single('file'), async (req, res, next) => {
  if (!req.file) return res.status(400).json({ error: 'No file provided' });

  console.info('[upload][file]', {
    originalName: req.file.originalname,
    storedName: req.file.filename,
    mimeType: req.file.mimetype,
    size: req.file.size,
  });

  const fileId = path.basename(req.file.filename, path.extname(req.file.filename));
  const filePath = req.file.path;
  const ext = path.extname(req.file.originalname).toLowerCase().replace('.', '');
  const isVideo = ['mp4','mov','mkv','webm'].includes(ext);
  const isAudio = ['mp3','wav','aac'].includes(ext);
  const isImage = ['jpg','jpeg','png','webp'].includes(ext);

  let metadata = {
    id: fileId,
    originalName: req.file.originalname,
    filename: req.file.filename,
    filePath: filePath,
    size: req.file.size,
    type: isVideo ? 'video' : isAudio ? 'audio' : 'image',
    duration: 0,
    width: 0,
    height: 0,
    fps: 30,
    thumbnail: null,
  };

  try {
    // Extract media metadata
    if (isVideo || isAudio) {
      const probe = await probeFile(filePath);
      const format = probe.format || {};
      metadata.duration = parseFloat(format.duration) || 0;
      const videoStream = probe.streams?.find(s => s.codec_type === 'video');
      const audioStream = probe.streams?.find(s => s.codec_type === 'audio');
      if (videoStream) {
        metadata.width = videoStream.width || 0;
        metadata.height = videoStream.height || 0;
        const fpsStr = videoStream.r_frame_rate || '30/1';
        const [num, den] = fpsStr.split('/').map(Number);
        metadata.fps = den ? Math.round(num / den) : 30;
      }
      if (audioStream && !videoStream) {
        metadata.width = 0;
        metadata.height = 0;
      }
    }

    if (isImage) {
      metadata.duration = 5; // default 5s for images
      try {
        const probe = await probeFile(filePath);
        const imgStream = probe.streams?.[0];
        if (imgStream) {
          metadata.width = imgStream.width || 0;
          metadata.height = imgStream.height || 0;
        }
      } catch (err) {
        console.error('\x1b[31m[upload][warn] Image probe failed; continuing with default image metadata\x1b[0m', {
          fileId,
          originalName: req.file?.originalname || null,
          storedName: req.file?.filename || null,
          message: err?.message || 'Unknown image probe error',
        });
      }
    }

    // Generate thumbnail for video/image
    if (isVideo || isImage) {
      const thumbPath = path.join(config.thumbnailsPath, `${fileId}.jpg`);
      try {
        await generateThumbnail(filePath, thumbPath, { isImage });
        metadata.thumbnail = `/api/upload/thumbnail/${fileId}.jpg`;
      } catch (err) {
        console.error('\x1b[31m[upload][warn] Thumbnail generation failed\x1b[0m', {
          fileId,
          isImage,
          originalName: req.file?.originalname || null,
          storedName: req.file?.filename || null,
          message: err?.message || 'Unknown thumbnail generation error',
        });
      }
    }

    res.json({ success: true, asset: metadata });
  } catch (err) {
    console.error('[upload][error]', {
      message: err?.message || 'Unknown upload error',
      filename: req.file?.filename || null,
    });

    // Clean up on error
    fs.unlink(filePath, () => {});
    next(err);
  }
});

// ─── Audio extraction helper ──────────────────────────────────────────────────
function extractAudio(videoPath, audioPath) {
  return new Promise((resolve, reject) => {
    const ffmpeg = spawn(config.ffmpegPath, [
      '-i', videoPath,
      '-vn', // No video
      '-acodec', 'libmp3lame',
      '-ar', '16000',
      '-ac', '1',
      '-b:a', '64k',
      '-y',
      audioPath
    ]);

    let stderr = '';
    ffmpeg.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    ffmpeg.on('close', (code) => {
      if (code === 0) {
        resolve(audioPath);
      } else {
        reject(new Error(`Audio extraction failed: ${stderr}`));
      }
    });

    ffmpeg.on('error', reject);
  });
}

// ─── POST /api/upload/process ─────────────────────────────────────────────────
// Async processing endpoint with progress tracking
router.post('/process', upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file provided' });

  const uploadId = uuidv4();
  const fileId = path.basename(req.file.filename, path.extname(req.file.filename));
  const filePath = req.file.path;
  const ext = path.extname(req.file.originalname).toLowerCase().replace('.', '');
  const isVideo = ['mp4','mov','mkv','webm'].includes(ext);

  console.info('[upload][process]', {
    uploadId,
    originalName: req.file.originalname,
    storedName: req.file.filename,
    isVideo,
  });

  // Respond immediately with uploadId for SSE connection
  res.json({ 
    success: true, 
    uploadId,
    fileId,
    message: 'Processing started. Connect to /api/progress/' + uploadId
  });

  // Start async processing
  processVideo(uploadId, fileId, filePath, req.file, isVideo).catch(err => {
    console.error('[upload][process-error]', { uploadId, error: err.message });
    progressSSE.sendProgress(uploadId, {
      type: 'error',
      step: 'error',
      message: err.message || 'Processing failed',
      progress: 0
    });
    progressSSE.complete(uploadId);
  });
});

// ─── Async video processing function ──────────────────────────────────────────
async function processVideo(uploadId, fileId, filePath, fileInfo, isVideo) {
  const startTime = Date.now();
  let metadata = {
    id: fileId,
    originalName: fileInfo.originalname,
    filename: fileInfo.filename,
    filePath: filePath,
    size: fileInfo.size,
    type: isVideo ? 'video' : 'audio',
    duration: 0,
    width: 0,
    height: 0,
    fps: 30,
    thumbnail: null,
    transcript: null,
    captions: null,
    aiMetadata: null,
  };

  try {
    // Stage 1: Extract media metadata (25%)
    progressSSE.sendProgress(uploadId, {
      type: 'progress',
      step: 'extracting_audio',
      stepLabel: 'Extracting Audio',
      currentStep: 1,
      totalSteps: 4,
      progress: 5,
      message: 'Analyzing video...'
    });

    const probe = await probeFile(filePath);
    const format = probe.format || {};
    metadata.duration = parseFloat(format.duration) || 0;
    const videoStream = probe.streams?.find(s => s.codec_type === 'video');
    
    if (videoStream) {
      metadata.width = videoStream.width || 0;
      metadata.height = videoStream.height || 0;
      const fpsStr = videoStream.r_frame_rate || '30/1';
      const [num, den] = fpsStr.split('/').map(Number);
      metadata.fps = den ? Math.round(num / den) : 30;
    }

    // Generate thumbnail
    if (isVideo) {
      const thumbPath = path.join(config.thumbnailsPath, `${fileId}.jpg`);
      await generateThumbnail(filePath, thumbPath);
      metadata.thumbnail = `/api/upload/thumbnail/${fileId}.jpg`;
    }

    progressSSE.sendProgress(uploadId, {
      type: 'progress',
      step: 'extracting_audio',
      stepLabel: 'Extracting Audio',
      currentStep: 1,
      totalSteps: 4,
      progress: 15,
      message: 'Extracting audio from video...'
    });

    // Extract audio to MP3
    const audioPath = path.join(config.tmpPath, 'intermediate', `${fileId}.mp3`);
    await extractAudio(filePath, audioPath);
    const audioSizeMB = (fs.statSync(audioPath).size / (1024 * 1024)).toFixed(2);

    progressSSE.sendProgress(uploadId, {
      type: 'progress',
      step: 'extracting_audio',
      stepLabel: 'Audio Extracted',
      currentStep: 1,
      totalSteps: 4,
      progress: 25,
      message: `Audio extracted: ${audioSizeMB} MB`,
      complete: true
    });

    // Stage 2: Generate transcript (25-60%)
    if (isVideo) {
      progressSSE.sendProgress(uploadId, {
        type: 'progress',
        step: 'generating_transcript',
        stepLabel: 'Generating Subtitles',
        currentStep: 2,
        totalSteps: 4,
        progress: 30,
        message: 'Starting Whisper AI transcription...'
      });

      // Copy to renders folder for transcript service
      const renderPath = path.join(config.tmpPath, 'renders', fileInfo.filename);
      fs.copyFileSync(filePath, renderPath);

      const transcriptResult = await transcriptService.generateTranscript(fileInfo.filename);
      metadata.transcript = transcriptResult.transcript;
      metadata.captions = transcriptResult.captions;

      progressSSE.sendProgress(uploadId, {
        type: 'progress',
        step: 'generating_transcript',
        stepLabel: 'Subtitles Generated',
        currentStep: 2,
        totalSteps: 4,
        progress: 60,
        message: `${transcriptResult.captions.length} captions • ${Math.floor(metadata.duration / 60)}:${String(Math.floor(metadata.duration % 60)).padStart(2, '0')} transcribed`,
        complete: true
      });

      // Stage 3: Generate metadata (60-90%)
      progressSSE.sendProgress(uploadId, {
        type: 'progress',
        step: 'creating_metadata',
        stepLabel: 'Creating Metadata',
        currentStep: 3,
        totalSteps: 4,
        progress: 65,
        message: 'Analyzing transcript for keywords and summary...'
      });

      const aiMetadata = await metadataService.generateMetadata(transcriptResult.transcript, false);
      metadata.aiMetadata = aiMetadata;

      progressSSE.sendProgress(uploadId, {
        type: 'progress',
        step: 'creating_metadata',
        stepLabel: 'Metadata Created',
        currentStep: 3,
        totalSteps: 4,
        progress: 90,
        message: `Generated: ${aiMetadata.keywords?.length || 0} keywords`,
        complete: true
      });
    }

    // Stage 4: Finalize (90-100%)
    progressSSE.sendProgress(uploadId, {
      type: 'progress',
      step: 'finalizing',
      stepLabel: 'Finalizing',
      currentStep: 4,
      totalSteps: 4,
      progress: 95,
      message: 'Saving to media library...'
    });

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

    progressSSE.sendProgress(uploadId, {
      type: 'complete',
      step: 'finalizing',
      stepLabel: 'Complete',
      currentStep: 4,
      totalSteps: 4,
      progress: 100,
      message: `Processing completed in ${elapsed}s`,
      asset: metadata,
      complete: true
    });

    progressSSE.complete(uploadId);

  } catch (err) {
    console.error('[upload][process-error]', { uploadId, error: err.message, stack: err.stack });
    
    // Clean up on error
    fs.unlink(filePath, () => {});
    
    throw err;
  }
}

// ─── GET /api/upload/thumbnail/:filename ─────────────────────────────────────
router.get('/thumbnail/:filename', (req, res) => {
  const filename = path.basename(req.params.filename);
  const thumbPath = path.join(config.thumbnailsPath, filename);
  const absPath = path.resolve(thumbPath);
  if (!fs.existsSync(absPath)) return res.status(404).json({ error: 'Not found' });
  res.sendFile(absPath, err => {
    if (err && !res.headersSent) res.status(500).end();
  });
});

// ─── GET /api/upload/file/:filename ──────────────────────────────────────────
router.get('/file/:filename', (req, res) => {
  const filename = path.basename(req.params.filename);
  const filePath = path.join(config.uploadsPath, filename);
  const absPath = path.resolve(filePath);
  if (!fs.existsSync(absPath)) return res.status(404).json({ error: 'Not found' });

  const ext = path.extname(filename).toLowerCase();
  const mimeByExt = {
    '.mp4': 'video/mp4',
    '.mov': 'video/quicktime',
    '.mkv': 'video/x-matroska',
    '.webm': 'video/webm',
    '.mp3': 'audio/mpeg',
    '.wav': 'audio/wav',
    '.aac': 'audio/aac',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
    '.webp': 'image/webp',
  };
  const contentType = mimeByExt[ext] || 'application/octet-stream';

  const stat = fs.statSync(absPath);
  const total = stat.size;
  const range = req.headers.range;

  if (range) {
    const parts = range.replace(/bytes=/, '').split('-');
    const start = parseInt(parts[0], 10);
    const end = parts[1] ? parseInt(parts[1], 10) : total - 1;
    res.writeHead(206, {
      'Content-Range': `bytes ${start}-${end}/${total}`,
      'Accept-Ranges': 'bytes',
      'Content-Length': end - start + 1,
      'Content-Type': contentType,
    });
    fs.createReadStream(absPath, { start, end }).pipe(res);
  } else {
    res.writeHead(200, {
      'Content-Length': total,
      'Content-Type': contentType,
      'Accept-Ranges': 'bytes',
    });
    fs.createReadStream(absPath).pipe(res);
  }
});

module.exports = router;
