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
    logger.info('Starting environment description');

    // Step 1: Gemini Vision
    const visionResult = await visionService.analyzeImage(
      imageFile,
      'Describe the immediate environment and any obstacles.'
    );

    logger.info('Environment vision analysis completed');

    // Step 2: Navigation decision
    const decision = navigationService.describeEnvironment(
      visionResult
    );

    // Step 3: ElevenLabs TTS
    let audioResponseBuffer = null;

    try {
      audioResponseBuffer = await elevenlabsService.generateSpeech(
        decision.response
      );
    } catch (ttsError) {
      logger.warn('ElevenLabs TTS failed', {
        error: ttsError.message,
      });
    }

    return {
      status: decision.status,
      textResponse: decision.response,
      audioBuffer: audioResponseBuffer,
    };

  } catch (error) {
    logger.error('Orchestrator Error (Environment)', {
      error: error.message,
    });

    throw error;
  }
  }
}

module.exports = new AIOrchestratorService();
