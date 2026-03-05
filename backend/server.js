const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
require('dotenv').config();

const config = require('./config');
const uploadRouter = require('./routes/upload');
const projectRouter = require('./routes/project');
const renderRouter = require('./routes/render');
const captionRouter = require('./routes/caption');
const cleanupService = require('./services/cleanupService');
const setupWhisper = require('./setupWhisper');

const app = express();

// ─── Security: Block access to TMP and Tools ───────────────────────────────────
app.use((req, res, next) => {
  const blocked = ['/tmp', '/tools'];
  const lower = req.path.toLowerCase();
  if (blocked.some(b => lower.startsWith(b))) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  next();
});

// ─── Middleware ────────────────────────────────────────────────────────────────
app.use(cors({
  origin: (origin, callback) => {
    // Allow requests with no origin (curl, Postman) or any localhost
    if (!origin || /^http:\/\/localhost:\d+$/.test(origin)) {
      callback(null, true);
    } else {
      callback(new Error('CORS: origin not allowed'));
    }
  }
}));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// ─── Routes ───────────────────────────────────────────────────────────────────
app.use('/api/upload', uploadRouter);
app.use('/api/project', projectRouter);
app.use('/api/render', renderRouter);
app.use('/api/caption', captionRouter);

// ─── Health check ─────────────────────────────────────────────────────────────
app.get('/api/health', (req, res) => {
  const ffmpegExists = fs.existsSync(config.ffmpegPath);
  const ffprobeExists = fs.existsSync(config.ffprobePath);
  res.json({
    status: 'ok',
    ffmpeg: ffmpegExists,
    ffprobe: ffprobeExists,
    toolsPath: config.toolsPath,
    tmpPath: config.tmpPath,
  });
});

// ─── Error handler ────────────────────────────────────────────────────────────
app.use((err, req, res, next) => {
  console.error('[ERROR]', err.message);
  res.status(err.status || 500).json({ error: err.message || 'Internal server error' });
});

// ─── Start server ─────────────────────────────────────────────────────────────
app.listen(config.port, async () => {
  console.log(`[Server] Running on http://localhost:${config.port}`);
  console.log(`[Server] FFmpeg: ${config.ffmpegPath}`);
  console.log(`[Server] TMP:    ${config.tmpPath}`);
  
  // Ensure AI models and binaries are ready
  await setupWhisper();
  
  cleanupService.start();
});
