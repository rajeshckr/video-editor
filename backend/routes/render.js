const express = require('express');
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const config = require('../config');
const ffmpegService = require('../services/ffmpegService');

const router = express.Router();

// Active render jobs for SSE progress streaming
const activeJobs = new Map();

// ─── POST /api/render ─────────────────────────────────────────────────────────
router.post('/', async (req, res) => {
  const { project, inPoint, outPoint, outputFormat = 'mp4' } = req.body;

  if (!project || !project.tracks) {
    return res.status(400).json({ error: 'Invalid project data' });
  }

  const jobId = uuidv4();
  const outputFilename = `render_${jobId}.${outputFormat}`;
  const outputPath = path.join(config.rendersPath, outputFilename);

  // Start job tracking
  activeJobs.set(jobId, { progress: 0, status: 'queued', outputPath, outputFilename });

  res.json({ jobId, message: 'Render started' });

  // Run render asynchronously
  try {
    activeJobs.get(jobId).status = 'rendering';
    await ffmpegService.render({
      project,
      inPoint: parseFloat(inPoint) || 0,
      outPoint: parseFloat(outPoint) || project.duration || 60,
      outputPath,
      outputFormat,
      onProgress: (pct) => {
        const job = activeJobs.get(jobId);
        if (job) job.progress = pct;
      }
    });
    const job = activeJobs.get(jobId);
    if (job) { job.progress = 100; job.status = 'done'; }
  } catch (err) {
    const job = activeJobs.get(jobId);
    if (job) { job.status = 'error'; job.error = err.message; }
    console.error('[Render Error]', err.message);
  }
});

// ─── GET /api/render/progress/:jobId ─── SSE ──────────────────────────────────
router.get('/progress/:jobId', (req, res) => {
  const { jobId } = req.params;

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const send = () => {
    const job = activeJobs.get(jobId);
    if (!job) {
      res.write(`data: ${JSON.stringify({ status: 'not_found' })}\n\n`);
      return clearInterval(interval);
    }
    res.write(`data: ${JSON.stringify({ progress: job.progress, status: job.status, error: job.error })}\n\n`);
    if (job.status === 'done' || job.status === 'error') {
      clearInterval(interval);
      res.end();
    }
  };

  const interval = setInterval(send, 500);
  req.on('close', () => clearInterval(interval));
});

// ─── GET /api/render/download/:jobId ─────────────────────────────────────────
router.get('/download/:jobId', (req, res) => {
  const job = activeJobs.get(req.params.jobId);
  if (!job || job.status !== 'done') {
    return res.status(404).json({ error: 'Render not found or not complete' });
  }
  if (!fs.existsSync(job.outputPath)) {
    return res.status(404).json({ error: 'Output file missing' });
  }
  res.download(path.resolve(job.outputPath), job.outputFilename, err => {
    if (err) console.error(`[Error sending download] ${job.outputPath}:`, err.message);
  });
});

module.exports = router;
