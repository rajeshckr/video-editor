const fs = require('fs');
const path = require('path');
const https = require('https');
const { execSync } = require('child_process');
const Logger = require('./utils/logger');
const logger = Logger.getInstance('Whisper-Setup');
const config = require('./config');

const WHISPER_ZIP_URL = 'https://github.com/ggerganov/whisper.cpp/releases/download/v1.6.0/whisper-bin-x64.zip';
const WHISPER_MODEL_URL = 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-tiny.en.bin';

function downloadFile(url, dest) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest);
    https.get(url, (response) => {
      // Handle redirects
      if (response.statusCode === 301 || response.statusCode === 302) {
        file.close();
        return downloadFile(response.headers.location, dest).then(resolve).catch(reject);
      }
      
      if (response.statusCode !== 200) {
        reject(new Error(`Failed to download: ${response.statusCode} - ${response.statusMessage}`));
        return;
      }

      response.pipe(file);
      file.on('finish', () => {
        file.close(resolve);
      });
    }).on('error', (err) => {
      fs.unlink(dest, () => reject(err));
    });
  });
}

function extractZip(zipPath, destDir) {
  try {
    // Windows 10+ has native tar that can extract zips
    logger.debug('Attempting to extract with native tar...');
    execSync(`tar -xf "${zipPath}" -C "${destDir}"`);
    logger.debug('Successfully extracted zip with native tar');
    return true;
  } catch (err) {
    logger.warn(`Failed to extract zip natively, falling back to PowerShell...`);
    try {
      logger.debug('Attempting to extract with PowerShell Expand-Archive...');
      execSync(`powershell -command "Expand-Archive -Force '${zipPath}' '${destDir}'"`);
      logger.debug('Successfully extracted zip with PowerShell');
      return true;
    } catch(err2) {
      logger.error(`Failed to extract zip with PowerShell`, err2);
      return false;
    }
  }
}

async function setupWhisper() {
  const toolsDir = config.toolsPath;
  if (!fs.existsSync(toolsDir)) {
    logger.debug(`Creating Tools directory: ${toolsDir}`);
    fs.mkdirSync(toolsDir, { recursive: true });
  }

  const whisperExePath = path.join(toolsDir, 'whisper.exe');
  const modelPath = path.join(toolsDir, 'ggml-tiny.en.bin');
  
  // 1. Download Model
  if (!fs.existsSync(modelPath)) {
    logger.info('📥 Downloading Whisper model "tiny.en" (~75MB)...');
    logger.time('model-download');
    try {
      await downloadFile(WHISPER_MODEL_URL, modelPath);
      logger.timeEnd('model-download');
      logger.info('✅ Model downloaded successfully.');
    } catch (err) {
      logger.error(`Failed to download model`, err);
    }
  } else {
    logger.info('ℹ️  Whisper model "tiny.en" already exists.');
  }

  // 2. Download and Extract Whisper Binary
  if (!fs.existsSync(whisperExePath)) {
    logger.info('📥 Downloading whisper.cpp win-x64 release...');
    logger.time('whisper-download');
    const zipDest = path.join(toolsDir, 'whisper-temp.zip');
    try {
      await downloadFile(WHISPER_ZIP_URL, zipDest);
      logger.timeEnd('whisper-download');
      logger.info('📦 Extracting whisper.cpp...');
      logger.time('whisper-extract');
      
      const success = extractZip(zipDest, toolsDir);
      
      if (success && fs.existsSync(path.join(toolsDir, 'main.exe'))) {
        logger.timeEnd('whisper-extract');
        logger.debug('Renaming main.exe to whisper.exe');
        fs.renameSync(path.join(toolsDir, 'main.exe'), whisperExePath);
        logger.info('✅ Whisper binary installed successfully.');
      } else {
        logger.error(`Failed to locate extracted main.exe.`);
      }

      // Cleanup
      if (fs.existsSync(zipDest)) {
        logger.debug('Cleaning up temp zip file');
        fs.unlinkSync(zipDest);
      }
      
    } catch (err) {
      logger.error(`Failed to download/extract whisper binary`, err);
    }
  } else {
    logger.info('ℹ️  whisper.exe already exists.');
  }
}

module.exports = setupWhisper;
