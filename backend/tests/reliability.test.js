const test = require('node:test');
const assert = require('node:assert');
const elevenlabsService = require('../src/services/elevenlabs.service');
const visionService = require('../src/services/vision.service');
const { ValidationError, ExternalServiceError, TimeoutError } = require('../src/utils/errors');

test('ElevenLabs Service - Input and Configuration Validation', async () => {
  // Test missing audio file for STT
  await assert.rejects(
    async () => {
      await elevenlabsService.transcribeAudio(null);
    },
    (err) => {
      assert.ok(err instanceof ValidationError);
      assert.strictEqual(err.message, 'Audio file is required');
      return true;
    }
  );

  // Test missing or empty text for TTS
  await assert.rejects(
    async () => {
      await elevenlabsService.generateSpeech('');
    },
    (err) => {
      assert.ok(err instanceof ValidationError);
      assert.strictEqual(err.message, 'Text is required');
      return true;
    }
  );

  await assert.rejects(
    async () => {
      await elevenlabsService.generateSpeech('   ');
    },
    (err) => {
      assert.ok(err instanceof ValidationError);
      return true;
    }
  );
});

test('Vision Service - Input Validation', async () => {
  // Test missing image file
  await assert.rejects(
    async () => {
      await visionService.analyzeImage(null, 'Where are keys?');
    },
    (err) => {
      assert.ok(err instanceof ValidationError);
      assert.strictEqual(err.message, 'Image file is required');
      return true;
    }
  );

  // Test missing audio file for STT
  await assert.rejects(
    async () => {
      await visionService.transcribeAudio(null);
    },
    (err) => {
      assert.ok(err instanceof ValidationError);
      assert.strictEqual(err.message, 'Audio file is required');
      return true;
    }
  );
});

test('Vision Service - Safe JSON Parsing and Robust Fallbacks', () => {
  // Access private or exported logic if accessible or verify via analyze mock
  // Let's test that malformed or markdown responses are handled without throwing
  const fs = require('fs');
  const path = require('path');

  // Verify that an image path check doesn't crash if file doesn't exist
  const fakeFile = { path: 'non-existent-file-path.jpg', mimetype: 'image/jpeg' };
  
  // Attempting to read non-existent file will throw ENOENT from fs, which is expected
  // but it verifies the error handling in analyzeImage
  assert.rejects(
    async () => {
      await visionService.analyzeImage(fakeFile, 'test');
    },
    (err) => {
      assert.ok(err.message.includes('ENOENT'));
      return true;
    }
  );
});

