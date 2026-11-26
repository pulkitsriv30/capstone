const test = require('node:test');
const assert = require('node:assert');
const sharp = require('sharp');
const { ManagedCamera, BaseCameraDriver } = require('../src/camera/camera.interface');
const { createCameraDriver } = require('../src/camera/camera.factory');
const PiCameraDriver = require('../src/camera/pi-camera.driver');
const { parseWindowsDshowVideoDevices } = require('../src/camera/webcam.driver');
const {
  CameraBusyError,
  CameraUnavailableError,
  CameraCaptureTimeoutError,
} = require('../src/utils/errors');

test('ManagedCamera - Mutex Prevents Concurrent Captures', async () => {
  const validJpg = await sharp({
    create: { width: 320, height: 240, channels: 3, background: { r: 100, g: 120, b: 140 } },
  })
    .jpeg()
    .toBuffer();

  class SlowMockDriver extends BaseCameraDriver {
    constructor() {
      super('slow-mock');
    }
    async captureRawFrame() {
      await new Promise((r) => setTimeout(r, 80));
      return validJpg;
    }
  }

  const camera = new ManagedCamera(new SlowMockDriver(), { maxWidth: 800, quality: 75 });
  await camera.init();

  const firstPromise = camera.captureFrame();

  await assert.rejects(
    () => camera.captureFrame(),
    (err) => err instanceof CameraBusyError
  );

  const result = await firstPromise;
  assert.strictEqual(result.driver, 'slow-mock');
  assert.strictEqual(result.mimeType, 'image/jpeg');
});

test('WebcamDriver - Parses Modern and Legacy DirectShow Device Lists', () => {
  const modernStderr = `
[dshow @ 000001] "Integrated Camera" (video)
[dshow @ 000001]   Alternative name "@device_pnp_..."
[dshow @ 000001] "Microphone Array" (audio)
`;
  assert.deepStrictEqual(parseWindowsDshowVideoDevices(modernStderr), ['Integrated Camera']);

  const legacyStderr = `
[dshow @ 000001] DirectShow video devices (some may be both video and audio devices)
[dshow @ 000001]  "USB2.0 HD UVC WebCam"
[dshow @ 000001]     Alternative name "@device_pnp_..."
[dshow @ 000001] DirectShow audio devices
[dshow @ 000001]  "Mic"
`;
  assert.deepStrictEqual(parseWindowsDshowVideoDevices(legacyStderr), ['USB2.0 HD UVC WebCam']);
});

test('PiCameraDriver - Auto-Detects rpicam-still, Falls Back to libcamera-still, Handles Missing Camera', async () => {
  const validJpg = await sharp({
    create: { width: 640, height: 480, channels: 3, background: { r: 90, g: 90, b: 90 } },
  })
    .jpeg()
    .toBuffer();

  const calls = [];
  const fakeExecFile = async (bin, args) => {
    calls.push({ bin, args });
    if (bin === 'rpicam-still') {
      const err = new Error('not found');
      err.code = 'ENOENT';
      throw err;
    }
    if (args.includes('--version')) return { stdout: 'libcamera-apps v1.4', stderr: '' };
    if (args.includes('--list-cameras')) return { stdout: '0 : imx219 [3280x2464]', stderr: '' };
    return { stdout: validJpg, stderr: '' };
  };

  const piDriver = new PiCameraDriver({ execFile: fakeExecFile, warmupMs: 400 });
  await piDriver.init();
  assert.strictEqual(piDriver.cameraBinary, 'libcamera-still');

  const frame = await piDriver.captureRawFrame();
  assert.ok(Buffer.isBuffer(frame));
  const captureCall = calls.find((c) => c.args.includes('--nopreview'));
  assert.ok(captureCall.args.includes('-o'));
  assert.ok(captureCall.args.includes('-'));

  // Missing physical camera check
  const noCamDriver = new PiCameraDriver({
    execFile: async (bin, args) => {
      if (args.includes('--list-cameras')) return { stdout: 'No cameras available!', stderr: '' };
      return { stdout: 'ok', stderr: '' };
    },
  });
  await assert.rejects(() => noCamDriver.init(), (err) => err instanceof CameraUnavailableError);

  // Timeout mapping check
  const timeoutDriver = new PiCameraDriver({
    captureTimeoutMs: 2500,
    execFile: async (bin, args) => {
      if (args.includes('--version') || args.includes('--list-cameras')) return { stdout: '0 : imx708', stderr: '' };
      const err = new Error('timed out');
      err.killed = true;
      err.signal = 'SIGTERM';
      throw err;
    },
  });
  await timeoutDriver.init();
  await assert.rejects(
    () => timeoutDriver.captureRawFrame(),
    (err) => err instanceof CameraCaptureTimeoutError
  );
});

test('CameraFactory - Instantiates Mock Driver and Captures Fixture', async () => {
  const validJpg = await sharp({
    create: { width: 1024, height: 768, channels: 3, background: { r: 80, g: 110, b: 140 } },
  })
    .jpeg()
    .toBuffer();

  const camera = createCameraDriver(
    { CAMERA_MODE: 'mock', IMAGE_MAX_WIDTH: 800, IMAGE_QUALITY: 75 },
    { customBuffer: validJpg }
  );

  const frame = await camera.captureFrame();
  assert.strictEqual(frame.driver, 'mock');
  assert.strictEqual(frame.width, 800);
  assert.strictEqual(frame.mimeType, 'image/jpeg');
});
