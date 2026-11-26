const readline = require('readline');
const config = require('./config/env');
const { createCameraDriver } = require('./camera/camera.factory');
const BackendClient = require('./network/backend.client');
const AudioPlayer = require('./audio/audio.player');
const logger = require('./utils/logger');

/**
 * Captures one optimized JPEG frame, uploads it to POST /api/navigation/environment,
 * and plays the returned audio (or falls back to local TTS).
 * Exported so voice-activation or GPIO trigger modules can invoke it directly.
 */
async function captureAndDescribe(camera, backendClient, audioPlayer) {
  const frame = await camera.captureFrame();
  const result = await backendClient.describeEnvironment(frame);

  if (result.textResponse) {
    console.log(`\n🔊 AI Response [${result.status}]: ${result.textResponse}\n`);
  }

  await audioPlayer.playNavigationResult(result);
  return result;
}

function createController(customConfig = config) {
  const camera = createCameraDriver(customConfig);
  const backendClient = new BackendClient({
    baseUrl: customConfig.BACKEND_URL,
    timeoutMs: customConfig.REQUEST_TIMEOUT_MS,
  });
  const audioPlayer = new AudioPlayer({
    enabled: customConfig.AUDIO_PLAYER_ENABLED,
    backend: customConfig.AUDIO_PLAYER_BACKEND,
  });

  return {
    camera,
    backendClient,
    audioPlayer,
    describeOnce: () => captureAndDescribe(camera, backendClient, audioPlayer),
  };
}

async function runCli() {
  logger.info('Starting Assistive Navigation Hardware Client', {
    backendUrl: config.BACKEND_URL,
    cameraMode: config.CAMERA_MODE,
    imageMaxWidth: config.IMAGE_MAX_WIDTH,
    requestTimeoutMs: config.REQUEST_TIMEOUT_MS,
  });

  const { camera, backendClient, audioPlayer, describeOnce } = createController(config);

  // Non-fatal health preflight
  try {
    const health = await backendClient.checkHealth();
    logger.info('Backend connection verified', { message: health.message });
  } catch (err) {
    logger.warn('Backend unreachable at startup (local camera tests still available)', {
      backendUrl: config.BACKEND_URL,
      error: err.message,
    });
  }

  await camera.init();

  console.log('\n==============================================================');
  console.log(` AI Assistive Navigation Client | Mode: ${config.CAMERA_MODE.toUpperCase()}`);
  console.log(` Backend: ${config.BACKEND_URL}`);
  console.log('==============================================================');
  console.log(' Commands:');
  console.log('   [Enter] or [e] -> Capture & Describe Environment (Full Flow)');
  console.log('   [t]            -> Test local camera capture & compression only');
  console.log('   [h]            -> Check backend /api/health');
  console.log('   [q]            -> Quit');
  console.log('==============================================================\n');

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: 'pi-client> ',
  });

  let busy = false;
  rl.prompt();

  rl.on('line', async (line) => {
    const cmd = line.trim().toLowerCase();

    if (cmd === 'q' || cmd === 'exit') {
      rl.close();
      return;
    }

    if (busy) {
      console.log('⏳ Previous command still running, please wait...');
      rl.prompt();
      return;
    }

    busy = true;
    try {
      if (cmd === '' || cmd === 'e') {
        console.log('📸 Capturing frame and analyzing environment...');
        await describeOnce();
      } else if (cmd === 't') {
        console.log('📸 Testing local camera capture...');
        const frame = await camera.captureFrame();
        console.log(
          `✅ Captured JPEG: ${frame.width}x${frame.height}, ${(frame.sizeBytes / 1024).toFixed(1)} KB, mean brightness=${frame.meanLuma}/255 (driver=${frame.driver})`
        );
      } else if (cmd === 'h') {
        const health = await backendClient.checkHealth();
        console.log('✅ Backend Health:', JSON.stringify(health));
      } else {
        console.log('Unknown command. Use [Enter]/e, t, h, or q.');
      }
    } catch (err) {
      logger.error('Command failed', err);
      console.error(`❌ Error [${err.code || 'ERROR'}]: ${err.message}`);
    } finally {
      busy = false;
      rl.prompt();
    }
  });

  const shutdown = async () => {
    logger.info('Shutting down pi-client...');
    await camera.dispose();
    process.exit(0);
  };

  rl.on('close', shutdown);
  process.on('SIGINT', () => rl.close());
  process.on('SIGTERM', () => rl.close());
}

if (require.main === module) {
  runCli().catch((err) => {
    logger.error('Fatal startup error', err);
    console.error(`\n❌ Startup failed: ${err.message}\n`);
    process.exit(1);
  });
}

module.exports = {
  createController,
  captureAndDescribe,
};
