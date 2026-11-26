const elevenlabsService = require('../services/elevenlabs.service');
const logger = require('../utils/logger');
const response = require('../utils/response');

const transcribe = async (req, res, next) => {
  try {
    if (!req.file) {
      return response.error(res, 'Audio file is required', 400);
    }

    const text = await elevenlabsService.transcribeAudio(req.file);

    return response.success(res, {
      text,
    });
  } catch (error) {
    logger.error('Transcribe Error', { error: error.message });
    next(error);
  }
};

const speak = async (req, res, next) => {
  try {
    const { text } = req.body;
    if (!text || typeof text !== 'string' || !text.trim()) {
      return response.error(res, 'Text is required', 400);
    }

    if (text.length > 5000) {
      return response.error(res, 'Text must not exceed 5000 characters', 400);
    }

    const cleanText = text.trim();
    const audioBuffer = await elevenlabsService.generateSpeech(cleanText);

    return response.audio(res, audioBuffer, {
      'X-Response-Text': encodeURIComponent(cleanText),
    });
  } catch (error) {
    logger.error('Speak Error', { error: error.message });
    next(error);
  }
};

module.exports = {
  transcribe,
  speak,
};
