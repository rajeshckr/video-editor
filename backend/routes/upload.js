const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const { execFile } = require('child_process');
const config = require('../config');

const router = express.Router();

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
function generateThumbnail(filePath, outputPath, timeOffset = '00:00:01') {
  return new Promise((resolve, reject) => {
    execFile(config.ffmpegPath, [
      '-ss', timeOffset,
      '-i', filePath,
      '-frames:v', '1',
      '-vf', 'scale=200:-1',
      '-y', outputPath
    ], (err) => {
      if (err) reject(err); else resolve(outputPath);
    });
  });
}

// ─── POST /api/upload ─────────────────────────────────────────────────────────
router.post('/', upload.single('file'), async (req, res, next) => {
  if (!req.file) return res.status(400).json({ error: 'No file provided' });

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
      } catch (_) {}
    }

    // Generate thumbnail for video/image
    if (isVideo || isImage) {
      const thumbPath = path.join(config.thumbnailsPath, `${fileId}.jpg`);
      try {
        await generateThumbnail(filePath, thumbPath);
        metadata.thumbnail = `/api/upload/thumbnail/${fileId}.jpg`;
      } catch (_) {}
    }

    res.json({ success: true, asset: metadata });
  } catch (err) {
    // Clean up on error
    fs.unlink(filePath, () => {});
    next(err);
  }
});

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
      'Content-Type': 'video/mp4',
    });
    fs.createReadStream(absPath, { start, end }).pipe(res);
  } else {
    res.writeHead(200, {
      'Content-Length': total,
      'Content-Type': 'video/mp4',
      'Accept-Ranges': 'bytes',
    });
    fs.createReadStream(absPath).pipe(res);
  }
});

module.exports = router;
