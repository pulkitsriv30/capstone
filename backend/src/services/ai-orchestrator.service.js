const elevenlabsService = require('./elevenlabs.service');
const visionService = require('./vision.service');
const navigationService = require('./navigation.service');
const logger = require('../utils/logger');
const fs = require('fs');

class AIOrchestratorService {
  async processNavigationCommand(sessionId, audioFile, imageFile) {
    try {
      // Step 1: STT using Gemini (with automatic model fallback)
      const userQuery = await visionService.transcribeAudio(audioFile);
      logger.info('User query transcribed', { userQuery });

      // Step 2: Vision Analysis (with automatic model fallback)
      const visionResult = await visionService.analyzeImage(imageFile, userQuery);
      logger.info('Vision analysis complete', { visionResult });

      // Step 3: Navigation Decision
      const decision = navigationService.decideNextAction(sessionId, visionResult);
      logger.info('Navigation decision', { decision });

      // Step 4: TTS — try ElevenLabs, fall back to returning text only
      let audioResponseBuffer = null;
      try {
        audioResponseBuffer = await elevenlabsService.generateSpeech(decision.response);
      } catch (ttsError) {
        logger.warn('ElevenLabs TTS failed, returning text-only response', { error: ttsError.message });
      }

      return {
        status: decision.status,
        textResponse: decision.response,
        userQuery: userQuery,
        audioBuffer: audioResponseBuffer
      };

    } catch (error) {
      logger.error('Orchestrator Error (Navigation)', { error: error.message });
      throw error;
    }
  }

  async processEnvironmentDescription(imageFile) {
    try {
      // Step 1: Environment description using the dedicated safety-first prompt
      const visionResult = await visionService.describeEnvironment(imageFile);
      
      // Step 2: Navigation Decision (Environment)
      const decision = navigationService.describeEnvironment(visionResult);

      // Step 3: TTS — try ElevenLabs, fall back to text only
      let audioResponseBuffer = null;
      try {
        audioResponseBuffer = await elevenlabsService.generateSpeech(decision.response);
      } catch (ttsError) {
        logger.warn('ElevenLabs TTS failed, returning text-only response', { error: ttsError.message });
      }

      return {
        status: decision.status,
        textResponse: decision.response,
        audioBuffer: audioResponseBuffer
      };

    } catch (error) {
      logger.error('Orchestrator Error (Environment)', { error: error.message });
      throw error;
    } finally {
        if (imageFile && fs.existsSync(imageFile.path)) {
            fs.unlinkSync(imageFile.path);
        }
    }
  }
}

module.exports = new AIOrchestratorService();
