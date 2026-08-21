const elevenlabsService = require('../services/elevenlabs.service');
const logger = require('../utils/logger');

const transcribe = async (req, res, next) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, message: 'Audio file is required' });
    }

    const text = await elevenlabsService.transcribeAudio(req.file);
    
    res.json({
      success: true,
      text: text
    });
  } catch (error) {
    logger.error('Transcribe Error', { error: error.message });
    // Delegate to centralized error handler
    next(error);
  }
};

const speak = async (req, res, next) => {
  try {
    const { text } = req.body;
    if (!text) {
      return res.status(400).json({ success: false, message: 'Text is required' });
    }

    const audioBuffer = await elevenlabsService.generateSpeech(text);
    
    res.set('Content-Type', 'audio/mpeg');
    res.send(audioBuffer);
  } catch (error) {
    logger.error('Speak Error', { error: error.message });
    next(error);
  }
};

module.exports = {
  transcribe,
  speak
};
