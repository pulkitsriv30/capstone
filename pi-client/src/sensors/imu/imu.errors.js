/**
 * Typed errors for the IMU (MPU-6500) sensor module.
 * Kept inside the module so it merges without touching src/utils/errors.js.
 */
const { PiClientError } = require('../../utils/errors');

class ImuUnavailableError extends PiClientError {
  constructor(message, cause = null) {
    super(message, 'IMU_UNAVAILABLE', cause);
  }
}

class ImuReadError extends PiClientError {
  constructor(message, cause = null) {
    super(message, 'IMU_READ_ERROR', cause);
  }
}

class ImuCalibrationError extends PiClientError {
  constructor(message) {
    super(message, 'IMU_CALIBRATION_ERROR');
  }
}

class ImuConfigError extends PiClientError {
  constructor(message) {
    super(message, 'IMU_CONFIG_ERROR');
  }
}

module.exports = {
  ImuUnavailableError,
  ImuReadError,
  ImuCalibrationError,
  ImuConfigError,
};
