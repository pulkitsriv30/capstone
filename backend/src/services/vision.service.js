const env = require('../config/env');
const logger = require('../utils/logger');
const fs = require('fs');
const path = require('path');

// Safe require: graceful fallback if package is not installed (e.g. test environments)
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

// ─────────────────────────────────────────────────────────────────
// Model fallback chain — tries each model in order until one works
// ─────────────────────────────────────────────────────────────────
const MODELS_TO_TRY = [
  'gemini-3.6-flash',
  'gemini-3.5-flash',
  'gemini-3.5-flash-lite',
];

const REQUEST_TIMEOUT_MS = 30000;

// Promise timeout helper — prevents Gemini calls hanging indefinitely
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

// ─────────────────────────────────────────────────────────────────
// Load prompt templates from shared/prompts/ at startup
// ─────────────────────────────────────────────────────────────────
const PROMPTS_DIR = path.resolve(__dirname, '../../../shared/prompts');

function loadPrompt(filename) {
  try {
    return fs.readFileSync(path.join(PROMPTS_DIR, filename), 'utf8').trim();
  } catch (e) {
    logger.error(`Failed to load prompt file: ${filename}`, { error: e.message });
    return null;
  }
}

const OBJECT_SEARCH_PROMPT_TEMPLATE = loadPrompt('object-search.prompt');
const ENVIRONMENT_PROMPT = loadPrompt('environment.prompt');

// ─────────────────────────────────────────────────────────────────
// JSON schema validation — ensures Gemini returned a usable object
// ─────────────────────────────────────────────────────────────────
const REQUIRED_FIELDS = ['found', 'target', 'position', 'distance_category', 'location', 'confidence', 'description'];

function validateVisionSchema(obj) {
  const missing = REQUIRED_FIELDS.filter(f => !(f in obj));
  if (missing.length > 0) {
    throw new Error(`Gemini response missing required fields: ${missing.join(', ')}`);
  }
  if (typeof obj.found !== 'boolean') {
    throw new Error(`"found" must be boolean, got: ${typeof obj.found}`);
  }
  if (typeof obj.confidence !== 'number' || obj.confidence < 0 || obj.confidence > 1) {
    throw new Error(`"confidence" must be a number 0.0–1.0`);
  }
  // Enforce confidence threshold: low-confidence finds treated as not found
  if (obj.confidence < 0.5 && obj.found === true) {
    logger.warn('VisionService: confidence below 0.5, overriding found → false');
    obj.found = false;
  }
  return obj;
}

// Safe JSON parser with fallback envelope for Gemini responses
// Handles markdown code fences, partial JSON, and plain text responses
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

// ─────────────────────────────────────────────────────────────────
// VisionService
// ─────────────────────────────────────────────────────────────────
class VisionService {
  constructor() {
    this.genAI = new GoogleGenerativeAI(env.GEMINI_API_KEY);
  }

  // Internal: try each model in sequence until one succeeds
  async _tryModels(contentParts) {
    let lastError = null;
    for (const modelName of MODELS_TO_TRY) {
      try {
        logger.info(`VisionService: trying model ${modelName}`);
        const model = this.genAI.getGenerativeModel({ model: modelName });
        const result = await withTimeout(
          model.generateContent(contentParts),
          REQUEST_TIMEOUT_MS,
          `Gemini (${modelName})`
        );
        logger.info(`VisionService: success with model: ${modelName}`);
        return result.response.text();
      } catch (error) {
        logger.warn(`VisionService: ${modelName} failed — ${error.message}`);
        lastError = error;

        // If the error is retryable (rate limit, overload, timeout), try the next fallback model
        if (isRetryableError(error)) {
          continue;
        }

        // For non-retryable errors (e.g., 400 invalid argument, 401/403 auth), fail fast
        throw new ExternalServiceError('Gemini', error.message, 502);
      }
    }
    throw (
      lastError ||
      new ExternalServiceError('Gemini', 'All Gemini fallback models exhausted', 503)
    );
  }

  // ── Object Search ───────────────────────────────────────────────
  // Used by: POST /api/navigation/search  and  POST /api/vision/analyze
  // Finds a specific object in the camera frame.
  async analyzeImage(imageFile, question) {
    if (!imageFile) {
      throw new ValidationError('Image file is required');
    }

    const targetObject = question || 'the requested object';

    // Build the object-search prompt, injecting the target
    const prompt = OBJECT_SEARCH_PROMPT_TEMPLATE
      ? OBJECT_SEARCH_PROMPT_TEMPLATE.replace('{{TARGET_OBJECT}}', targetObject)
      : `You are an AI assistant for a visually impaired user.
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
User Question: ${targetObject}`;

    try {
      const imagePart = this._buildImagePart(imageFile);
      const rawText = await this._tryModels([prompt, imagePart]);
      return parseGeminiJSON(rawText);
    } catch (error) {
      logger.error('VisionService.analyzeImage error', { error: error.message });
      throw error;
    } finally {
      this._cleanupFile(imageFile);
    }
  }

  // ── Environment Description ──────────────────────────────────────
  // Used by: POST /api/navigation/environment
  // Describes the full scene prioritising safety hazards first.
  async describeEnvironment(imageFile) {
    if (!imageFile) throw new ValidationError('Image file is required');

    const prompt = ENVIRONMENT_PROMPT ||
      `You are helping a visually impaired user. Describe the scene for safe navigation.
       Prioritise: hazards first, then people, furniture, exits. Max 3 sentences.
       Return JSON: { found: true, target: "environment", position: {horizontal:"center",vertical:"center"},
                      distance_category: "unknown", location: "immediate surroundings", confidence, description }
       No metric distances. Use relative directions only.`;

    try {
      const imagePart = this._buildImagePart(imageFile);
      const rawText = await this._tryModels([prompt, imagePart]);
      return parseGeminiJSON(rawText);
    } catch (error) {
      logger.error('VisionService.describeEnvironment error', { error: error.message });
      throw error;
    } finally {
      this._cleanupFile(imageFile);
    }
  }

  // ── Speech-to-Text ───────────────────────────────────────────────
  // Used by: ai-orchestrator (transcribes user's voice query)
  async transcribeAudio(audioFile) {
    if (!audioFile) throw new ValidationError('Audio file is required');

    try {
      const fileBytes = fs.readFileSync(audioFile.path);
      const audioPart = {
        inlineData: {
          data: Buffer.from(fileBytes).toString('base64'),
          mimeType: audioFile.mimetype || 'audio/mp4',
        },
      };
      const rawText = await this._tryModels([
        'Please transcribe the following audio accurately. Output only the transcribed text, nothing else.',
        audioPart,
      ]);
      return rawText.trim();
    } catch (error) {
      logger.error('VisionService.transcribeAudio error', { error: error.message });
      throw error;
    } finally {
      this._cleanupFile(audioFile);
    }
  }

  // ── Helpers ──────────────────────────────────────────────────────
  _buildImagePart(imageFile) {
    const fileBytes = fs.readFileSync(imageFile.path);
    return {
      inlineData: {
        data: Buffer.from(fileBytes).toString('base64'),
        mimeType: imageFile.mimetype || 'image/jpeg',
      },
    };
  }

  _cleanupFile(file) {
    try {
      if (file && file.path && fs.existsSync(file.path)) {
        fs.unlinkSync(file.path);
      }
    } catch (e) {
      logger.warn('VisionService: failed to delete temp file', { path: file?.path });
    }
  }
}

module.exports = new VisionService();
