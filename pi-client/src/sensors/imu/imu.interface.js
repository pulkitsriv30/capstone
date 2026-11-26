const EventEmitter = require('events');
const logger = require('../../utils/logger');
const { PiClientError } = require('../../utils/errors');
const { ImuCalibrationError, ImuReadError } = require('./imu.errors');
const {
  computeCalibration,
  applyCalibration,
  ComplementaryFilter,
  MotionDetector,
} = require('./imu.processing');

const MAX_CALIBRATION_GYRO_STD_DPS = 2;
const MAX_CALIBRATION_ACCEL_ERROR_G = 0.15;
// A still MPU-6500 has a zero-rate offset of at most ~5 deg/s; a larger mean means the
// device was rotating steadily during calibration (which std dev alone cannot see).
const MAX_CALIBRATION_GYRO_BIAS_DPS = 10;

/**
 * Base class for IMU drivers. readRaw() must resolve to a Sample:
 * { accel: {x,y,z} (g), gyro: {x,y,z} (deg/s), tempC: number|null, timestamp: ms }
 */
class BaseImuDriver {
  constructor(name) {
    this.name = name;
    this.initialized = false;
  }

  async init() {
    this.initialized = true;
  }

  async readRaw() {
    throw new Error('readRaw() must be implemented by subclass');
  }

  async dispose() {
    this.initialized = false;
  }
}

function isVec(v) {
  return (
    v !== null &&
    typeof v === 'object' &&
    Number.isFinite(v.x) &&
    Number.isFinite(v.y) &&
    Number.isFinite(v.z)
  );
}

function validateSample(sample, driverName) {
  if (!sample || !isVec(sample.accel) || !isVec(sample.gyro)) {
    throw new ImuReadError(`Driver "${driverName}" returned a malformed IMU sample`);
  }
}

function round(value, digits = 2) {
  const f = 10 ** digits;
  return Math.round(value * f) / f;
}

/**
 * Wraps a BaseImuDriver with calibration, orientation and motion tracking, and polling.
 *
 * Orientation:
 *  - roll / pitch come from a complementary filter (gyro integration blended with accel
 *    tilt), so they are absolute with respect to gravity.
 *  - relativeHeading is the integrated z gyro ONLY, in degrees 0..360 since the last
 *    resetHeading(). The MPU-6500 has no magnetometer, so yaw cannot be corrected: it is a
 *    relative heading that DRIFTS (a few deg/min after calibration, worse with temperature
 *    change). It is not a compass and not north-referenced. For a north reference, use GPS
 *    course-over-ground while walking or an external magnetometer.
 *
 * dt between samples is taken from sample timestamps (not wall time), so replayed or mock
 * data integrates deterministically.
 *
 * Events: 'sample'(state) after every read, 'motion'(newState, prevState) when
 * motion changes between 'stationary' and 'moving', 'error'(err) from the polling loop.
 */
class ManagedImu extends EventEmitter {
  constructor(driver, options = {}) {
    super();
    if (!driver || typeof driver.readRaw !== 'function') {
      throw new TypeError('ManagedImu requires a driver implementing readRaw()');
    }
    const {
      sampleRateHz = 50,
      calibrationSamples = 200,
      motionWindow = 25,
      complementaryAlpha = 0.98,
      now = () => Date.now(),
    } = options;

    this.driver = driver;
    this.sampleRateHz = sampleRateHz;
    this.calibrationSamples = calibrationSamples;
    this.now = now;
    this.filter = new ComplementaryFilter({ alpha: complementaryAlpha });
    this.motionDetector = new MotionDetector({ window: motionWindow });

    this.calibration = null;
    this.running = false;
    this._timer = null;
    this._loopPromise = null;
    this._lock = Promise.resolve();
    this._initPromise = null;
    this._lastTimestamp = null;
    this._resetState();
  }

  _resetState() {
    this.state = {
      roll: 0,
      pitch: 0,
      relativeHeading: 0,
      turnRate: 0,
      motion: 'stationary',
      stepCount: 0,
      accelMagnitude: 0,
      calibrated: this.calibration !== null,
      driver: this.driver.name,
      timestamp: null,
    };
  }

  /** Serializes driver access so reads never overlap. */
  _exclusive(fn) {
    const run = this._lock.then(fn, fn);
    this._lock = run.catch(() => {});
    return run;
  }

  async init() {
    if (!this._initPromise) {
      this._initPromise = (async () => {
        if (!this.driver.initialized) {
          await this.driver.init();
        }
        logger.info('IMU driver initialized', { driver: this.driver.name });
      })();
      this._initPromise.catch(() => {
        this._initPromise = null;
      });
    }
    return this._initPromise;
  }

  async _readRaw() {
    if (!this.driver.initialized) {
      await this.init();
    }
    let sample;
    try {
      sample = await this.driver.readRaw();
    } catch (err) {
      if (err instanceof PiClientError) throw err;
      throw new ImuReadError(`IMU read failed on driver "${this.driver.name}": ${err.message}`, err);
    }
    validateSample(sample, this.driver.name);
    return sample;
  }

