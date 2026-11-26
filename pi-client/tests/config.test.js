const test = require('node:test');
const assert = require('node:assert');
const { loadConfig } = require('../src/config/env');
const { ConfigValidationError } = require('../src/utils/errors');

test('Config - Defaults and URL Normalization', () => {
  const cfg = loadConfig(
    { BACKEND_URL: 'http://192.168.1.45:3000///', CAMERA_MODE: 'pi' },
    ['node', 'index.js']
  );

  assert.strictEqual(cfg.BACKEND_URL, 'http://192.168.1.45:3000');
  assert.strictEqual(cfg.CAMERA_MODE, 'pi');
  assert.strictEqual(cfg.IMAGE_MAX_WIDTH, 800);
  assert.strictEqual(cfg.IMAGE_QUALITY, 75);
  assert.strictEqual(cfg.REQUEST_TIMEOUT_MS, 60000);
  assert.strictEqual(cfg.AUDIO_PLAYER_ENABLED, true);
});

test('Config - CLI --mode Flag Overrides Env', () => {
  const cfg = loadConfig(
    { CAMERA_MODE: 'pi' },
    ['node', 'index.js', '--mode=mock']
  );
  assert.strictEqual(cfg.CAMERA_MODE, 'mock');
});

test('Config - Validation Rejects Invalid URLs, Modes, and Bounds', () => {
  assert.throws(
    () => loadConfig({ BACKEND_URL: 'not-a-url' }, ['node', 'index.js']),
    (err) => err instanceof ConfigValidationError
  );

  assert.throws(
    () => loadConfig({ BACKEND_URL: 'ftp://192.168.1.10:3000' }, ['node', 'index.js']),
    (err) => err instanceof ConfigValidationError
  );

  assert.throws(
    () => loadConfig({ CAMERA_MODE: 'invalid-driver' }, ['node', 'index.js']),
    (err) => err instanceof ConfigValidationError
  );

  assert.throws(
    () => loadConfig({ IMAGE_MAX_WIDTH: '9999' }, ['node', 'index.js']),
    (err) => err instanceof ConfigValidationError
  );
});
