#!/usr/bin/env node
/**
 * Standalone IMU diagnostic.
 *   node src/sensors/imu/imu.cli.js [--mode=mock|mpu6500] [--calibrate] [--seconds=N] [--json]
 *
 * Heading shown here is RELATIVE (gyro-integrated since start) and drifts: the
 * MPU-6500 has no magnetometer, so this is not a compass.
 */
const { loadImuConfig } = require('./imu.config');
const { createImuDriver } = require('./imu.factory');
const { ImuUnavailableError, ImuConfigError } = require('./imu.errors');

const PRINT_INTERVAL_MS = 200;
const HEADING_NOTE =
  'Note: heading is RELATIVE to start and drifts over time (gyro only, no magnetometer) - it is not a compass heading.';

const parseArgs = (argv = []) => {
  const args = { mode: undefined, calibrate: false, seconds: 0, json: false, help: false };
  for (const arg of argv) {
    if (arg.startsWith('--mode=')) args.mode = arg.slice('--mode='.length);
    else if (arg === '--calibrate') args.calibrate = true;
    else if (arg === '--json') args.json = true;
    else if (arg === '--help' || arg === '-h') args.help = true;
    else if (arg.startsWith('--seconds=')) {
      const value = Number(arg.slice('--seconds='.length));
      if (!Number.isFinite(value) || value < 0) {
        throw new ImuConfigError(`--seconds must be a non-negative number (got "${arg}")`);
      }
      args.seconds = value;
    } else {
      throw new ImuConfigError(`Unknown argument "${arg}". Use --help for usage.`);
    }
  }
  return args;
};

const fmt = (value, digits = 1, width = 6) =>
  (typeof value === 'number' && Number.isFinite(value) ? value.toFixed(digits) : '-').padStart(width);

const formatState = (state) =>
  `roll=${fmt(state.roll)} pitch=${fmt(state.pitch)} relHeading=${fmt(state.relativeHeading)} ` +
  `turnRate=${fmt(state.turnRate)}dps motion=${String(state.motion).padEnd(10)} steps=${state.stepCount}`;

const USAGE =
  'Usage: node src/sensors/imu/imu.cli.js [--mode=mock|mpu6500] [--calibrate] [--seconds=N] [--json]\n' +
  '  --calibrate   measure gyro/accel bias first (keep the device still and flat)\n' +
  '  --seconds=N   stop after N seconds (default: run until Ctrl+C)\n' +
  '  --json        print one JSON object per line\n';

/**
 * Runs the diagnostic. Resolves with an exit code (0 ok, 1 error).
 * deps: { out, err, env, overrides (driver overrides), signal (AbortSignal), handleSigint }
 */
const main = async (argv = process.argv.slice(2), deps = {}) => {
  const out = deps.out || process.stdout;
  const errOut = deps.err || process.stderr;
  const env = deps.env || process.env;
  const write = (stream, line) => stream.write(`${line}\n`);

  let imu = null;
  let stopResolve = null;
  const stopped = new Promise((resolve) => {
    stopResolve = resolve;
  });
  const requestStop = () => stopResolve();
  const handleSigint = deps.handleSigint !== false;
  let timer = null;

  try {
    const args = parseArgs(argv);
    if (args.help) {
      out.write(USAGE);
      return 0;
    }

    const config = loadImuConfig(args.mode ? { IMU_MODE: args.mode } : {}, env);
    imu = createImuDriver(config, deps.overrides || {});

    if (!args.json) {
      write(out, `IMU diagnostic: mode=${config.IMU_MODE}, sample rate ${config.IMU_SAMPLE_RATE_HZ} Hz`);
    }
    write(out, args.json ? JSON.stringify({ note: HEADING_NOTE }) : HEADING_NOTE);

    await imu.init();

    if (args.calibrate) {
      if (!args.json) {
        write(out, `Calibrating with ${config.IMU_CALIBRATION_SAMPLES} samples - keep the device STILL and FLAT...`);
      }
      const cal = await imu.calibrate({ samples: config.IMU_CALIBRATION_SAMPLES });
      if (args.json) {
        write(out, JSON.stringify({ calibration: cal }));
      } else {
        const b = cal.gyroBias;
        write(out, `Calibration done. Gyro bias (dps): x=${fmt(b.x, 3, 0)} y=${fmt(b.y, 3, 0)} z=${fmt(b.z, 3, 0)}`);
      }
    } else if (!args.json) {
      write(out, 'Running uncalibrated (gyro bias not removed; heading drifts faster). Use --calibrate.');
    }

    let lastPrint = -Infinity;
    let lastError = null;
    imu.on('sample', (state) => {
      const nowMs = Date.now();
      if (nowMs - lastPrint < PRINT_INTERVAL_MS) return;
      lastPrint = nowMs;
      write(out, args.json ? JSON.stringify(state) : formatState(state));
    });
    imu.on('error', (error) => {
      lastError = error;
      write(errOut, `IMU error: ${error.message}`);
      if (error instanceof ImuUnavailableError) requestStop();
    });

    if (handleSigint) process.once('SIGINT', requestStop);
    if (deps.signal) {
      if (deps.signal.aborted) requestStop();
      else deps.signal.addEventListener('abort', requestStop, { once: true });
    }
    if (args.seconds > 0) timer = setTimeout(requestStop, args.seconds * 1000);

    imu.start();
    await stopped;

    if (lastError instanceof ImuUnavailableError) {
      return 1;
    }
    return 0;
  } catch (error) {
    write(errOut, `Error: ${error.message}`);
    return 1;
  } finally {
    if (timer) clearTimeout(timer);
    if (handleSigint) process.removeListener('SIGINT', requestStop);
    if (imu) {
      try {
        await imu.dispose(); // stops polling and puts the sensor to sleep
      } catch (_) {
        // ignore cleanup errors
      }
    }
  }
};

if (require.main === module) {
  main().then((code) => {
    process.exitCode = code;
  });
}

module.exports = {
  main,
  parseArgs,
  formatState,
  HEADING_NOTE,
};
