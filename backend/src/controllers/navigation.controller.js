const aiOrchestratorService = require('../services/ai-orchestrator.service');
const logger = require('../utils/logger');
const response = require('../utils/response');

const processNavigation = async (req, res, next) => {
  try {
    const { sessionId } = req.body;
    if (!sessionId || typeof sessionId !== 'string' || !sessionId.trim()) {
      return response.error(res, 'sessionId is required', 400);
    }

    if (sessionId.trim().length > 128) {
      return response.error(res, 'sessionId must not exceed 128 characters', 400);
    }

    const files = req.files;
    if (!files || !files.audio || !files.image) {
      return response.error(res, 'Both audio and image files are required', 400);
    }

    const audioFile = files.audio[0];
    const imageFile = files.image[0];

    const result = await aiOrchestratorService.processNavigationCommand(sessionId.trim(), audioFile, imageFile);

    if (result.audioBuffer) {
      // ElevenLabs TTS succeeded — send audio with custom tracking headers
      return response.audio(res, result.audioBuffer, {
        'X-Response-Text': encodeURIComponent(result.textResponse),
        'X-User-Query': encodeURIComponent(result.userQuery || ''),
        'X-Navigation-Status': result.status,
      });
    } else {
      // TTS failed — send JSON so the mobile app can fall back to native TTS
      return response.success(res, {
        textResponse: result.textResponse,
        userQuery: result.userQuery,
        status: result.status,
        audioAvailable: false,
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
      return response.error(res, 'Image file is required', 400);
    }

    const result = await aiOrchestratorService.processEnvironmentDescription(file);

    if (result.audioBuffer) {
      return response.audio(res, result.audioBuffer, {
        'X-Response-Text': encodeURIComponent(result.textResponse),
        'X-Navigation-Status': result.status,
      });
    } else {
      return response.success(res, {
        textResponse: result.textResponse,
        status: result.status,
        audioAvailable: false,
      });
    }

  } catch (error) {
    logger.error('Process Environment Error', { error: error.message });
    next(error);
  }
};

module.exports = {
  processNavigation,
  processEnvironment,
};
