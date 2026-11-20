const env = require('../config/env');
const logger = require('../utils/logger');
const fs = require('fs');
const path = require('path');
const { GoogleGenerativeAI } = require('@google/generative-ai');

// ─────────────────────────────────────────────────────────────────
// Model fallback chain — tries each model in order until one works
// ─────────────────────────────────────────────────────────────────
const MODELS_TO_TRY = [
  'gemini-3.6-flash',
  'gemini-3.5-flash',
  'gemini-3.5-flash-lite',
];

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

function parseGeminiJson(rawText) {
  // Strip markdown fences if Gemini wraps response in ```json ... ```
  const cleaned = rawText
    .replace(/```json\s*/gi, '')
    .replace(/```\s*/g, '')
    .trim();
  return JSON.parse(cleaned);
}

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
        const result = await model.generateContent(contentParts);
        logger.info(`VisionService: success with ${modelName}`);
        return result.response.text();
      } catch (error) {
        logger.warn(`VisionService: ${modelName} failed — ${error.message}`);
        lastError = error;
        // Always try next model regardless of error type
        continue;
      }
    }
    throw lastError || new Error('All Gemini models failed');
  }

  // ── Object Search ───────────────────────────────────────────────
  // Used by: POST /api/navigation/search  and  POST /api/vision/analyze
  // Finds a specific object in the camera frame.
  async analyzeImage(imageFile, question) {
    if (!imageFile) throw new Error('Image file is required');

    const targetObject = question || 'the requested object';

    // Build the object-search prompt, injecting the target
    const prompt = OBJECT_SEARCH_PROMPT_TEMPLATE
      ? OBJECT_SEARCH_PROMPT_TEMPLATE.replace('{{TARGET_OBJECT}}', targetObject)
      : `You are helping a visually impaired user. Find "${targetObject}" in the image.
         Return JSON: { found, target, position: {horizontal, vertical}, distance_category, location, confidence, description }
         Rules: found=true only if clearly visible. confidence<0.5 → found=false. No metric distances.`;

    try {
      const imagePart = this._buildImagePart(imageFile);
      const rawText = await this._tryModels([prompt, imagePart]);
      const parsed = parseGeminiJson(rawText);
      return validateVisionSchema(parsed);
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
    if (!imageFile) throw new Error('Image file is required');

    const prompt = ENVIRONMENT_PROMPT ||
      `You are helping a visually impaired user. Describe the scene for safe navigation.
       Prioritise: hazards first, then people, furniture, exits. Max 3 sentences.
       Return JSON: { found: true, target: "environment", position: {horizontal:"center",vertical:"center"},
                      distance_category: "unknown", location: "immediate surroundings", confidence, description }
       No metric distances. Use relative directions only.`;

    try {
      const imagePart = this._buildImagePart(imageFile);
      const rawText = await this._tryModels([prompt, imagePart]);
      const parsed = parseGeminiJson(rawText);
      return validateVisionSchema(parsed);
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
    if (!audioFile) throw new Error('Audio file is required');

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
