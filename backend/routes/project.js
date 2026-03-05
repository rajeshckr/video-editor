const express = require('express');
const fs = require('fs');
const path = require('path');
const config = require('../config');

const router = express.Router();
const PROJECT_FILE = path.join(config.cachePath, 'project.json');

// ─── POST /api/project/save ───────────────────────────────────────────────────
router.post('/save', (req, res) => {
  const project = req.body;
  if (!project || !project.projectName) {
    return res.status(400).json({ error: 'Invalid project data' });
  }
  try {
    fs.writeFileSync(PROJECT_FILE, JSON.stringify(project, null, 2), 'utf8');
    res.json({ success: true, saved: PROJECT_FILE });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── GET /api/project/load ────────────────────────────────────────────────────
router.get('/load', (req, res) => {
  if (!fs.existsSync(PROJECT_FILE)) {
    return res.json({ project: null });
  }
  try {
    const raw = fs.readFileSync(PROJECT_FILE, 'utf8');
    const project = JSON.parse(raw);
    res.json({ project });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
