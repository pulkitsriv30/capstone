const env = require('../config/env');
const logger = require('../utils/logger');
const fs = require('fs');
const { GoogleGenerativeAI } = require('@google/generative-ai');

const MODELS_TO_TRY = [
  'gemini-3.5-flash-lite',
  'gemini-3.5-flash',
  'gemini-3.6-flash',
];

const REQUEST_TIMEOUT = 25000;

const RETRYABLE_STATUS_CODES = [
  429,
  500,
  502,
  503,
  504,
];

class VisionService {
  constructor() {
    this.genAI = new GoogleGenerativeAI(env.GEMINI_API_KEY);
  }

  _isRetryable(error) {
    const status = error.status || error.statusCode;

    if (RETRYABLE_STATUS_CODES.includes(Number(status))) {
      return true;
    }

    const message = (error.message || '').toLowerCase();

    return (
      message.includes('timeout') ||
      message.includes('aborted') ||
      message.includes('network') ||
      message.includes('fetch failed') ||
      message.includes('econnreset') ||
      message.includes('econnrefused') ||
      message.includes('socket')
    );
  }

  async _tryModels(contentParts) {
    let lastError = null;

    for (const modelName of MODELS_TO_TRY) {
      const startTime = Date.now();

      try {
        logger.info(`Trying Gemini model: ${modelName}`);

        const model = this.genAI.getGenerativeModel(
          {
            model: modelName,
            generationConfig: {
              temperature: 0.2,
            },
          },
          {
            timeout: REQUEST_TIMEOUT,
          }
        );

        const result = await model.generateContent(contentParts);

        const responseText = result.response.text();

        logger.info('Gemini model succeeded', {
          model: modelName,
          durationMs: Date.now() - startTime,
        });

        return responseText;

      } catch (error) {
        lastError = error;

        logger.warn('Gemini model failed', {
          model: modelName,
          durationMs: Date.now() - startTime,
          status: error.status || null,
          error: error.message,
        });

        if (!this._isRetryable(error)) {
          logger.error(
            'Non-retryable Gemini error. Stopping fallback.'
          );

          throw error;
        }

        logger.info(
          `Temporary failure. Moving to next model.`
        );
      }
    }

    throw lastError || new Error('All Gemini models failed');
  }

  _parseJSON(responseText) {
    const cleaned = responseText
      .replace(/```json/gi, '')
      .replace(/```/g, '')
      .trim();

    try {
      return JSON.parse(cleaned);
    } catch (error) {
      // Attempt to extract a JSON object if Gemini
      // includes additional text around the response.
      const start = cleaned.indexOf('{');
      const end = cleaned.lastIndexOf('}');

      if (start === -1 || end === -1 || end <= start) {
        throw new Error('Gemini returned an invalid JSON response');
      }

      return JSON.parse(cleaned.substring(start, end + 1));
    }
  }

  async analyzeImage(imageFile, question) {
    if (!imageFile) {
      throw new Error('Image file is required');
    }

    try {
      const fileBytes = fs.readFileSync(imageFile.path);

      const imagePart = {
        inlineData: {
          data: fileBytes.toString('base64'),
          mimeType: imageFile.mimetype || 'image/jpeg',
        },
      };

      const prompt = `
You are an AI assistant for a visually impaired user.

Analyze the image and answer the user's question or describe the scene.

Respond ONLY with a JSON object in this exact format:

{
  "found": true,
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

If the user is asking about a specific object, determine whether
it is visible.

If it is not visible, do not invent its location.
Suggest a direction to turn in the description field.

Do not claim exact distances from a single RGB image.

User Question: ${question || 'What is in front of me?'}
`;

      const responseText = await this._tryModels([
        prompt,
        imagePart,
      ]);

      const parsedResponse = this._parseJSON(responseText);

      if (
        !parsedResponse ||
        typeof parsedResponse !== 'object' ||
        typeof parsedResponse.description !== 'string'
      ) {
        throw new Error('Gemini returned an incomplete vision response');
      }

      return parsedResponse;

    } catch (error) {
      logger.error('Vision Service Error', {
        error: error.message,
      });

      throw error;

    } finally {
      if (imageFile.path && fs.existsSync(imageFile.path)) {
        fs.unlinkSync(imageFile.path);
      }
    }
  }

  async transcribeAudio(audioFile) {
    if (!audioFile) {
      throw new Error('Audio file is required');
    }

    try {
      const fileBytes = fs.readFileSync(audioFile.path);

      const audioPart = {
        inlineData: {
          data: fileBytes.toString('base64'),
          mimeType: audioFile.mimetype || 'audio/mp4',
        },
      };

      const responseText = await this._tryModels([
        'Please transcribe the following audio accurately. Just output the text, nothing else.',
        audioPart,
      ]);

      return responseText.trim();

    } catch (error) {
      logger.error('Gemini STT Error', {
        error: error.message,
      });

      throw error;

    } finally {
      if (audioFile.path && fs.existsSync(audioFile.path)) {
        fs.unlinkSync(audioFile.path);
      }
    }
  }
}

module.exports = new VisionService();