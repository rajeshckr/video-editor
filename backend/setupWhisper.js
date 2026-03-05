const fs = require('fs');
const path = require('path');
const https = require('https');
const { execSync } = require('child_process');
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
    execSync(`tar -xf "${zipPath}" -C "${destDir}"`);
    return true;
  } catch (err) {
    console.error(`[WhisperSetup] Failed to extract zip natively, falling back...`, err.message);
    try {
      execSync(`powershell -command "Expand-Archive -Force '${zipPath}' '${destDir}'"`);
      return true;
    } catch(err2) {
      console.error(`[WhisperSetup] Failed to extract zip with powershell:`, err2.message);
      return false;
    }
  }
}

async function setupWhisper() {
  const toolsDir = config.toolsPath;
  if (!fs.existsSync(toolsDir)) {
    fs.mkdirSync(toolsDir, { recursive: true });
  }

  const whisperExePath = path.join(toolsDir, 'whisper.exe');
  const modelPath = path.join(toolsDir, 'ggml-tiny.en.bin');
  
  // 1. Download Model
  if (!fs.existsSync(modelPath)) {
    console.log(`[WhisperSetup] Downloading Whisper model 'tiny.en' (~75MB)...`);
    try {
      await downloadFile(WHISPER_MODEL_URL, modelPath);
      console.log(`[WhisperSetup] Model downloaded successfully.`);
    } catch (err) {
      console.error(`[WhisperSetup] Failed to download model:`, err);
    }
  } else {
    console.log(`[WhisperSetup] Whisper model 'tiny.en' already exists.`);
  }

  // 2. Download and Extract Whisper Binary
  if (!fs.existsSync(whisperExePath)) {
    console.log(`[WhisperSetup] Downloading whisper.cpp win-x64 release...`);
    const zipDest = path.join(toolsDir, 'whisper-temp.zip');
    try {
      await downloadFile(WHISPER_ZIP_URL, zipDest);
      console.log(`[WhisperSetup] Extracting whisper.cpp...`);
      
      const success = extractZip(zipDest, toolsDir);
      
      if (success && fs.existsSync(path.join(toolsDir, 'main.exe'))) {
        fs.renameSync(path.join(toolsDir, 'main.exe'), whisperExePath);
        console.log(`[WhisperSetup] Whisper binary installed successfully.`);
      } else {
         console.error(`[WhisperSetup] Failed to locate extracted main.exe.`);
      }

      // Cleanup
      if (fs.existsSync(zipDest)) fs.unlinkSync(zipDest);
      
    } catch (err) {
      console.error(`[WhisperSetup] Failed to download/extract whisper binary:`, err);
    }
  } else {
    console.log(`[WhisperSetup] whisper.exe already exists.`);
  }
}

module.exports = setupWhisper;
