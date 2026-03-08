const express = require('express');
const router = express.Router();
const transcriptService = require('../services/ai/transcriptService');
const metadataService = require('../services/ai/metadataService');
const Logger = require('../utils/logger');
const logger = Logger.getInstance('AI-API');

function previewText(value, maxLength = 500) {
  if (typeof value !== 'string') {
    return value;
  }
  return value.length > maxLength ? `${value.slice(0, maxLength)}...` : value;
}

function logApiRequest(req, payload) {
  logger.info('➡️ API request received', {
    method: req.method,
    path: req.originalUrl,
    payload
  });
}

function logApiResponse(req, statusCode, payload) {
  logger.info('⬅️ API response sent', {
    method: req.method,
    path: req.originalUrl,
    statusCode,
    payload
  });
}

// ─── POST /api/ai/transcript ──────────────────────────────────────────────────
/**
 * Generate transcript from a media file
 * Request body: { filename: "abc123.mp4", caption: true/false (optional) }
 * Response: { transcript: "...", captions?: [...] }
 */
router.post('/transcript', async (req, res) => {
  const { filename, caption = true } = req.body;

  logApiRequest(req, { filename, caption });

  if (!filename) {
    logger.error('Transcript request failed - filename missing');
    return res.status(400).json({ error: 'filename is required' });
  }

  if (typeof caption !== 'boolean') {
    logger.error('Transcript request failed - caption must be boolean');
    return res.status(400).json({ error: 'caption must be a boolean' });
  }

  try {
    logger.info('📝 Transcript generation requested', { filename });
    const result = await transcriptService.generateTranscript(filename);
    
    logger.info('✅ Transcript generated successfully', { 
      filename,
      captionCount: result.captions.length,
      transcriptLength: result.transcript.length
    });

    const responsePayload = {
      transcript: result.transcript,
      ...(caption ? { captions: result.captions } : {})
    };

    logApiResponse(req, 200, {
      transcriptLength: result.transcript.length,
      captionCount: result.captions.length,
      includeCaptions: caption,
      transcriptPreview: previewText(result.transcript, 300)
    });
    res.json(responsePayload);
  } catch (error) {
    logger.error('Transcript generation failed', { filename, caption, error: error.message });
    logApiResponse(req, 500, { error: error.message || 'Transcript generation failed' });
    res.status(500).json({ error: error.message || 'Transcript generation failed' });
  }
});

// ─── POST /api/ai/metadata ────────────────────────────────────────────────────
/**
 * Generate video metadata from transcript using OpenAI
 * Request body: { transcript: "...", generateQuestions: true/false (optional) }
 * Response: { title, keywords, summary, questions? }
 */
router.post('/metadata', async (req, res) => {
  const { transcript, generateQuestions = false } = req.body;

  logApiRequest(req, {
    transcriptLength: typeof transcript === 'string' ? transcript.length : null,
    transcriptPreview: previewText(transcript, 300),
    generateQuestions
  });

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
      transcriptLength: transcript.length,
      generateQuestions
    });

    const metadata = await metadataService.generateVideoMetadata(transcript, { generateQuestions });

    logger.info('✅ Metadata generated successfully', {
      titleLength: metadata.title.length,
      keywordCount: metadata.keywords.length,
      hasQuestions: !!metadata.questions
    });

    logApiResponse(req, 200, {
      title: metadata.title,
      keywordCount: metadata.keywords.length,
      summaryPreview: previewText(metadata.summary, 300),
      hasQuestions: !!metadata.questions,
      questionsCount: Array.isArray(metadata.questions) ? metadata.questions.length : 0
    });
    res.json(metadata);
  } catch (error) {
    logger.error('Metadata generation failed', { error: error.message, stack: error.stack });
    
    // Handle insufficient content error (no retry needed)
    if (error.message.startsWith('INSUFFICIENT_CONTENT:')) {
      const message = error.message.replace('INSUFFICIENT_CONTENT: ', '');
      logApiResponse(req, 422, {
        error: 'insufficient_content',
        message
      });
      return res.status(422).json({ 
        error: 'insufficient_content',
        message: message
      });
    }
    
    // Return appropriate status code for other errors
    if (error.message.includes('OPENAI_API_KEY')) {
      logApiResponse(req, 500, { error: 'OpenAI API key not configured' });
      return res.status(500).json({ error: 'OpenAI API key not configured' });
    }
    if (error.message.includes('OpenAI API error')) {
      logApiResponse(req, 502, { error: 'OpenAI API communication failed' });
      return res.status(502).json({ error: 'OpenAI API communication failed' });
    }
    if (error.message.includes('invalid JSON') || error.message.includes('Invalid metadata')) {
      logApiResponse(req, 502, { error: 'AI returned invalid format' });
      return res.status(502).json({ error: 'AI returned invalid format' });
    }

    logApiResponse(req, 500, { error: error.message || 'Metadata generation failed' });
    res.status(500).json({ error: error.message || 'Metadata generation failed' });
  }
});

// ─── POST /api/ai/metadata-from-file ──────────────────────────────────────────
/**
 * Convenience endpoint: Generate metadata directly from a media file
 * Combines transcript generation + metadata generation
 * Request body: { filename: "abc123.mp4", generateQuestions: true/false (optional) }
 * Response: { title, keywords, summary, questions?, transcript, captions }
 */
router.post('/metadata-from-file', async (req, res) => {
  const { filename, generateQuestions = false } = req.body;

  logApiRequest(req, { filename, generateQuestions });

  if (!filename) {
    logger.error('Metadata-from-file request failed - filename missing');
    return res.status(400).json({ error: 'filename is required' });
  }

  try {
    logger.info('🎬 Full AI pipeline requested', { filename, generateQuestions });

    // Step 1: Generate transcript
    logger.info('Step 1/2: Generating transcript...');
    const transcriptResult = await transcriptService.generateTranscript(filename);

    // Step 2: Generate metadata from transcript
    logger.info('Step 2/2: Generating metadata from transcript...');
    const metadata = await metadataService.generateVideoMetadata(transcriptResult.transcript, { generateQuestions });

    logger.info('✅ Full AI pipeline completed successfully', { filename, hasQuestions: !!metadata.questions });

    logApiResponse(req, 200, {
      filename,
      title: metadata.title,
      keywordCount: metadata.keywords.length,
      hasQuestions: !!metadata.questions,
      questionsCount: Array.isArray(metadata.questions) ? metadata.questions.length : 0,
      transcriptLength: transcriptResult.transcript.length,
      captionCount: transcriptResult.captions.length
    });
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
      logApiResponse(req, 422, {
        error: 'insufficient_content',
        message
      });
      return res.status(422).json({ 
        error: 'insufficient_content',
        message: message
      });
    }

    if (error.message.includes('File not found')) {
      logApiResponse(req, 404, { error: `File not found: ${filename}` });
      return res.status(404).json({ error: `File not found: ${filename}` });
    }
    if (error.message.includes('Whisper')) {
      logApiResponse(req, 500, { error: 'Transcript generation failed' });
      return res.status(500).json({ error: 'Transcript generation failed' });
    }
    if (error.message.includes('OpenAI')) {
      logApiResponse(req, 502, { error: 'AI metadata generation failed' });
      return res.status(502).json({ error: 'AI metadata generation failed' });
    }

    logApiResponse(req, 500, { error: error.message || 'AI pipeline failed' });
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
