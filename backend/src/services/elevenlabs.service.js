const env = require('../config/env');
const logger = require('../utils/logger');
const fs = require('fs');
const { TimeoutError, ExternalServiceError, ValidationError } = require('../utils/errors');

const REQUEST_TIMEOUT_MS = 30000;

class ElevenLabsService {
  async transcribeAudio(audioFile) {
    if (!audioFile) {
      throw new ValidationError('Audio file is required');
    }

    if (!env.ELEVENLABS_API_KEY) {
      throw new ExternalServiceError('ElevenLabs', 'ELEVENLABS_API_KEY is not configured', 500);
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    try {
      const formData = new FormData();
      const fileBuffer = fs.readFileSync(audioFile.path);
      const blob = new Blob([fileBuffer], { type: audioFile.mimetype || 'audio/mp4' });
      formData.append('file', blob, audioFile.originalname || 'recording.m4a');
      formData.append('model_id', 'scribe_v1'); // default STT model

      const response = await fetch('https://api.elevenlabs.io/v1/speech-to-text', {
        method: 'POST',
        headers: {
          'xi-api-key': env.ELEVENLABS_API_KEY,
        },
        body: formData,
        signal: controller.signal,
      });

      if (!response.ok) {
        const errorText = await response.text();
        logger.error('ElevenLabs STT Error', { status: response.status, errorText });
        const statusCode = response.status === 429 ? 429 : 502;
        throw new ExternalServiceError('ElevenLabs STT', `API error (${response.status}): ${response.statusText}`, statusCode);
      }

      const data = await response.json();
      return data.text;

    } catch (error) {
      if (error.name === 'AbortError') {
        logger.error('ElevenLabs STT Timeout');
        throw new TimeoutError('ElevenLabs STT');
      }
      logger.error('ElevenLabs STT Service Error', { error: error.message });
      throw error;
    } finally {
      clearTimeout(timeoutId);
      if (audioFile && audioFile.path && fs.existsSync(audioFile.path)) {
        try {
          fs.unlinkSync(audioFile.path);
        } catch (cleanupErr) {
          logger.warn('Failed to delete temp audio file', { path: audioFile.path, error: cleanupErr.message });
        }
      }
    }
  }

  async generateSpeech(text) {
    if (!text || typeof text !== 'string' || !text.trim()) {
      throw new ValidationError('Text is required');
    }

    if (!env.ELEVENLABS_API_KEY) {
      throw new ExternalServiceError('ElevenLabs', 'ELEVENLABS_API_KEY is not configured', 500);
    }

    const voiceId = env.ELEVENLABS_VOICE_ID;
    if (!voiceId) {
      throw new ExternalServiceError('ElevenLabs', 'ELEVENLABS_VOICE_ID is not configured', 500);
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    try {
      const response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
        method: 'POST',
        headers: {
          'xi-api-key': env.ELEVENLABS_API_KEY,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          text: text.trim(),
          model_id: 'eleven_multilingual_v2',
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        const errorText = await response.text();
        logger.error('ElevenLabs TTS Error', { status: response.status, errorText });
        const statusCode = response.status === 429 ? 429 : 502;
        throw new ExternalServiceError('ElevenLabs TTS', `API error (${response.status}): ${response.statusText}`, statusCode);
      }

      const arrayBuffer = await response.arrayBuffer();
      return Buffer.from(arrayBuffer);

    } catch (error) {
      if (error.name === 'AbortError') {
        logger.error('ElevenLabs TTS Timeout');
        throw new TimeoutError('ElevenLabs TTS');
      }
      logger.error('ElevenLabs TTS Service Error', { error: error.message });
      throw error;
    } finally {
      clearTimeout(timeoutId);
    }
  }
}

module.exports = new ElevenLabsService();
