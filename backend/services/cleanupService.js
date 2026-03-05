const fs = require('fs');
const path = require('path');
const cron = require('node-cron');
const config = require('../config');

const DIRS_TO_CLEAN = [
  config.uploadsPath,
  config.thumbnailsPath,
  config.intermediatePath,
  config.rendersPath,
  config.audioPath,
];

function deleteOldFiles(dir) {
  if (!fs.existsSync(dir)) return;
  const retentionMs = config.cleanupRetentionHours * 60 * 60 * 1000;
  const now = Date.now();
  let deleted = 0;

  fs.readdirSync(dir).forEach(file => {
    const filePath = path.join(dir, file);
    try {
      const stat = fs.statSync(filePath);
      if (stat.isFile() && (now - stat.mtimeMs) > retentionMs) {
        fs.unlinkSync(filePath);
        deleted++;
        console.log(`[Cleanup] Deleted: ${filePath}`);
      }
    } catch (_) {}
  });

  if (deleted > 0) console.log(`[Cleanup] Removed ${deleted} file(s) from ${dir}`);
}

function runCleanup() {
  console.log('[Cleanup] Running scheduled cleanup...');
  DIRS_TO_CLEAN.forEach(deleteOldFiles);
}

function start() {
  // Run every hour
  cron.schedule('0 * * * *', runCleanup);
  console.log(`[Cleanup] Scheduled. Retention: ${config.cleanupRetentionHours}h`);
}

module.exports = { start, runCleanup };
