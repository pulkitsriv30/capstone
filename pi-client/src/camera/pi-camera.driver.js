const { execFile } = require('child_process');
const { promisify } = require('util');
const { BaseCameraDriver } = require('./camera.interface');
const { CameraUnavailableError, CameraCaptureTimeoutError } = require('../utils/errors');
const logger = require('../utils/logger');

const execFileAsync = promisify(execFile);

const CANDIDATE_BINARIES = ['rpicam-still', 'libcamera-still'];

class PiCameraDriver extends BaseCameraDriver {
  constructor(options = {}) {
    super('pi-libcamera');
    this.warmupMs = options.warmupMs ?? 500;
    this.captureTimeoutMs = options.captureTimeoutMs || 10000;
    this.execFile = options.execFile || execFileAsync;
    this.cameraBinary = null;
  }

  async init() {
    // Detect rpicam-still (Bookworm+) or libcamera-still (Bullseye)
    for (const candidate of CANDIDATE_BINARIES) {
      try {
        await this.execFile(candidate, ['--version'], { timeout: 3000 });
        this.cameraBinary = candidate;
        break;
      } catch (err) {
        if (err && err.code !== 'ENOENT') {
          // Some versions exit non-zero on --version or succeed via stderr
          this.cameraBinary = candidate;
          break;
        }
      }
    }

    if (!this.cameraBinary) {
      throw new CameraUnavailableError(
        'Neither "rpicam-still" nor "libcamera-still" was found. Ensure you are running 64-bit Raspberry Pi OS with "sudo apt install rpicam-apps".'
      );
    }

    // Verify a physical CSI camera sensor is detected
    try {
      const { stdout, stderr } = await this.execFile(
        this.cameraBinary,
        ['--list-cameras'],
        { timeout: 5000 }
      );
      const output = `${stdout || ''}\n${stderr || ''}`;
      if (/no cameras available/i.test(output)) {
        throw new CameraUnavailableError(
          'No Raspberry Pi CSI camera detected. Check the 15-pin ribbon cable orientation and camera_auto_detect=1 in /boot/firmware/config.txt.'
        );
      }
      logger.info('Raspberry Pi camera verified', { binary: this.cameraBinary });
    } catch (err) {
      if (err instanceof CameraUnavailableError) {
        throw err;
      }
      throw new CameraUnavailableError(
        `Failed to probe Raspberry Pi camera via ${this.cameraBinary}: ${err.message}`,
        err
      );
    }

    this.initialized = true;
  }

  async captureRawFrame() {
    if (!this.cameraBinary) {
      await this.init();
    }

    const args = [
      '--nopreview',
      '-t',
      String(this.warmupMs),
      '--width',
      '1280',
      '--height',
      '960',
      '--encoding',
      'jpg',
      '--quality',
      '85',
      '-o',
      '-', // Stream directly to stdout buffer (no temp file / SD wear)
    ];

    try {
      const { stdout } = await this.execFile(this.cameraBinary, args, {
        encoding: 'buffer',
        maxBuffer: 10 * 1024 * 1024,
        timeout: this.captureTimeoutMs,
      });

      if (!Buffer.isBuffer(stdout) || stdout.length === 0) {
        throw new CameraUnavailableError(`${this.cameraBinary} produced an empty image buffer`);
      }

      return stdout;
    } catch (err) {
      if (err instanceof CameraUnavailableError) {
        throw err;
      }
      if (err.killed || err.signal === 'SIGTERM' || /timed out/i.test(err.message || '')) {
        throw new CameraCaptureTimeoutError(this.captureTimeoutMs);
      }
      throw new CameraUnavailableError(
        `Raspberry Pi camera capture failed (${this.cameraBinary}): ${err.message}`,
        err
      );
    }
  }
}

module.exports = PiCameraDriver;
module.exports.CANDIDATE_BINARIES = CANDIDATE_BINARIES;
