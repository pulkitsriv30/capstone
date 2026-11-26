const { ManagedCamera } = require('./camera.interface');
const PiCameraDriver = require('./pi-camera.driver');
const WebcamDriver = require('./webcam.driver');
const MockCameraDriver = require('./mock.driver');
const { ConfigValidationError } = require('../utils/errors');

const createCameraDriver = (config, overrides = {}) => {
  const mode = (config.CAMERA_MODE || 'webcam').toLowerCase();
  let driver;

  switch (mode) {
    case 'pi':
      driver = new PiCameraDriver({
        warmupMs: config.CAMERA_WARMUP_MS,
        captureTimeoutMs: config.CAPTURE_TIMEOUT_MS,
        ...overrides,
      });
      break;

    case 'webcam':
    case 'usb':
      driver = new WebcamDriver({
        mode,
        device: config.CAMERA_DEVICE,
        captureTimeoutMs: config.CAPTURE_TIMEOUT_MS,
        ...overrides,
      });
      break;

    case 'mock':
      driver = new MockCameraDriver(overrides);
      break;

    default:
      throw new ConfigValidationError(`Unsupported CAMERA_MODE: "${mode}"`);
  }

  return new ManagedCamera(driver, {
    maxWidth: config.IMAGE_MAX_WIDTH,
    quality: config.IMAGE_QUALITY,
  });
};

module.exports = {
  createCameraDriver,
};
