const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { execFile } = require('child_process');
const { promisify } = require('util');
const { BaseCameraDriver } = require('./camera.interface');
const { CameraUnavailableError, CameraCaptureTimeoutError } = require('../utils/errors');
const logger = require('../utils/logger');

const execFileAsync = promisify(execFile);

/**
 * Parses `ffmpeg -f dshow -list_devices true -i dummy` stderr output for video device names.
 * Supports both modern `[dshow @ ...] "Name" (video)` and legacy `"DirectShow video devices"` formats.
 */
const parseWindowsDshowVideoDevices = (stderrText) => {
  if (!stderrText || typeof stderrText !== 'string') return [];

  const devices = [];
  const lines = stderrText.split(/\r?\n/);
  let inLegacyVideoSection = false;

  for (const line of lines) {
    if (line.includes('DirectShow video devices')) {
      inLegacyVideoSection = true;
      continue;
    }
    if (line.includes('DirectShow audio devices')) {
      inLegacyVideoSection = false;
      continue;
    }

    // Modern format: [dshow @ ...] "Integrated Camera" (video)
    const modernMatch = line.match(/\]\s+"([^"]+)"\s+\(video\)/i);
    if (modernMatch) {
      devices.push(modernMatch[1]);
      continue;
    }

    // Legacy format inside DirectShow video devices block
    if (inLegacyVideoSection && !line.includes('Alternative name')) {
      const legacyMatch = line.match(/\]\s+"([^"]+)"/);
      if (legacyMatch) {
        devices.push(legacyMatch[1]);
      }
    }
  }

  return Array.from(new Set(devices));
};

class WebcamDriver extends BaseCameraDriver {
  constructor(options = {}) {
    super(options.mode === 'usb' ? 'usb-webcam' : 'laptop-webcam');
    this.platform = options.platform || process.platform;
    this.configuredDevice = options.device || 'auto';
    this.captureTimeoutMs = options.captureTimeoutMs || 10000;
    this.warmupFrames = options.warmupFrames ?? 5;
    this.execFile = options.execFile || execFileAsync;
    this.resolvedDevice = null;
  }

  async init() {
    // 1. Verify ffmpeg binary is accessible
    try {
      await this.execFile('ffmpeg', ['-version'], { timeout: 5000 });
    } catch (err) {
      throw new CameraUnavailableError(
        'ffmpeg is required for webcam/USB camera capture but was not found on PATH. Install via "winget install Gyan.FFmpeg" (Windows) or "sudo apt install ffmpeg" (Linux/Pi).',
        err
      );
    }

    // 2. Resolve camera device by platform
    if (this.configuredDevice && this.configuredDevice !== 'auto') {
      this.resolvedDevice = this.configuredDevice;
      this.initialized = true;
      return;
    }

    if (this.platform === 'win32') {
      this.resolvedDevice = await this._discoverWindowsDevice();
    } else if (this.platform === 'darwin') {
      this.resolvedDevice = '0';
    } else {
      // Linux / Raspberry Pi USB UVC camera
      const defaultLinuxDev = '/dev/video0';
      if (!fs.existsSync(defaultLinuxDev)) {
        throw new CameraUnavailableError(
          `No USB camera detected at ${defaultLinuxDev}. Set CAMERA_DEVICE or check USB connection.`
        );
      }
      this.resolvedDevice = defaultLinuxDev;
    }

    this.initialized = true;
  }

  async _discoverWindowsDevice() {
    let stderr = '';
    try {
      const result = await this.execFile(
        'ffmpeg',
        ['-hide_banner', '-f', 'dshow', '-list_devices', 'true', '-i', 'dummy'],
        { timeout: 5000 }
      );
      stderr = result.stderr || '';
    } catch (err) {
      // ffmpeg intentionally exits with code 1 when listing dshow devices
      stderr = err.stderr || '';
    }

    const devices = parseWindowsDshowVideoDevices(stderr);
    if (devices.length === 0) {
      throw new CameraUnavailableError(
        'No Windows webcam detected via DirectShow. Check camera connection and Windows Camera Privacy settings.'
      );
    }

    logger.info('Discovered Windows webcam device', { device: devices[0], availableCount: devices.length });
    return devices[0];
  }

  _buildFfmpegArgs(outputPath) {
    const filterArgs =
      this.warmupFrames > 0
        ? ['-vf', `select=gte(n\\,${this.warmupFrames})`, '-frames:v', '1']
        : ['-frames:v', '1'];

    if (this.platform === 'win32') {
      return [
        '-hide_banner',
        '-loglevel',
        'error',
        '-f',
        'dshow',
        '-i',
        `video=${this.resolvedDevice}`,
        ...filterArgs,
        '-q:v',
        '3',
        '-y',
        outputPath,
      ];
    }

    if (this.platform === 'darwin') {
      return [
        '-hide_banner',
        '-loglevel',
        'error',
        '-f',
        'avfoundation',
        '-framerate',
        '30',
        '-i',
        this.resolvedDevice,
        ...filterArgs,
        '-q:v',
        '3',
        '-y',
        outputPath,
      ];
    }

    // Linux / Raspberry Pi v4l2
    return [
      '-hide_banner',
      '-loglevel',
      'error',
      '-f',
      'v4l2',
      '-i',
      this.resolvedDevice,
      ...filterArgs,
      '-q:v',
      '3',
      '-y',
      outputPath,
    ];
  }

  async captureRawFrame() {
    const tempPath = path.join(os.tmpdir(), `capstone-cam-${crypto.randomUUID()}.jpg`);
    const args = this._buildFfmpegArgs(tempPath);

    try {
      await this.execFile('ffmpeg', args, { timeout: this.captureTimeoutMs });
      if (!fs.existsSync(tempPath)) {
        throw new CameraUnavailableError('Webcam capture completed but produced no output file');
      }
      return await fs.promises.readFile(tempPath);
    } catch (err) {
      if (err instanceof CameraUnavailableError) {
        throw err;
      }
      if (err.killed || err.signal === 'SIGTERM' || /timed out/i.test(err.message || '')) {
        throw new CameraCaptureTimeoutError(this.captureTimeoutMs);
      }
      throw new CameraUnavailableError(
        `Webcam capture failed on "${this.resolvedDevice}": ${err.stderr || err.message}`,
        err
      );
    } finally {
      if (fs.existsSync(tempPath)) {
        await fs.promises.unlink(tempPath).catch(() => {});
      }
    }
  }
}

module.exports = WebcamDriver;
module.exports.parseWindowsDshowVideoDevices = parseWindowsDshowVideoDevices;
