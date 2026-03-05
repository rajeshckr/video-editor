const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const config = require('../config');

// Helper to parse SRT string into JSON array
function parseSRT(srtContent) {
  const blocks = srtContent.trim().split(/\r?\n\r?\n/);
  const captions = [];

  for (const block of blocks) {
    const lines = block.split(/\r?\n/);
    if (lines.length >= 3) {
      const timecodeLine = lines[1];
      const textLines = lines.slice(2).join('\n').trim();

      const [startStr, endStr] = timecodeLine.split(' --> ');
      if (startStr && endStr) {
        captions.push({
          start: timeStrToSeconds(startStr),
          end: timeStrToSeconds(endStr),
          text: textLines
        });
      }
    }
  }
  return captions;
}

// Convert HH:MM:SS,mmm to seconds (float)
function timeStrToSeconds(timeStr) {
  const [time, ms] = timeStr.split(',');
  const [hours, minutes, seconds] = time.split(':').map(Number);
  return (hours * 3600) + (minutes * 60) + seconds + (Number(ms) / 1000);
}

router.post('/', async (req, res) => {
  const { filePath } = req.body;
  
  if (!filePath) {
    return res.status(400).json({ error: 'filePath is required' });
  }

  // Ensure filePath only traverses inside TMP
  const safeFilename = path.basename(filePath);
  const fullInputPath = path.join(config.tmpPath, 'uploads', safeFilename);

  if (!fs.existsSync(fullInputPath)) {
    return res.status(404).json({ error: 'File not found on server' });
  }

  // Define paths
  const tempWavPath = path.join(config.tmpPath, 'intermediate', `${Date.now()}_16k.wav`);
  const srtOutputPath = `${tempWavPath}.srt`; // whisper.cpp automatically appends .srt
  const whisperExe = path.join(config.toolsPath, 'whisper.exe');
  const modelPath = path.join(config.toolsPath, 'ggml-tiny.en.bin');

  if (!fs.existsSync(whisperExe) || !fs.existsSync(modelPath)) {
     return res.status(500).json({ error: 'Whisper executable or model missing. Please restart the backend.'});
  }

  try {
    // 1. Convert input file (video or audio) to 16kHz WAV mono using FFmpeg
    await new Promise((resolve, reject) => {
      const ffmpegArgs = [
        '-i', fullInputPath,
        '-ar', '16000',     // 16kHz sample rate required by whisper
        '-ac', '1',         // Mono audio required by whisper 
        '-c:a', 'pcm_s16le', // 16-bit PCM required by whisper
        '-y',               // Overwrite
        tempWavPath
      ];

      const ffmpeg = spawn(config.ffmpegPath, ffmpegArgs);
      ffmpeg.on('close', (code) => {
        if (code === 0) resolve();
        else reject(new Error(`FFmpeg audio extraction failed with code ${code}`));
      });
      ffmpeg.on('error', reject);
    });

    // 2. Run Whisper on the temporary WAV file
    await new Promise((resolve, reject) => {
       // whisper.exe -m model.bin -f input.wav -osrt
       const whisperArgs = [
         '-m', modelPath,
         '-f', tempWavPath,
         '-osrt' // Output as SRT file
       ];

       const proc = spawn(whisperExe, whisperArgs);
       
       let errorLog = '';
       proc.stderr.on('data', data => errorLog += data.toString());

       proc.on('close', (code) => {
         if (code === 0) resolve();
         else reject(new Error(`Whisper failed with code ${code}:\n${errorLog}`));
       });
       proc.on('error', reject);
    });

    // 3. Parse the SRT file to JSON
    const srtActualPath = srtOutputPath;
    
    // Sometimes whisper names the output .wav.srt depending on version, check both
    let finalSrtPath = '';
    if (fs.existsSync(`${tempWavPath}.srt`)) {
      finalSrtPath = `${tempWavPath}.srt`;
    } else if (fs.existsSync(tempWavPath.replace('.wav', '.srt'))) {
      finalSrtPath = tempWavPath.replace('.wav', '.srt');
    }

    if (!finalSrtPath) {
      throw new Error(`Whisper completed but SRT file was not found.`);
    }

    const srtContent = fs.readFileSync(finalSrtPath, 'utf8');
    const captionsJson = parseSRT(srtContent);

    // 4. Cleanup temp files asynchronously
    fs.unlink(tempWavPath, () => {});
    fs.unlink(finalSrtPath, () => {});

    // 5. Send results to frontend
    res.json({ captions: captionsJson });

  } catch (error) {
    console.error(`[Caption API] Error:`, error);
    
    // Best effort cleanup
    if (fs.existsSync(tempWavPath)) fs.unlink(tempWavPath, () => {});
    if (fs.existsSync(srtOutputPath)) fs.unlink(srtOutputPath, () => {});
    
    res.status(500).json({ error: error.message || 'Auto-captioning failed' });
  }
});

module.exports = router;
