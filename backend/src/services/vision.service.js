const env = require('../config/env');
const logger = require('../utils/logger');
const fs = require('fs');
const { GoogleGenerativeAI } = require('@google/generative-ai');

// Ordered list of models to try — if one is overloaded, fall through to next
const MODELS_TO_TRY = [
  'gemini-3.6-flash',
  'gemini-3.5-flash',
  'gemini-3.5-flash-lite',
];

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
        const result = await model.generateContent(contentParts);
        logger.info(`Success with model: ${modelName}`);
        return result.response.text();
      } catch (error) {
        logger.warn(`Model ${modelName} failed: ${error.message}`);
        lastError = error;
        // If it's a 503 or 429 (rate limit), try next model
        if (error.message.includes('503') || error.message.includes('429') || error.message.includes('overloaded') || error.message.includes('Unavailable')) {
          continue;
        }
        // For other errors (400 bad request, etc.), also try next model
        continue;
      }
    }
    throw lastError || new Error('All Gemini models failed');
  }

  async analyzeImage(imageFile, question) {
    if (!imageFile) {
      throw new Error('Image file is required');
    }

    try {
      const fileBytes = fs.readFileSync(imageFile.path);
      const mimeType = imageFile.mimetype;
      
      const imagePart = {
        inlineData: {
          data: Buffer.from(fileBytes).toString("base64"),
          mimeType
        }
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
User Question: ${question || "What is in front of me?"}
`;

      const responseText = await this._tryModels([prompt, imagePart]);
      
      // Clean up markdown if Gemini returns it
      let jsonStr = responseText.replace(/```json/g, '').replace(/```/g, '').trim();
      return JSON.parse(jsonStr);

    } catch (error) {
      logger.error('Vision Service Error', { error: error.message });
      throw error;
    } finally {
      if (fs.existsSync(imageFile.path)) {
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
      const mimeType = audioFile.mimetype || 'audio/mp4';
      
      const audioPart = {
        inlineData: {
          data: Buffer.from(fileBytes).toString("base64"),
          mimeType
        }
      };

      const responseText = await this._tryModels([
        "Please transcribe the following audio accurately. Just output the text, nothing else.", 
        audioPart
      ]);
      
      return responseText.trim();
    } catch (error) {
      logger.error('Gemini STT Error', { error: error.message });
      throw error;
    } finally {
      if (fs.existsSync(audioFile.path)) {
        fs.unlinkSync(audioFile.path);
      }
    }
  }
}

module.exports = new VisionService();
