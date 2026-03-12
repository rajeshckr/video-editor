const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
require('dotenv').config();

const Logger = require('./utils/logger');
const logger = Logger.getInstance('Server');

const config = require('./config');
const uploadRouter = require('./routes/upload');
const progressRouter = require('./routes/progress');
const renderRouter = require('./routes/render');
const captionRouter = require('./routes/caption');
const aiRouter = require('./routes/ai');
const cleanupService = require('./services/cleanupService');
const setupWhisper = require('./setupWhisper');

const app = express();

function toOrigin(value) {
  if (!value) return null;
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

function parseCsvOrigins(value) {
  if (!value) return [];
  return value
    .split(',')
    .map((x) => toOrigin(x.trim()))
    .filter(Boolean);
}

const allowOriginSet = new Set([
  ...parseCsvOrigins(process.env.FRONTEND_URL),
].filter(Boolean));

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
    if (!origin || allowOriginSet.has(origin)) {
      callback(null, true);
    } else {
      callback(new Error('CORS: origin not allowed'));
    }
  }
}));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// ─── Request logging middleware ────────────────────────────────────────────────
app.use((req, res, next) => {
  const startTime = Date.now();
  const originalJson = res.json;
  
  // Log response when it's sent
  res.json = function(data) {
    const duration = Date.now() - startTime;

    logger.api("following log due for deletion")

    logger.api(req.method, req.path, res.statusCode, {
      duration: `${duration}ms`,
      timestamp: new Date().toISOString()
    });
    return originalJson.call(this, data);
  };
  
  next();
});

// ─── Routes ───────────────────────────────────────────────────────────────────
app.use('/api/upload', uploadRouter);
app.use('/api/progress', progressRouter);
app.use('/api/render', renderRouter);
app.use('/api/caption', captionRouter);
app.use('/api/ai', aiRouter);

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
  logger.error(`Request failed: ${req.method} ${req.path}`, err);
  res.status(err.status || 500).json({ error: err.message || 'Internal server error' });
});

// ─── Start server ─────────────────────────────────────────────────────────────
app.listen(config.port, async () => {
  logger.info('🚀 Server starting');
  logger.info(`Server running on http://localhost:${config.port}`);
  logger.info(`FFmpeg: ${config.ffmpegPath}`);
  logger.info(`TMP:    ${config.tmpPath}`);
  
  // Ensure AI models and binaries are ready
  logger.info('Setting up Whisper...');
  await setupWhisper();
  logger.info('Whisper setup complete');
  
  logger.info('Starting cleanup service...');
  cleanupService.start();
  logger.info('✅ Server ready');
});
