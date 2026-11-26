const path = require('path');
const { ConfigValidationError } = require('../../utils/errors');

try {
  require('dotenv').config({ path: path.resolve(__dirname, '../../../.env') });
} catch (_) {
  // Fall back to process.env if dotenv is not installed
}

const VALID_GPS_MODES = new Set(['serial', 'mock', 'off']);
const VALID_MOCK_SCENARIOS = new Set(['walk', 'static', 'no_fix', 'signal_loss', 'silent']);
const VALID_BAUD_RATES = new Set([4800, 9600, 19200, 38400, 57600, 115200]);

const parseBoundedNumber = (rawValue, defaultValue, min, max, fieldName, integer = true) => {
  if (rawValue === undefined || rawValue === null || rawValue === '') return defaultValue;
  const parsed = Number(rawValue);
  if (!Number.isFinite(parsed) || (integer && !Number.isInteger(parsed)) || parsed < min || parsed > max) {
    throw new ConfigValidationError(`${fieldName} must be ${integer ? 'an integer' : 'a number'} between ${min} and ${max}`);
  }
  return parsed;
};

const parseBoolean = (rawValue, defaultValue, fieldName) => {
  if (rawValue === undefined || rawValue === null || rawValue === '') return defaultValue;
  const normalized = String(rawValue).trim().toLowerCase();
  if (normalized === 'true' || normalized === '1') return true;
  if (normalized === 'false' || normalized === '0') return false;
  throw new ConfigValidationError(`Invalid boolean for ${fieldName}: ${rawValue}`);
};

/** Loads and validates GPS settings from env (with optional overrides for tests). */
const loadGpsConfig = (overrides = {}) => {
  const raw = { ...process.env, ...overrides };

  const GPS_MODE = (raw.GPS_MODE || 'serial').trim().toLowerCase();
  if (!VALID_GPS_MODES.has(GPS_MODE)) {
    throw new ConfigValidationError(`Invalid GPS_MODE "${GPS_MODE}". Must be one of: ${[...VALID_GPS_MODES].join(', ')}`);
  }

  const GPS_MOCK_SCENARIO = (raw.GPS_MOCK_SCENARIO || 'walk').trim().toLowerCase();
  if (!VALID_MOCK_SCENARIOS.has(GPS_MOCK_SCENARIO)) {
    throw new ConfigValidationError(
      `Invalid GPS_MOCK_SCENARIO "${GPS_MOCK_SCENARIO}". Must be one of: ${[...VALID_MOCK_SCENARIOS].join(', ')}`
    );
  }

  const GPS_BAUD_RATE = parseBoundedNumber(raw.GPS_BAUD_RATE, 9600, 4800, 115200, 'GPS_BAUD_RATE');
  if (!VALID_BAUD_RATES.has(GPS_BAUD_RATE)) {
    throw new ConfigValidationError(`GPS_BAUD_RATE must be one of: ${[...VALID_BAUD_RATES].join(', ')}`);
  }

  const GPS_DEVICE = (raw.GPS_DEVICE || '/dev/serial0').trim();
  if (!GPS_DEVICE.startsWith('/dev/')) {
    throw new ConfigValidationError(`GPS_DEVICE must be a /dev path (got "${GPS_DEVICE}")`);
  }

  return {
    GPS_MODE,
    GPS_MOCK_SCENARIO,
    GPS_DEVICE,
    GPS_BAUD_RATE,
    GPS_ENABLE_GST: parseBoolean(raw.GPS_ENABLE_GST, true, 'GPS_ENABLE_GST'),
    GPS_UPDATE_INTERVAL_MS: parseBoundedNumber(raw.GPS_UPDATE_INTERVAL_MS, 1000, 200, 60000, 'GPS_UPDATE_INTERVAL_MS'),
    GPS_STALE_MS: parseBoundedNumber(raw.GPS_STALE_MS, 5000, 1000, 120000, 'GPS_STALE_MS'),
    GPS_SIGNAL_TIMEOUT_MS: parseBoundedNumber(raw.GPS_SIGNAL_TIMEOUT_MS, 3000, 1000, 60000, 'GPS_SIGNAL_TIMEOUT_MS'),
    GPS_MAX_ACCURACY_M: parseBoundedNumber(raw.GPS_MAX_ACCURACY_M, 25, 1, 500, 'GPS_MAX_ACCURACY_M', false),
  };
};

module.exports = {
  loadGpsConfig,
  VALID_GPS_MODES,
  VALID_MOCK_SCENARIOS,
};
