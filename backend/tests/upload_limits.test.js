const test = require('node:test');
const assert = require('node:assert');
const {
  MAX_FILE_SIZE,
  ALLOWED_IMAGE_MIMES,
  ALLOWED_AUDIO_MIMES,
} = require('../src/middleware/upload.middleware');

test('Upload Middleware - Constraints and Allowed MIME Types', () => {
  // Max file size must be 5MB
  assert.strictEqual(MAX_FILE_SIZE, 5 * 1024 * 1024);

  // Common image formats must be allowed
  assert.ok(ALLOWED_IMAGE_MIMES.has('image/jpeg'));
  assert.ok(ALLOWED_IMAGE_MIMES.has('image/jpg'));
  assert.ok(ALLOWED_IMAGE_MIMES.has('image/png'));
  assert.ok(ALLOWED_IMAGE_MIMES.has('image/webp'));

  // Disallowed image formats
  assert.strictEqual(ALLOWED_IMAGE_MIMES.has('image/gif'), false);
  assert.strictEqual(ALLOWED_IMAGE_MIMES.has('application/pdf'), false);

  // Common audio formats must be allowed
  assert.ok(ALLOWED_AUDIO_MIMES.has('audio/mp4'));
  assert.ok(ALLOWED_AUDIO_MIMES.has('audio/m4a'));
  assert.ok(ALLOWED_AUDIO_MIMES.has('audio/mpeg'));
  assert.ok(ALLOWED_AUDIO_MIMES.has('audio/wav'));
  assert.ok(ALLOWED_AUDIO_MIMES.has('audio/aac'));

  // Disallowed audio formats
  assert.strictEqual(ALLOWED_AUDIO_MIMES.has('video/mp4'), false);
  assert.strictEqual(ALLOWED_AUDIO_MIMES.has('text/plain'), false);
});

