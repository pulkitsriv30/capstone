const imageProcessor = require('../processing/image.processor');
const { CameraBusyError, CameraUnavailableError } = require('../utils/errors');
const logger = require('../utils/logger');

class BaseCameraDriver {
  constructor(name) {
    this.name = name;
    this.initialized = false;
  }

  async init() {
    this.initialized = true;
  }

  async captureRawFrame() {
    throw new Error('captureRawFrame() must be implemented by subclass');
  }

  async dispose() {
    this.initialized = false;
  }
}

/**
 * Wraps any BaseCameraDriver with concurrency locking, lifecycle checks, and image normalization.
 */
class ManagedCamera {
  constructor(driver, options = {}) {
    this.driver = driver;
    this.options = options;
    this.isCapturing = false;
  }

  async init() {
    if (!this.driver.initialized) {
      await this.driver.init();
      logger.info('Camera driver initialized', { driver: this.driver.name });
    }
  }

  async captureFrame() {
    if (this.isCapturing) {
      throw new CameraBusyError();
    }

    if (!this.driver.initialized) {
      await this.init();
    }

    this.isCapturing = true;
    const startTime = Date.now();

    try {
      const rawBuffer = await this.driver.captureRawFrame();
      if (!Buffer.isBuffer(rawBuffer) || rawBuffer.length === 0) {
        throw new CameraUnavailableError(`Driver "${this.driver.name}" returned an empty frame`);
      }

      const processed = await imageProcessor.processFrame(rawBuffer, {
        maxWidth: this.options.maxWidth,
        quality: this.options.quality,
      });

      const durationMs = Date.now() - startTime;
      logger.info('Frame captured and processed', {
        driver: this.driver.name,
        width: processed.width,
        height: processed.height,
        sizeBytes: processed.sizeBytes,
        meanLuma: processed.meanLuma,
        durationMs,
      });

      return {
        ...processed,
        driver: this.driver.name,
        capturedAt: new Date().toISOString(),
      };
    } finally {
      this.isCapturing = false;
    }
  }

  async dispose() {
    await this.driver.dispose();
  }
}

module.exports = {
  BaseCameraDriver,
  ManagedCamera,
};
