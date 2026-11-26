const path = require('path');
const { ConfigValidationError } = require('../utils/errors');

try {
  require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });
} catch (_) {
  // Gracefully fall back to process.env if dotenv is not installed
}

const VALID_CAMERA_MODES = new Set(['pi', 'webcam', 'usb', 'mock']);
const VALID_AUDIO_BACKENDS = new Set(['auto', 'ffplay', 'mpg123', 'powershell', 'afplay']);

const parseCliMode = (argv = process.argv) => {
  const modeArg = argv.find((arg) => arg.startsWith('--mode='));
  return modeArg ? modeArg.split('=')[1] : undefined;
};

const parseBoundedInt = (rawValue, defaultValue, min, max, fieldName) => {
  if (rawValue === undefined || rawValue === null || rawValue === '') {
    return defaultValue;
  }
  const parsed = Number(rawValue);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    throw new ConfigValidationError(`${fieldName} must be an integer between ${min} and ${max}`);
  }
  return parsed;
};

const parseBoolean = (rawValue, defaultValue) => {
  if (rawValue === undefined || rawValue === null || rawValue === '') {
    return defaultValue;
  }
  const normalized = String(rawValue).trim().toLowerCase();
  if (normalized === 'true' || normalized === '1') return true;
  if (normalized === 'false' || normalized === '0') return false;
  throw new ConfigValidationError(`Invalid boolean value: ${rawValue}`);
};

const normalizeBackendUrl = (rawUrl) => {
  const value = (rawUrl || 'http://localhost:3000').trim();
  let parsed;
  try {
    parsed = new URL(value);
  } catch (_) {
    throw new ConfigValidationError(`Invalid BACKEND_URL: "${value}"`);
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new ConfigValidationError(`BACKEND_URL must use http or https protocol (got ${parsed.protocol})`);
  }
  return parsed.toString().replace(/\/+$/, '');
};

/**
 * Loads and validates client configuration. Accepts optional overrides for testing.
 */
const loadConfig = (overrides = {}, argv = process.argv) => {
  const raw = { ...process.env, ...overrides };
  const cliMode = parseCliMode(argv);

  const BACKEND_URL = normalizeBackendUrl(raw.BACKEND_URL);
  const CAMERA_MODE = (cliMode || raw.CAMERA_MODE || 'webcam').trim().toLowerCase();
  if (!VALID_CAMERA_MODES.has(CAMERA_MODE)) {
    throw new ConfigValidationError(
      `Invalid CAMERA_MODE "${CAMERA_MODE}". Must be one of: ${Array.from(VALID_CAMERA_MODES).join(', ')}`
    );
  }

  const AUDIO_PLAYER_BACKEND = (raw.AUDIO_PLAYER_BACKEND || 'auto').trim().toLowerCase();
  if (!VALID_AUDIO_BACKENDS.has(AUDIO_PLAYER_BACKEND)) {
    throw new ConfigValidationError(
      `Invalid AUDIO_PLAYER_BACKEND "${AUDIO_PLAYER_BACKEND}". Must be one of: ${Array.from(VALID_AUDIO_BACKENDS).join(', ')}`
    );
  }

  return {
    BACKEND_URL,
    CAMERA_MODE,
    CAMERA_DEVICE: (raw.CAMERA_DEVICE || 'auto').trim(),
    IMAGE_MAX_WIDTH: parseBoundedInt(raw.IMAGE_MAX_WIDTH, 800, 320, 1920, 'IMAGE_MAX_WIDTH'),
    IMAGE_QUALITY: parseBoundedInt(raw.IMAGE_QUALITY, 75, 40, 95, 'IMAGE_QUALITY'),
    CAMERA_WARMUP_MS: parseBoundedInt(raw.CAMERA_WARMUP_MS, 500, 0, 5000, 'CAMERA_WARMUP_MS'),
    CAPTURE_TIMEOUT_MS: parseBoundedInt(raw.CAPTURE_TIMEOUT_MS, 10000, 2000, 30000, 'CAPTURE_TIMEOUT_MS'),
    REQUEST_TIMEOUT_MS: parseBoundedInt(raw.REQUEST_TIMEOUT_MS, 60000, 5000, 180000, 'REQUEST_TIMEOUT_MS'),
    AUDIO_PLAYER_ENABLED: parseBoolean(raw.AUDIO_PLAYER_ENABLED, true),
    AUDIO_PLAYER_BACKEND,
  };
};

module.exports = {
  ...loadConfig(),
  loadConfig,
  VALID_CAMERA_MODES,
  VALID_AUDIO_BACKENDS,
};
