const { execFile, spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const config = require('../config');

/**
 * Main render function.
 * Builds an FFmpeg filter_complex from the project timeline and runs it.
 */
async function render({ project, inPoint, outPoint, outputPath, outputFormat, onProgress }) {
  const { tracks = [], resolution = { width: 1920, height: 1080 }, fps = 30 } = project;

  // Collect all clips sorted by track number (lower = bottom layer)
  const allClips = [];
  tracks.forEach(track => {
    (track.clips || []).forEach(clip => {
      allClips.push({ ...clip, trackNumber: track.trackNumber, trackType: track.type });
    });
  });

  // Separate by type
  const videoClips = allClips.filter(c => c.type === 'video')
    .sort((a, b) => a.trackNumber - b.trackNumber);
  const audioClips = allClips.filter(c => c.type === 'audio' || (c.type === 'video' && c.volume > 0))
    .sort((a, b) => a.trackNumber - b.trackNumber);
  const imageClips = allClips.filter(c => c.type === 'image')
    .sort((a, b) => a.trackNumber - b.trackNumber);
  const textClips = allClips.filter(c => c.type === 'text')
    .sort((a, b) => a.trackNumber - b.trackNumber);

  const duration = outPoint - inPoint;
  const W = resolution.width;
  const H = resolution.height;

  // Build inputs array and filter_complex
  const inputs = [];
  let filterParts = [];
  let currentVideo = `base`;

  // Create black base
  filterParts.push(`color=c=black:s=${W}x${H}:r=${fps}:d=${duration}[base]`);

  let inputIdx = 0;

  // Add video clips as inputs
  for (const clip of videoClips) {
    const relStart = Math.max(0, clip.timelinePosition - inPoint);
    const relEnd = Math.min(duration, clip.timelinePosition + clip.timelineDuration - inPoint);
    if (relEnd <= relStart) continue;

    inputs.push('-i', clip.filePath);
    const idx = inputIdx++;
    const label = `v${idx}`;
    const overlayLabel = `ov${idx}`;
    const clipDuration = relEnd - relStart;

    // Trim source clip
    filterParts.push(
      `[${idx}:v]trim=start=${clip.srcStart}:duration=${clipDuration},setpts=PTS-STARTPTS,scale=${W}:${H}:force_original_aspect_ratio=decrease,pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2[${label}]`
    );

    // Overlay onto current base
    filterParts.push(
      `[${currentVideo}][${label}]overlay=enable='between(t,${relStart},${relEnd})':x=0:y=0[${overlayLabel}]`
    );
    currentVideo = overlayLabel;
  }

  // Add image clips as inputs
  for (const clip of imageClips) {
    const relStart = Math.max(0, clip.timelinePosition - inPoint);
    const relEnd = Math.min(duration, clip.timelinePosition + clip.timelineDuration - inPoint);
    if (relEnd <= relStart) continue;

    inputs.push('-loop', '1', '-t', String(relEnd - relStart), '-i', clip.filePath);
    const idx = inputIdx++;
    const label = `img${idx}`;
    const overlayLabel = `imgov${idx}`;
    const opacity = clip.opacity !== undefined ? clip.opacity : 1;

    filterParts.push(
      `[${idx}:v]scale=${W}:${H}:force_original_aspect_ratio=decrease,pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2,format=rgba,colorchannelmixer=aa=${opacity}[${label}]`
    );
    filterParts.push(
      `[${currentVideo}][${label}]overlay=enable='between(t,${relStart},${relEnd})':x=0:y=0[${overlayLabel}]`
    );
    currentVideo = overlayLabel;
  }

  // Add text clips via drawtext filter
  for (const clip of textClips) {
    const relStart = Math.max(0, clip.timelinePosition - inPoint);
    const relEnd = Math.min(duration, clip.timelinePosition + clip.timelineDuration - inPoint);
    if (relEnd <= relStart) continue;

    const textLabel = `txt${inputIdx++}`;
    const sanitizedText = (clip.text || '').replace(/'/g, "\\'").replace(/:/g, "\\:");
    const fontColor = (clip.color || '#ffffff').replace('#','0x');
    const fontSize = clip.fontSize || 48;
    const x = clip.x !== undefined ? clip.x : '(w-text_w)/2';
    const y = clip.y !== undefined ? clip.y : '(h-text_h)/2';
    const font = clip.font || 'Arial';

    filterParts.push(
      `[${currentVideo}]drawtext=text='${sanitizedText}':fontsize=${fontSize}:fontcolor=${fontColor}:x=${x}:y=${y}:enable='between(t,${relStart},${relEnd})'[${textLabel}]`
    );
    currentVideo = textLabel;
  }

  // Build audio filter
  let audioMap = null;
  let audioInputIdxStart = inputIdx;
  const audioInputs = [];

  for (const clip of audioClips) {
    const relStart = Math.max(0, clip.timelinePosition - inPoint);
    if (relStart >= duration) continue;
    const clipSrcDur = Math.min(
      clip.timelineDuration,
      outPoint - clip.timelinePosition
    );
    if (clipSrcDur <= 0) continue;

    inputs.push('-i', clip.filePath);
    const aidx = inputIdx++;
    const vol = clip.volume !== undefined ? clip.volume : 1;
    const adelayMs = Math.round(relStart * 1000);
    audioInputs.push(`[${aidx}:a]atrim=start=${clip.srcStart}:duration=${clipSrcDur},adelay=${adelayMs}|${adelayMs},volume=${vol}[a${aidx}]`);
  }

  if (audioInputs.length > 0) {
    filterParts.push(...audioInputs);
    const amixInputs = audioInputs.map((_, i) => `[a${audioInputIdxStart + i}]`).join('');
    filterParts.push(`${amixInputs}amix=inputs=${audioInputs.length}:duration=first[aout]`);
    audioMap = '[aout]';
  }

  const filterComplex = filterParts.join(';');

  // Build final FFmpeg command
  const args = [
    '-y',
    ...inputs,
    '-filter_complex', filterComplex,
    '-map', `[${currentVideo}]`,
  ];

  if (audioMap) {
    args.push('-map', audioMap);
  }

  args.push(
    '-t', String(duration),
    '-c:v', 'libx264',
    '-preset', 'fast',
    '-crf', '23',
    '-pix_fmt', 'yuv420p',
  );

  if (audioMap) {
    args.push('-c:a', 'aac', '-b:a', '128k');
  }

  args.push(outputPath);

  console.log('[FFmpeg] Command:', config.ffmpegPath, args.join(' '));

  return new Promise((resolve, reject) => {
    const proc = spawn(config.ffmpegPath, args, { stdio: ['ignore', 'pipe', 'pipe'] });

    let totalDuration = duration;
    let stderr = '';

    proc.stderr.on('data', (data) => {
      const chunk = data.toString();
      stderr += chunk;

      // Parse progress from FFmpeg stderr
      const timeMatch = chunk.match(/time=(\d+):(\d+):([\d.]+)/);
      if (timeMatch && onProgress) {
        const secs = parseInt(timeMatch[1]) * 3600 + parseInt(timeMatch[2]) * 60 + parseFloat(timeMatch[3]);
        const pct = Math.min(99, Math.round((secs / totalDuration) * 100));
        onProgress(pct);
      }
    });

    proc.on('close', (code) => {
      if (code === 0) {
        if (onProgress) onProgress(100);
        resolve();
      } else {
        reject(new Error(`FFmpeg exited with code ${code}:\n${stderr.slice(-2000)}`));
      }
    });

    proc.on('error', reject);
  });
}

module.exports = { render };
