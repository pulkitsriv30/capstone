/**
 * IMU configuration loader. Parses IMU_* variables the same way src/config/env.js does,
 * but lives inside the module and throws ImuConfigError.
 */
const { ImuConfigError } = require('./imu.errors');

const VALID_IMU_MODES = new Set(['mpu6500', 'mock']);
const VALID_I2C_ADDRESSES = new Set([0x68, 0x69]);
const VALID_ACCEL_RANGES_G = new Set([2, 4, 8, 16]);
const VALID_GYRO_RANGES_DPS = new Set([250, 500, 1000, 2000]);

const isUnset = (value) => value === undefined || value === null || value === '';

const parseBoundedInt = (rawValue, defaultValue, min, max, fieldName) => {
  if (isUnset(rawValue)) return defaultValue;
  const parsed = Number(rawValue);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    throw new ImuConfigError(`${fieldName} must be an integer between ${min} and ${max} (got "${rawValue}")`);
  }
  return parsed;
};

const parseBoolean = (rawValue, defaultValue, fieldName) => {
  if (isUnset(rawValue)) return defaultValue;
  if (typeof rawValue === 'boolean') return rawValue;
  const normalized = String(rawValue).trim().toLowerCase();
  if (normalized === 'true' || normalized === '1') return true;
  if (normalized === 'false' || normalized === '0') return false;
  throw new ImuConfigError(`${fieldName} must be true/false/1/0 (got "${rawValue}")`);
};

const parseOneOf = (rawValue, defaultValue, allowed, fieldName) => {
  if (isUnset(rawValue)) return defaultValue;
  const parsed = Number(rawValue);
  if (!allowed.has(parsed)) {
    throw new ImuConfigError(`${fieldName} must be one of ${Array.from(allowed).join(', ')} (got "${rawValue}")`);
  }
  return parsed;
};

const parseI2cAddress = (rawValue, defaultValue) => {
  if (isUnset(rawValue)) return defaultValue;
  let parsed;
  if (typeof rawValue === 'number') {
    parsed = rawValue;
  } else {
    const text = String(rawValue).trim().toLowerCase();
    if (/^0x[0-9a-f]+$/.test(text)) parsed = parseInt(text, 16);
    else if (/^\d+$/.test(text)) parsed = parseInt(text, 10);
    else parsed = NaN;
  }
  if (!VALID_I2C_ADDRESSES.has(parsed)) {
    throw new ImuConfigError(
      `IMU_I2C_ADDRESS must be 0x68 (AD0 low) or 0x69 (AD0 high) (got "${rawValue}")`
    );
  }
  return parsed;
};

const loadImuConfig = (overrides = {}, env = process.env) => {
  const raw = { ...env, ...overrides };

  const IMU_MODE = isUnset(raw.IMU_MODE) ? 'mock' : String(raw.IMU_MODE).trim().toLowerCase();
  if (!VALID_IMU_MODES.has(IMU_MODE)) {
    throw new ImuConfigError(
      `Invalid IMU_MODE "${IMU_MODE}". Must be one of: ${Array.from(VALID_IMU_MODES).join(', ')}`
    );
  }

  return Object.freeze({
    IMU_ENABLED: parseBoolean(raw.IMU_ENABLED, false, 'IMU_ENABLED'),
    IMU_MODE,
    IMU_I2C_BUS: parseBoundedInt(raw.IMU_I2C_BUS, 1, 0, 10, 'IMU_I2C_BUS'),
    IMU_I2C_ADDRESS: parseI2cAddress(raw.IMU_I2C_ADDRESS, 0x68),
    IMU_ACCEL_RANGE_G: parseOneOf(raw.IMU_ACCEL_RANGE_G, 4, VALID_ACCEL_RANGES_G, 'IMU_ACCEL_RANGE_G'),
    IMU_GYRO_RANGE_DPS: parseOneOf(raw.IMU_GYRO_RANGE_DPS, 500, VALID_GYRO_RANGES_DPS, 'IMU_GYRO_RANGE_DPS'),
    IMU_SAMPLE_RATE_HZ: parseBoundedInt(raw.IMU_SAMPLE_RATE_HZ, 50, 10, 200, 'IMU_SAMPLE_RATE_HZ'),
    IMU_CALIBRATION_SAMPLES: parseBoundedInt(raw.IMU_CALIBRATION_SAMPLES, 200, 50, 2000, 'IMU_CALIBRATION_SAMPLES'),
  });
};

module.exports = {
  loadImuConfig,
  VALID_IMU_MODES,
  VALID_I2C_ADDRESSES,
  VALID_ACCEL_RANGES_G,
  VALID_GYRO_RANGES_DPS,
};
