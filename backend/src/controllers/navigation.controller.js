const aiOrchestratorService = require('../services/ai-orchestrator.service');
const logger = require('../utils/logger');

const processNavigation = async (req, res, next) => {
  try {
    const { sessionId } = req.body;
    if (!sessionId) {
      return res.status(400).json({ success: false, message: 'sessionId is required' });
    }

    const files = req.files;
    if (!files || !files.audio || !files.image) {
      return res.status(400).json({ success: false, message: 'Both audio and image files are required' });
    }

    const audioFile = files.audio[0];
    const imageFile = files.image[0];

    const result = await aiOrchestratorService.processNavigationCommand(sessionId, audioFile, imageFile);

    if (result.audioBuffer) {
      // ElevenLabs TTS succeeded — send audio with headers
      res.set('Content-Type', 'audio/mpeg');
      res.set('X-Response-Text', encodeURIComponent(result.textResponse));
      res.set('X-User-Query', encodeURIComponent(result.userQuery || ''));
      res.set('X-Navigation-Status', result.status);
      res.send(result.audioBuffer);
    } else {
      // TTS failed — send JSON so the app can use native TTS
      res.json({
        success: true,
        textResponse: result.textResponse,
        userQuery: result.userQuery,
        status: result.status,
        audioAvailable: false
      });
    }

  } catch (error) {
    logger.error('Process Navigation Error', { error: error.message });
    next(error);
  }
};

const processEnvironment = async (req, res, next) => {
  try {
    const file = req.file;
    if (!file) {
      return res.status(400).json({ success: false, message: 'Image file is required' });
    }

    const result = await aiOrchestratorService.processEnvironmentDescription(file);

    if (result.audioBuffer) {
      res.set('Content-Type', 'audio/mpeg');
      res.set('X-Response-Text', encodeURIComponent(result.textResponse));
      res.set('X-Navigation-Status', result.status);
      res.send(result.audioBuffer);
    } else {
      res.json({
        success: true,
        textResponse: result.textResponse,
        status: result.status,
        audioAvailable: false
      });
    }

  } catch (error) {
    logger.error('Process Environment Error', { error: error.message });
    next(error);
  }
};

module.exports = {
  processNavigation,
  processEnvironment
};
