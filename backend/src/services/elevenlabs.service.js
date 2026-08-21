const env = require('../config/env');
const logger = require('../utils/logger');
const fs = require('fs');
const path = require('path');

class ElevenLabsService {
  async transcribeAudio(audioFile) {
    if (!audioFile) {
      throw new Error('Audio file is required');
    }

    try {
      // ElevenLabs STT API endpoint is not officially public/standardized in the same way as TTS for some older versions,
      // but assuming they have a speech-to-text endpoint /v1/speech-to-text.
      // Wait, ElevenLabs mainly provides Text-to-Speech. But they recently launched Speech-to-Text (Scribe / v1/speech-to-text).
      // We will use standard multipart form data as required by the API.

      const formData = new FormData();
      const fileBuffer = fs.readFileSync(audioFile.path);
      const blob = new Blob([fileBuffer], { type: audioFile.mimetype });
      formData.append('file', blob, audioFile.originalname);
      formData.append('model_id', 'scribe_v1'); // default STT model

      const response = await fetch('https://api.elevenlabs.io/v1/speech-to-text', {
        method: 'POST',
        headers: {
          'xi-api-key': env.ELEVENLABS_API_KEY,
        },
        body: formData,
      });

      if (!response.ok) {
        const errorText = await response.text();
        logger.error('ElevenLabs STT Error', { status: response.status, errorText });
        throw new Error(`ElevenLabs API error: ${response.statusText}`);
      }

      const data = await response.json();
      return data.text; // Assuming standard response { text: "..." }

    } catch (error) {
      logger.error('ElevenLabs Service Error', { error: error.message });
      throw error;
    } finally {
      // Cleanup the uploaded file from temp storage
      if (fs.existsSync(audioFile.path)) {
        fs.unlinkSync(audioFile.path);
      }
    }
  }

  async generateSpeech(text) {
    if (!text) {
      throw new Error('Text is required');
    }

    try {
      const voiceId = env.ELEVENLABS_VOICE_ID;
      const response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
        method: 'POST',
        headers: {
          'xi-api-key': env.ELEVENLABS_API_KEY,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          text: text,
          model_id: 'eleven_multilingual_v2',
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        logger.error('ElevenLabs TTS Error', { status: response.status, errorText });
        throw new Error(`ElevenLabs TTS API error: ${response.statusText}`);
      }

      // Return the audio buffer
      const arrayBuffer = await response.arrayBuffer();
      return Buffer.from(arrayBuffer);

    } catch (error) {
      logger.error('ElevenLabs TTS Service Error', { error: error.message });
      throw error;
    }
  }
}

module.exports = new ElevenLabsService();