  /**
   * Device must be still and flat (gravity on +z). Reads N samples and sets gyro and accel bias.
   * @throws {ImuCalibrationError} if the device moved during calibration.
   */
  async calibrate({ samples } = {}) {
    const n = samples === undefined ? this.calibrationSamples : samples;
    if (!Number.isInteger(n) || n < 2) {
      throw new ImuCalibrationError(`Calibration sample count must be an integer >= 2, got ${n}`);
    }

    return this._exclusive(async () => {
      const raw = [];
      for (let i = 0; i < n; i += 1) {
        raw.push(await this._readRaw());
      }

      const result = computeCalibration(raw);
      if (result.gyroStdDev > MAX_CALIBRATION_GYRO_STD_DPS) {
        throw new ImuCalibrationError(
          `Device moved during calibration (gyro std dev ${result.gyroStdDev.toFixed(2)} deg/s > ` +
            `${MAX_CALIBRATION_GYRO_STD_DPS}). Keep the device still and flat and retry.`
        );
      }
      const accelError = Math.abs(result.accelMagnitudeMean - 1);
      if (accelError > MAX_CALIBRATION_ACCEL_ERROR_G) {
        throw new ImuCalibrationError(
          `Device moved during calibration (mean |accel| ${result.accelMagnitudeMean.toFixed(3)} g, ` +
            `expected 1 g +/- ${MAX_CALIBRATION_ACCEL_ERROR_G}). Keep the device still and flat and retry.`
        );
      }
      const g = result.gyroBias;
      const maxBias = Math.max(Math.abs(g.x), Math.abs(g.y), Math.abs(g.z));
      if (maxBias > MAX_CALIBRATION_GYRO_BIAS_DPS) {
        throw new ImuCalibrationError(
          `Device was rotating during calibration (gyro offset ${maxBias.toFixed(2)} deg/s > ` +
            `${MAX_CALIBRATION_GYRO_BIAS_DPS}). Keep the device still and flat and retry.`
        );
      }

      const calibration = {
        gyroBias: { ...result.gyroBias },
        accelBias: { ...result.accelBias },
        samples: n,
        calibratedAt: new Date(this.now()).toISOString(),
      };
      this.setCalibration(calibration);
      logger.info('IMU calibrated', {
        driver: this.driver.name,
        samples: n,
        gyroBias: calibration.gyroBias,
        gyroStdDev: round(result.gyroStdDev, 3),
      });
      return calibration;
    });
  }

  /** Sets (or with null clears) the calibration and restarts orientation tracking. */
  setCalibration(cal) {
    if (cal !== null && (!cal || !isVec(cal.gyroBias) || !isVec(cal.accelBias))) {
      throw new ImuCalibrationError('Calibration must contain gyroBias and accelBias {x,y,z}');
    }
    this.calibration = cal
      ? { ...cal, gyroBias: { ...cal.gyroBias }, accelBias: { ...cal.accelBias } }
      : null;
    this.filter.reset();
    this.motionDetector.reset();
    this._lastTimestamp = null;
    this._resetState();
  }

  getCalibration() {
    if (!this.calibration) return null;
    return {
      ...this.calibration,
      gyroBias: { ...this.calibration.gyroBias },
      accelBias: { ...this.calibration.accelBias },
    };
  }

  /** Reads one calibrated sample, updates orientation and motion, and returns getState(). */
  async read() {
    return this._exclusive(async () => {
      const raw = await this._readRaw();
      const sample = applyCalibration(raw, this.calibration);
      const timestamp = Number.isFinite(sample.timestamp) ? sample.timestamp : this.now();
      sample.timestamp = timestamp;

      const dt = this._lastTimestamp === null ? 0 : (timestamp - this._lastTimestamp) / 1000;
      this._lastTimestamp = timestamp;

      const orientation = this.filter.update(sample, dt);
      const motion = this.motionDetector.update(sample);

      const prevState = this.getState();
      this.state = {
        roll: orientation.roll,
        pitch: orientation.pitch,
        relativeHeading: orientation.yaw,
        turnRate: sample.gyro.z,
        motion: motion.motion,
        stepCount: motion.stepCount,
        accelMagnitude: motion.accelMagnitude,
        calibrated: this.calibration !== null,
        driver: this.driver.name,
        timestamp,
      };

      const state = this.getState();
      this.emit('sample', state);
      if (state.motion !== prevState.motion) {
        this.emit('motion', state, prevState);
      }
      return state;
    });
  }

  /** Starts polling at sampleRateHz. Each read finishes before the next is scheduled. */
  start() {
    if (this.running) return;
    this.running = true;
    const periodMs = 1000 / this.sampleRateHz;

    const tick = async () => {
      this._timer = null;
      if (!this.running) return;
      const startedAt = Date.now();
      try {
        await this.read();
      } catch (err) {
        this._emitError(err);
      }
      if (this.running) {
        const delay = Math.max(0, periodMs - (Date.now() - startedAt));
        this._timer = setTimeout(() => {
          this._loopPromise = tick();
        }, delay);
      }
    };
    this._loopPromise = tick();
  }

  /** Stops polling; resolves once any in-flight read has finished. */
  async stop() {
    this.running = false;
    if (this._timer) {
      clearTimeout(this._timer);
      this._timer = null;
    }
    if (this._loopPromise) {
      await this._loopPromise;
      this._loopPromise = null;
    }
  }

  _emitError(err) {
    if (this.listenerCount('error') > 0) {
      this.emit('error', err);
    } else {
      logger.error('IMU polling read failed', err);
    }
  }

  /** Sets the relative (gyro-integrated) heading back to 0. */
  resetHeading() {
    this.filter.resetYaw();
    this.state = { ...this.state, relativeHeading: 0 };
  }

  getState() {
    return { ...this.state };
  }

  async dispose() {
    await this.stop();
    await this._lock;
    await this.driver.dispose();
    this._initPromise = null;
  }
}

module.exports = {
  BaseImuDriver,
  ManagedImu,
};
