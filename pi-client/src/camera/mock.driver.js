const fs = require('fs');
const path = require('path');
const { BaseCameraDriver } = require('./camera.interface');
const { CameraUnavailableError } = require('../utils/errors');

const DEFAULT_FIXTURE_PATH = path.resolve(__dirname, '../../tests/fixtures/sample-room.jpg');

class MockCameraDriver extends BaseCameraDriver {
  constructor(options = {}) {
    super('mock');
    this.fixturePath = options.fixturePath || DEFAULT_FIXTURE_PATH;
    this.customBuffer = options.customBuffer || null;
  }

  async init() {
    if (!this.customBuffer && !fs.existsSync(this.fixturePath)) {
      throw new CameraUnavailableError(`Mock camera fixture not found at: ${this.fixturePath}`);
    }
    this.initialized = true;
  }

  async captureRawFrame() {
    if (this.customBuffer) {
      return this.customBuffer;
    }
    return fs.promises.readFile(this.fixturePath);
  }
}

module.exports = MockCameraDriver;
