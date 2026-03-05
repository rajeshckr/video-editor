const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const Logger = require('../utils/logger');
const logger = Logger.getInstance('Caption-API');
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
  
  logger.info('📝 Caption request received', { filePath });
  
  if (!filePath) {
    logger.error('Caption request failed - filePath missing');
    return res.status(400).json({ error: 'filePath is required' });
  }

  // Ensure filePath only traverses inside TMP
  const safeFilename = path.basename(filePath);
  const fullInputPath = path.join(config.tmpPath, 'uploads', safeFilename);

  logger.debug('Path validation', { safeFilename, fullInputPath, exists: fs.existsSync(fullInputPath) });

  if (!fs.existsSync(fullInputPath)) {
    logger.error('Caption request failed - file not found', { fullInputPath });
    return res.status(404).json({ error: 'File not found on server' });
  }

  // Define paths
  const tempWavPath = path.join(config.tmpPath, 'intermediate', `${Date.now()}_16k.wav`);
  const outputBasePath = tempWavPath.replace('.wav', '.output');
  const finalSrtPath = `${outputBasePath}.srt`;
  const whisperExe = path.join(config.toolsPath, 'whisper.exe');
  const modelPath = path.join(config.toolsPath, 'ggml-tiny.en.bin');

  logger.debug('Processing paths', { tempWavPath, outputBasePath, finalSrtPath });
  
  const whisperExeExists = fs.existsSync(whisperExe);
  const modelExists = fs.existsSync(modelPath);
  
  logger.debug('Whisper dependencies check', { whisperExe: whisperExeExists, model: modelExists });

  if (!whisperExeExists || !modelExists) {
    logger.error('Caption request failed - Whisper dependencies missing', { whisperExe: whisperExeExists, model: modelExists });
    return res.status(500).json({ error: 'Whisper executable or model missing. Please restart the backend.'});
  }

  try {
    // 1. Convert input file (video or audio) to 16kHz WAV mono using FFmpeg
    logger.info('📹 Step 1/3: Converting media to 16kHz WAV (FFmpeg)...');
    logger.time('ffmpeg-conversion');
    
    await new Promise((resolve, reject) => {
      const ffmpegArgs = [
        '-i', fullInputPath,
        '-ar', '16000',     // 16kHz sample rate required by whisper
        '-ac', '1',         // Mono audio required by whisper 
        '-c:a', 'pcm_s16le', // 16-bit PCM required by whisper
        '-y',               // Overwrite
        tempWavPath
      ];

      logger.debug('FFmpeg command', { args: ffmpegArgs });

      const ffmpeg = spawn(config.ffmpegPath, ffmpegArgs);
      
      ffmpeg.on('close', (code) => {
        if (code === 0) {
          logger.timeEnd('ffmpeg-conversion');
          logger.info('✅ Audio conversion successful');
          resolve();
        } else {
          reject(new Error(`FFmpeg audio extraction failed with code ${code}`));
        }
      });
      
      ffmpeg.on('error', (err) => {
        logger.error('FFmpeg process error', err);
        reject(err);
      });
    });

    // 2. Run Whisper on the temporary WAV file
    logger.info('🤖 Step 2/3: Running Whisper AI transcription...');
    logger.time('whisper-transcription');
    
    await new Promise((resolve, reject) => {
       // whisper.exe -m model.bin -f input.wav -of output (without extension) -osrt
       const whisperArgs = [
         '-m', modelPath,
         '-f', tempWavPath,
         '-of', outputBasePath,  // Output file path (whisper adds extension)
         '-osrt'  // Output as SRT file
       ];

       logger.debug('Whisper command', { args: whisperArgs });

       const proc = spawn(whisperExe, whisperArgs);
       
       let errorLog = '';
       proc.stderr.on('data', data => {
         const msg = data.toString();
         errorLog += msg;
         logger.debug('Whisper output', msg.trim());
       });

       proc.on('close', (code) => {
         if (code === 0) {
           logger.timeEnd('whisper-transcription');
           logger.info('✅ Whisper transcription successful');
           resolve();
         } else {
           const fullError = `Whisper failed with code ${code}:\n${errorLog}`;
           logger.error('Whisper transcription failed', fullError);
           reject(new Error(fullError));
         }
       });
       
       proc.on('error', (err) => {
         logger.error('Whisper process error', err);
         reject(err);
       });
    });

    // 3. Parse the SRT file to JSON
    logger.info('📄 Step 3/3: Parsing SRT output to JSON...');
    
    if (!fs.existsSync(finalSrtPath)) {
      logger.error('SRT file not found after Whisper', { expectedPath: finalSrtPath });
      throw new Error(`Whisper completed but SRT file was not found at ${finalSrtPath}`);
    }

    logger.debug('SRT file location verified', { finalSrtPath });

    const srtContent = fs.readFileSync(finalSrtPath, 'utf8');
    logger.debug('SRT content loaded', { size: `${srtContent.length} bytes` });
    
    const captionsJson = parseSRT(srtContent);
    logger.info(`✅ Parsing complete - ${captionsJson.length} captions extracted`);

    // 4. Cleanup temp files asynchronously
    logger.info('🧹 Cleaning up temporary files...');
    fs.unlink(tempWavPath, () => {
      logger.debug('Temp WAV deleted');
    });
    fs.unlink(finalSrtPath, () => {
      logger.debug('Temp SRT deleted');
    });

    // 5. Send results to frontend
    logger.info('📤 Sending captions to frontend', { count: captionsJson.length });
    res.json({ captions: captionsJson });

  } catch (error) {
    logger.error('Caption processing failed', error);
    
    // Best effort cleanup
    if (fs.existsSync(tempWavPath)) fs.unlink(tempWavPath, () => {
      logger.debug('Cleaned up temp WAV on error');
    });
    if (fs.existsSync(finalSrtPath)) fs.unlink(finalSrtPath, () => {
      logger.debug('Cleaned up temp SRT on error');
    });
    
    res.status(500).json({ error: error.message || 'Auto-captioning failed' });
  }
});

module.exports = router;
