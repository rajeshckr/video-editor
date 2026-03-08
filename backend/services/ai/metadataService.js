const Logger = require('../../utils/logger');
const logger = Logger.getInstance('MetadataService');
const { loadPrompt } = require('../../utils/promptLoader');

/**
 * AI Metadata Generation Service
 * Uses OpenAI to generate video metadata from transcript
 */

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const OPENAI_MODEL = 'gpt-4o-mini'; // Using gpt-4o-mini (gpt-5-mini doesn't exist yet)
const OPENAI_API_URL = 'https://api.openai.com/v1/chat/completions';

/**
 * Generate video metadata from transcript using OpenAI
 * @param {string} transcript - Full transcript text
 * @returns {Promise<Object>} Metadata object with title, keywords, summary
 */
async function generateVideoMetadata(transcript) {
  if (!OPENAI_API_KEY) {
    throw new Error('OPENAI_API_KEY not configured in .env');
  }

  if (!transcript || transcript.trim().length === 0) {
    throw new Error('Transcript cannot be empty');
  }

  // Trim very long transcripts to avoid token/cost issues (keep ~4000 words max)
  const words = transcript.split(/\s+/);
  const trimmedTranscript = words.length > 4000 
    ? words.slice(0, 4000).join(' ') + '...'
    : transcript;

  logger.info('Generating metadata from transcript', { 
    transcriptLength: transcript.length,
    wordCount: words.length,
    trimmed: words.length > 4000
  });

  // Load prompt template from filesystem
  const prompt = loadPrompt('metadata-generation', {
    transcript: trimmedTranscript
  });

  try {
    logger.time('openai-api-call');
    
    const response = await fetch(OPENAI_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${OPENAI_API_KEY}`
      },
      body: JSON.stringify({
        model: OPENAI_MODEL,
        messages: [
          {
            role: 'system',
            content: 'You are a helpful assistant that generates video metadata. Always respond with valid JSON only, no markdown formatting.'
          },
          {
            role: 'user',
            content: prompt
          }
        ],
        temperature: 0.7,
        max_tokens: 800,
        response_format: { type: 'json_object' }
      })
    });

    logger.timeEnd('openai-api-call');

    if (!response.ok) {
      const errorText = await response.text();
      logger.error('OpenAI API error', { status: response.status, error: errorText });
      throw new Error(`OpenAI API error: ${response.status} - ${errorText}`);
    }

    const data = await response.json();
    
    // Log token usage
    if (data.usage) {
      logger.info('OpenAI token usage', {
        prompt_tokens: data.usage.prompt_tokens,
        completion_tokens: data.usage.completion_tokens,
        total_tokens: data.usage.total_tokens
      });
    }

    // Extract the response content
    const aiResponse = data.choices?.[0]?.message?.content;
    if (!aiResponse) {
      throw new Error('No response content from OpenAI');
    }

    // Parse JSON response
    let metadata;
    try {
      // Remove markdown code blocks if present
      const cleanedResponse = aiResponse.replace(/```json\s*|\s*```/g, '').trim();
      metadata = JSON.parse(cleanedResponse);
    } catch (parseError) {
      logger.error('Failed to parse OpenAI response as JSON', { response: aiResponse });
      throw new Error('OpenAI returned invalid JSON format');
    }

    // Check if AI returned an error due to insufficient content
    if (metadata.error) {
      const errorMessage = metadata.message || 'Transcript does not contain enough meaningful content for metadata generation';
      logger.warn('AI reported insufficient content', { 
        errorType: metadata.error, 
        message: errorMessage 
      });
      throw new Error(`INSUFFICIENT_CONTENT: ${errorMessage}`);
    }

    // Validate response structure
    const validation = validateMetadata(metadata);
    if (!validation.valid) {
      logger.error('Metadata validation failed', { errors: validation.errors, metadata });
      
      // If validation fails, try one more time with stricter prompt
      if (validation.retryable) {
        logger.info('Retrying with stricter prompt...');
        return await retryWithStricterPrompt(transcript, validation.errors);
      }
      
      throw new Error(`Invalid metadata format: ${validation.errors.join(', ')}`);
    }

    // Return only fields used by frontend to keep API stable and concise.
    const normalizedMetadata = {
      title: metadata.title,
      keywords: metadata.keywords,
      summary: metadata.summary,
    };

    logger.info('✅ Metadata generated successfully');
    return normalizedMetadata;

  } catch (error) {
    logger.error('Metadata generation failed', error);
    throw error;
  }
}

/**
 * Validate metadata structure and constraints
 * @param {Object} metadata 
 * @returns {Object} { valid: boolean, errors: string[], retryable: boolean }
 */
function validateMetadata(metadata) {
  const errors = [];

  if (!metadata || typeof metadata !== 'object') {
    return { valid: false, errors: ['Metadata is not an object'], retryable: false };
  }

  // Validate title
  if (!metadata.title || typeof metadata.title !== 'string') {
    errors.push('title missing or not a string');
  } else if (metadata.title.length > 80) {
    errors.push(`title too long (${metadata.title.length} > 80 chars)`);
  }

  // Validate keywords
  if (!Array.isArray(metadata.keywords)) {
    errors.push('keywords missing or not an array');
  } else if (metadata.keywords.length !== 10) {
    errors.push(`keywords array length incorrect (${metadata.keywords.length}, expected 10)`);
  } else if (!metadata.keywords.every(k => typeof k === 'string' && k.length > 0)) {
    errors.push('keywords contain invalid entries');
  }

  // Validate summary
  if (!metadata.summary || typeof metadata.summary !== 'string') {
    errors.push('summary missing or not a string');
  } else {
    const sentences = metadata.summary.split(/[.!?]+/).filter(s => s.trim().length > 0);
    if (sentences.length < 2 || sentences.length > 3) {
      errors.push(`summary sentence count incorrect (${sentences.length}, expected 2-3)`);
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    retryable: errors.length > 0 && errors.length < 4 // Only retry if not completely broken
  };
}

/**
 * Retry with a stricter prompt emphasizing the failed validation rules
 * @param {string} transcript 
 * @param {string[]} validationErrors 
 * @returns {Promise<Object>}
 */
async function retryWithStricterPrompt(transcript, validationErrors) {
  logger.warn('Retrying metadata generation with stricter constraints', { previousErrors: validationErrors });

  const words = transcript.split(/\s+/);
  const trimmedTranscript = words.length > 4000 
    ? words.slice(0, 4000).join(' ') + '...'
    : transcript;

  // Load retry prompt template from filesystem
  const strictPrompt = loadPrompt('metadata-generation-retry', {
    transcript: trimmedTranscript,
    errors: validationErrors.join('\n')
  });

  const response = await fetch(OPENAI_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${OPENAI_API_KEY}`
    },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      messages: [
        {
          role: 'system',
          content: 'You are a precise assistant. Follow the requirements exactly. Return only valid JSON, no markdown.'
        },
        {
          role: 'user',
          content: strictPrompt
        }
      ],
      temperature: 0.3, // Lower temperature for more precise output
      max_tokens: 800,
      response_format: { type: 'json_object' }
    })
  });

  if (!response.ok) {
    throw new Error(`OpenAI retry failed: ${response.status}`);
  }

  const data = await response.json();
  const aiResponse = data.choices?.[0]?.message?.content;
  
  if (!aiResponse) {
    throw new Error('No response content from OpenAI on retry');
  }

  const cleanedResponse = aiResponse.replace(/```json\s*|\s*```/g, '').trim();
  const metadata = JSON.parse(cleanedResponse);

  const validation = validateMetadata(metadata);
  if (!validation.valid) {
    throw new Error(`Retry failed validation: ${validation.errors.join(', ')}`);
  }

  logger.info('✅ Retry successful');
  return metadata;
}

module.exports = {
  generateVideoMetadata
};
