const env = require('../config/env');
const logger = require('../utils/logger');
const fs = require('fs');
let GoogleGenerativeAI;
try {
  ({ GoogleGenerativeAI } = require('@google/generative-ai'));
} catch (_) {
  GoogleGenerativeAI = class {
    constructor() {}
    getGenerativeModel() {
      throw new Error('@google/generative-ai is not installed');
    }
  };
}
const { TimeoutError, ExternalServiceError, ValidationError } = require('../utils/errors');

// Ordered list of models to try — if one is overloaded, fall through to next
const MODELS_TO_TRY = [
  'gemini-3.6-flash',
  'gemini-3.5-flash',
  'gemini-3.5-flash-lite',
];

const REQUEST_TIMEOUT_MS = 30000;

// Promise timeout helper
const withTimeout = (promise, ms, serviceName = 'Gemini') => {
  let timer;
  const timeoutPromise = new Promise((_, reject) => {
    timer = setTimeout(() => {
      reject(new TimeoutError(serviceName));
    }, ms);
  });
  return Promise.race([promise, timeoutPromise]).finally(() => {
    clearTimeout(timer);
  });
};

// Safe JSON parser with fallback envelope for Gemini responses
const parseGeminiJSON = (rawText) => {
  if (!rawText || typeof rawText !== 'string') {
    return {
      found: false,
      target: 'unknown',
      position: { horizontal: 'center', vertical: 'center' },
      distance_category: 'unknown',
      location: 'unknown',
      confidence: 0.0,
      description: 'Unable to analyze image.',
    };
  }

  // 1. Remove markdown code fences if present
  let cleaned = rawText.replace(/```json/gi, '').replace(/```/g, '').trim();

  // Try direct parse
  try {
    return JSON.parse(cleaned);
  } catch (_) {
    // 2. Extract JSON object substring between { ... }
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (match) {
      try {
        return JSON.parse(match[0]);
      } catch (_) {}
    }

    // 3. Fallback: wrap raw response text into standard schema to preserve user feedback
    logger.warn('Gemini output was not valid JSON, returning fallback envelope', {
      rawSnippet: rawText.substring(0, 120),
    });

    return {
      found: false,
      target: 'unknown',
      position: { horizontal: 'center', vertical: 'center' },
      distance_category: 'unknown',
      location: 'unknown',
      confidence: 0.5,
      description: cleaned.substring(0, 300) || 'Scene analyzed, but detailed structured data was unavailable.',
    };
  }
};

// Determines if an error from Gemini is retryable with another model
const isRetryableError = (error) => {
  const msg = (error.message || '').toLowerCase();
  return (
    msg.includes('503') ||
    msg.includes('429') ||
    msg.includes('overloaded') ||
    msg.includes('unavailable') ||
    msg.includes('rate limit') ||
    msg.includes('quota') ||
    msg.includes('resource_exhausted') ||
    msg.includes('timeout') ||
    msg.includes('econnreset') ||
    msg.includes('fetch failed')
  );
};

class VisionService {
  constructor() {
    this.genAI = new GoogleGenerativeAI(env.GEMINI_API_KEY);
  }

  // Helper: try each model in sequence until one works
  async _tryModels(contentParts) {
    let lastError = null;
    for (const modelName of MODELS_TO_TRY) {
      try {
        logger.info(`Trying model: ${modelName}`);
        const model = this.genAI.getGenerativeModel({ model: modelName });
        const result = await withTimeout(
          model.generateContent(contentParts),
          REQUEST_TIMEOUT_MS,
          `Gemini (${modelName})`
        );
        logger.info(`Success with model: ${modelName}`);
        return result.response.text();
      } catch (error) {
        logger.warn(`Model ${modelName} failed: ${error.message}`);
        lastError = error;

        // If the error is retryable (rate limit, overload, timeout), try the next fallback model
        if (isRetryableError(error)) {
          continue;
        }

        // For non-retryable errors (e.g., 400 invalid argument, 401/403 auth), fail fast immediately
        throw new ExternalServiceError('Gemini', error.message, 502);
      }
    }
    throw (
      lastError ||
      new ExternalServiceError('Gemini', 'All Gemini fallback models exhausted', 503)
    );
  }

  async analyzeImage(imageFile, question) {
    if (!imageFile) {
      throw new ValidationError('Image file is required');
    }

    try {
      const fileBytes = fs.readFileSync(imageFile.path);
      const mimeType = imageFile.mimetype || 'image/jpeg';

      const imagePart = {
        inlineData: {
          data: Buffer.from(fileBytes).toString('base64'),
          mimeType,
        },
      };

      const prompt = `
You are an AI assistant for a visually impaired user. 
Analyze the image and answer the user's question or describe the scene.
Respond ONLY with a JSON object in this exact format (do not include markdown blocks):
{
  "found": true/false,
  "target": "object name (if searching)",
  "position": {
    "horizontal": "left/center/right",
    "vertical": "top/center/bottom"
  },
  "distance_category": "very_close/near/medium/far/unknown",
  "location": "brief description of where it is",
  "confidence": 0.95,
  "description": "Short spoken description for the user."
}

If the user is asking about a specific object, determine if it is visible. If not, suggest a direction to turn in the "description" field.
User Question: ${question || 'What is in front of me?'}
`;

      const responseText = await this._tryModels([prompt, imagePart]);
      return parseGeminiJSON(responseText);

    } catch (error) {
      logger.error('Vision Service Error', { error: error.message });
      throw error;
    } finally {
      if (imageFile && imageFile.path && fs.existsSync(imageFile.path)) {
        try {
          fs.unlinkSync(imageFile.path);
        } catch (cleanupErr) {
          logger.warn('Failed to delete temp image file', { path: imageFile.path, error: cleanupErr.message });
        }
      }
    }
  }

  async transcribeAudio(audioFile) {
    if (!audioFile) {
      throw new ValidationError('Audio file is required');
    }

    try {
      const fileBytes = fs.readFileSync(audioFile.path);
      const mimeType = audioFile.mimetype || 'audio/mp4';

      const audioPart = {
        inlineData: {
          data: Buffer.from(fileBytes).toString('base64'),
          mimeType,
        },
      };

      const responseText = await this._tryModels([
        'Please transcribe the following audio accurately. Just output the text, nothing else.',
        audioPart,
      ]);

      return responseText.trim();
    } catch (error) {
      logger.error('Gemini STT Error', { error: error.message });
      throw error;
    } finally {
      if (audioFile && audioFile.path && fs.existsSync(audioFile.path)) {
        try {
          fs.unlinkSync(audioFile.path);
        } catch (cleanupErr) {
          logger.warn('Failed to delete temp audio file', { path: audioFile.path, error: cleanupErr.message });
        }
      }
    }
  }
}

module.exports = new VisionService();
