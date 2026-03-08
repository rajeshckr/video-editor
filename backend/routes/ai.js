const express = require('express');
const router = express.Router();
const transcriptService = require('../services/ai/transcriptService');
const metadataService = require('../services/ai/metadataService');
const Logger = require('../utils/logger');
const logger = Logger.getInstance('AI-API');

// ─── POST /api/ai/transcript ──────────────────────────────────────────────────
/**
 * Generate transcript from a media file
 * Request body: { filename: "abc123.mp4" }
 * Response: { transcript: "...", captions: [...] }
 */
router.post('/transcript', async (req, res) => {
  const { filename } = req.body;

  if (!filename) {
    logger.error('Transcript request failed - filename missing');
    return res.status(400).json({ error: 'filename is required' });
  }

  try {
    logger.info('📝 Transcript generation requested', { filename });
    const result = await transcriptService.generateTranscript(filename);
    
    logger.info('✅ Transcript generated successfully', { 
      filename,
      captionCount: result.captions.length,
      transcriptLength: result.transcript.length
    });

    res.json(result);
  } catch (error) {
    logger.error('Transcript generation failed', { filename, error: error.message });
    res.status(500).json({ error: error.message || 'Transcript generation failed' });
  }
});

// ─── POST /api/ai/metadata ────────────────────────────────────────────────────
/**
 * Generate video metadata from transcript using OpenAI
 * Request body: { transcript: "..." }
 * Response: { title, keywords, summary }
 */
router.post('/metadata', async (req, res) => {
  const { transcript } = req.body;

  if (!transcript || typeof transcript !== 'string') {
    logger.error('Metadata request failed - transcript missing or invalid');
    return res.status(400).json({ error: 'transcript string is required' });
  }

  if (transcript.trim().length === 0) {
    logger.error('Metadata request failed - transcript empty');
    return res.status(400).json({ error: 'transcript cannot be empty' });
  }

  try {
    logger.info('🤖 Metadata generation requested', { 
      transcriptLength: transcript.length 
    });

    const metadata = await metadataService.generateVideoMetadata(transcript);

    logger.info('✅ Metadata generated successfully', {
      titleLength: metadata.title.length,
      keywordCount: metadata.keywords.length
    });

    res.json(metadata);
  } catch (error) {
    logger.error('Metadata generation failed', { error: error.message, stack: error.stack });
    
    // Handle insufficient content error (no retry needed)
    if (error.message.startsWith('INSUFFICIENT_CONTENT:')) {
      const message = error.message.replace('INSUFFICIENT_CONTENT: ', '');
      return res.status(422).json({ 
        error: 'insufficient_content',
        message: message
      });
    }
    
    // Return appropriate status code for other errors
    if (error.message.includes('OPENAI_API_KEY')) {
      return res.status(500).json({ error: 'OpenAI API key not configured' });
    }
    if (error.message.includes('OpenAI API error')) {
      return res.status(502).json({ error: 'OpenAI API communication failed' });
    }
    if (error.message.includes('invalid JSON') || error.message.includes('Invalid metadata')) {
      return res.status(502).json({ error: 'AI returned invalid format' });
    }

    res.status(500).json({ error: error.message || 'Metadata generation failed' });
  }
});

// ─── POST /api/ai/metadata-from-file ──────────────────────────────────────────
/**
 * Convenience endpoint: Generate metadata directly from a media file
 * Combines transcript generation + metadata generation
 * Request body: { filename: "abc123.mp4" }
 * Response: { title, keywords, summary, transcript, captions }
 */
router.post('/metadata-from-file', async (req, res) => {
  const { filename } = req.body;

  if (!filename) {
    logger.error('Metadata-from-file request failed - filename missing');
    return res.status(400).json({ error: 'filename is required' });
  }

  try {
    logger.info('🎬 Full AI pipeline requested', { filename });

    // Step 1: Generate transcript
    logger.info('Step 1/2: Generating transcript...');
    const transcriptResult = await transcriptService.generateTranscript(filename);

    // Step 2: Generate metadata from transcript
    logger.info('Step 2/2: Generating metadata from transcript...');
    const metadata = await metadataService.generateVideoMetadata(transcriptResult.transcript);

    logger.info('✅ Full AI pipeline completed successfully', { filename });

    res.json({
      ...metadata,
      transcript: transcriptResult.transcript,
      captions: transcriptResult.captions
    });

  } catch (error) {
    logger.error('AI pipeline failed', { filename, error: error.message, stack: error.stack });

    // Handle insufficient content error (no retry needed)
    if (error.message.startsWith('INSUFFICIENT_CONTENT:')) {
      const message = error.message.replace('INSUFFICIENT_CONTENT: ', '');
      return res.status(422).json({ 
        error: 'insufficient_content',
        message: message
      });
    }

    if (error.message.includes('File not found')) {
      return res.status(404).json({ error: `File not found: ${filename}` });
    }
    if (error.message.includes('Whisper')) {
      return res.status(500).json({ error: 'Transcript generation failed' });
    }
    if (error.message.includes('OpenAI')) {
      return res.status(502).json({ error: 'AI metadata generation failed' });
    }

    res.status(500).json({ error: error.message || 'AI pipeline failed' });
  }
});

// ─── GET /api/ai/health ───────────────────────────────────────────────────────
/**
 * Check AI service health
 */
router.get('/health', (req, res) => {
  const openaiConfigured = !!process.env.OPENAI_API_KEY;
  
  res.json({
    status: 'ok',
    services: {
      whisper: 'available',
      openai: openaiConfigured ? 'configured' : 'not configured'
    }
  });
});

module.exports = router;
