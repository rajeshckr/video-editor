const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const config = require('../../config');
const Logger = require('../../utils/logger');
const logger = Logger.getInstance('TranscriptService');

/**
 * AI Transcript Service
 * Generates transcripts from media files using Whisper
 */

/**
 * Parse SRT string into JSON array
 */
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

/**
 * Convert HH:MM:SS,mmm to seconds (float)
 */
function timeStrToSeconds(timeStr) {
  const [time, ms] = timeStr.split(',');
  const [hours, minutes, seconds] = time.split(':').map(Number);
  return (hours * 3600) + (minutes * 60) + seconds + (Number(ms) / 1000);
}

/**
 * Convert captions array to plain text transcript
 */
function captionsToTranscript(captions) {
  return captions.map(c => c.text).join(' ');
}

/**
 * Generate transcript from media file using Whisper
 * @param {string} filename - Name of the file in uploads directory
 * @returns {Promise<Object>} { transcript: string, captions: Array }
 */
async function generateTranscript(filename) {
  logger.info('📝 Generating transcript from file', { filename });

  // Validate filename for security (no path traversal)
  const safeFilename = path.basename(filename);
  const fullInputPath = path.join(config.tmpPath, 'renders', safeFilename);

  logger.debug('Path resolution', { safeFilename, fullInputPath });

  if (!fs.existsSync(fullInputPath)) {
    logger.error('File not found', { safeFilename, searchedPath: fullInputPath });
    throw new Error(`File not found: ${safeFilename}`);
  }

  // Check if we have cached transcript
  const cacheKey = `${safeFilename}_transcript.json`;
  const cachePath = path.join(config.tmpPath, 'intermediate', cacheKey);

  if (fs.existsSync(cachePath)) {
    try {
      const cached = JSON.parse(fs.readFileSync(cachePath, 'utf8'));
      logger.info('✅ Using cached transcript', { filename: safeFilename });
      return cached;
    } catch (err) {
      logger.warn('Failed to read cached transcript, regenerating', err);
    }
  }

  // Define paths for Whisper processing
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
    logger.error('Whisper dependencies missing', { whisperExe: whisperExeExists, model: modelExists });
    throw new Error('Whisper executable or model missing. Please restart the backend.');
  }

  try {
    // Step 1: Convert media to 16kHz WAV using FFmpeg
    logger.info('📹 Converting media to 16kHz WAV (FFmpeg)...');
    logger.time('ffmpeg-conversion');

    await new Promise((resolve, reject) => {
      const ffmpegArgs = [
        '-i', fullInputPath,
        '-ar', '16000',
        '-ac', '1',
        '-c:a', 'pcm_s16le',
        '-y',
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
          reject(new Error(`FFmpeg failed with code ${code}`));
        }
      });

      ffmpeg.on('error', (err) => {
        logger.error('FFmpeg process error', err);
        reject(err);
      });
    });

    // Step 2: Run Whisper transcription
    logger.info('🤖 Running Whisper AI transcription...');
    logger.time('whisper-transcription');

    await new Promise((resolve, reject) => {
      const whisperArgs = [
        '-m', modelPath,
        '-f', tempWavPath,
        '-of', outputBasePath,
        '-osrt'
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

    // Step 3: Parse SRT file
    logger.info('📄 Parsing SRT output to JSON...');

    if (!fs.existsSync(finalSrtPath)) {
      logger.error('SRT file not found after Whisper', { expectedPath: finalSrtPath });
      throw new Error(`Whisper completed but SRT file was not found at ${finalSrtPath}`);
    }

    const srtContent = fs.readFileSync(finalSrtPath, 'utf8');
    logger.debug('SRT content loaded', { size: `${srtContent.length} bytes` });

    const captions = parseSRT(srtContent);
    const transcript = captionsToTranscript(captions);

    logger.info(`✅ Parsing complete - ${captions.length} captions extracted`);

    // Cache the result
    const result = { transcript, captions };
    try {
      fs.writeFileSync(cachePath, JSON.stringify(result, null, 2), 'utf8');
      logger.debug('Transcript cached', { cachePath });
    } catch (err) {
      logger.warn('Failed to cache transcript', err);
    }

    // Cleanup temp files
    logger.info('🧹 Cleaning up temporary files...');
    fs.unlink(tempWavPath, () => logger.debug('Temp WAV deleted'));
    fs.unlink(finalSrtPath, () => logger.debug('Temp SRT deleted'));

    return result;

  } catch (error) {
    logger.error('Transcript generation failed', error);

    // Cleanup on error
    if (fs.existsSync(tempWavPath)) {
      fs.unlink(tempWavPath, () => logger.debug('Cleaned up temp WAV on error'));
    }
    if (fs.existsSync(finalSrtPath)) {
      fs.unlink(finalSrtPath, () => logger.debug('Cleaned up temp SRT on error'));
    }

    throw error;
  }
}

module.exports = {
  generateTranscript,
  captionsToTranscript
};
