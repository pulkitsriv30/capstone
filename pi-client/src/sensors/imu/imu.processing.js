/**
 * Pure IMU signal-processing helpers (no I/O).
 *
 * Units: accel in g, gyro in deg/s, angles in degrees, timestamps in ms.
 *
 * IMPORTANT: the MPU-6500 has no magnetometer. The yaw produced here is a
 * relative, gyro-integrated heading that drifts over time. It is NOT a
 * compass / absolute heading.
 */
const { ImuCalibrationError } = require('./imu.errors');

const RAD_TO_DEG = 180 / Math.PI;
const STEP_THRESHOLD_G = 1.15;
const MIN_STEP_INTERVAL_MS = 300;
const MAX_DT_SECONDS = 0.5;

const AXES = ['x', 'y', 'z'];

function normalizeAngle360(deg) {
  if (!Number.isFinite(deg)) return 0;
  const n = deg % 360;
  const r = n < 0 ? n + 360 : n;
  return r === 360 ? 0 : r + 0; // + 0 turns -0 into 0
}

/** Signed shortest difference a - b in degrees, in (-180, 180]. */
function angleDiff(a, b) {
  let d = (a - b) % 360;
  if (d > 180) d -= 360;
  if (d <= -180) d += 360;
  return d;
}

function normalizeAngle180(deg) {
  return angleDiff(deg, 0);
}

function magnitude(v) {
  return Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z);
}

function meanAndStd(values) {
  const n = values.length;
  const mean = values.reduce((s, v) => s + v, 0) / n;
  const variance = values.reduce((s, v) => s + (v - mean) * (v - mean), 0) / n;
  return { mean, std: Math.sqrt(variance) };
}

/**
 * Computes gyro and accel bias from samples taken while the device is still and flat
 * (gravity along +z, so the expected accel reading is (0, 0, 1) g).
 *
 * @param {Array<{accel:{x,y,z}, gyro:{x,y,z}}>} samples
 * @returns {{gyroBias:{x,y,z}, accelBias:{x,y,z}, gyroStdDev:number, accelMagnitudeMean:number}}
 *   gyroStdDev is the largest per-axis standard deviation (deg/s).
 */
function computeCalibration(samples) {
  if (!Array.isArray(samples) || samples.length === 0) {
    throw new ImuCalibrationError('Calibration requires at least one sample');
  }

  const gyroBias = {};
  const accelBias = {};
  let gyroStdDev = 0;
  const expectedAccel = { x: 0, y: 0, z: 1 };

  for (const axis of AXES) {
    const g = meanAndStd(samples.map((s) => s.gyro[axis]));
    gyroBias[axis] = g.mean;
    gyroStdDev = Math.max(gyroStdDev, g.std);

    const a = meanAndStd(samples.map((s) => s.accel[axis]));
    accelBias[axis] = a.mean - expectedAccel[axis];
  }

  const accelMagnitudeMean =
    samples.reduce((sum, s) => sum + magnitude(s.accel), 0) / samples.length;

  return { gyroBias, accelBias, gyroStdDev, accelMagnitudeMean };
}

/**
 * Returns a new sample with biases subtracted. A null/undefined calibration returns a copy.
 */
function applyCalibration(sample, cal) {
  const gb = (cal && cal.gyroBias) || { x: 0, y: 0, z: 0 };
  const ab = (cal && cal.accelBias) || { x: 0, y: 0, z: 0 };
  return {
    accel: {
      x: sample.accel.x - ab.x,
      y: sample.accel.y - ab.y,
      z: sample.accel.z - ab.z,
    },
    gyro: {
      x: sample.gyro.x - gb.x,
      y: sample.gyro.y - gb.y,
      z: sample.gyro.z - gb.z,
    },
    tempC: sample.tempC === undefined ? null : sample.tempC,
    timestamp: sample.timestamp,
  };
}

/** Roll/pitch (deg) implied by the gravity vector alone. */
function accelTilt(accel) {
  const roll = Math.atan2(accel.y, accel.z) * RAD_TO_DEG;
  const pitch = Math.atan2(-accel.x, Math.sqrt(accel.y * accel.y + accel.z * accel.z)) * RAD_TO_DEG;
  return { roll, pitch };
}

/**
 * Complementary filter: roll/pitch = alpha * (previous + gyro * dt) + (1 - alpha) * accelTilt.
 * Roll/pitch are therefore absolute with respect to gravity and do not drift long-term.
 *
 * Yaw is integrated z gyro ONLY (0..360). Without a magnetometer there is no reference
 * to correct it, so it is a relative heading since the last reset and it drifts
 * (typically a few deg/min after calibration, worse with temperature change).
 */
class ComplementaryFilter {
  constructor({ alpha = 0.98 } = {}) {
    if (!(alpha >= 0 && alpha <= 1)) {
      throw new RangeError(`ComplementaryFilter alpha must be within [0, 1], got ${alpha}`);
    }
    this.alpha = alpha;
    this.reset();
  }

  reset() {
    this.roll = 0;
    this.pitch = 0;
    this.yaw = 0;
    this.initialized = false;
  }

  resetYaw() {
    this.yaw = 0;
  }

  /**
   * @param {object} sample calibrated sample
   * @param {number} dtSeconds time since the previous sample; invalid/negative values count as 0,
   *   values above 0.5 s are clamped so a stall does not cause a large jump.
   * @returns {{roll:number, pitch:number, yaw:number}}
   */
  update(sample, dtSeconds) {
    let dt = Number.isFinite(dtSeconds) && dtSeconds > 0 ? dtSeconds : 0;
    if (dt > MAX_DT_SECONDS) dt = MAX_DT_SECONDS;

    const tilt = accelTilt(sample.accel);
    const accelValid = magnitude(sample.accel) > 1e-6;

    if (!this.initialized) {
      if (accelValid) {
        this.roll = tilt.roll;
        this.pitch = tilt.pitch;
      }
      this.initialized = true;
    } else {
      const gyroRoll = this.roll + sample.gyro.x * dt;
      const gyroPitch = this.pitch + sample.gyro.y * dt;
      if (accelValid) {
        // Blend along the shortest arc so roll near +/-180 does not jump.
        this.roll = normalizeAngle180(gyroRoll + (1 - this.alpha) * angleDiff(tilt.roll, gyroRoll));
        this.pitch = gyroPitch + (1 - this.alpha) * (tilt.pitch - gyroPitch);
      } else {
        this.roll = normalizeAngle180(gyroRoll);
        this.pitch = gyroPitch;
      }
      this.pitch = Math.max(-90, Math.min(90, this.pitch));
    }

    this.yaw = normalizeAngle360(this.yaw + sample.gyro.z * dt);
    return { roll: this.roll, pitch: this.pitch, yaw: this.yaw };
  }
}

/**
 * Stationary/moving classification from the std dev of accel magnitude over a sliding
 * window, plus a simple step detector: a step is a local peak in accel magnitude above
 * 1.15 g at least 300 ms after the previous step.
 */
class MotionDetector {
  constructor({ window = 25, stationaryStdDevG = 0.02 } = {}) {
    this.window = Math.max(2, Math.floor(window));
    this.stationaryStdDevG = stationaryStdDevG;
    this.reset();
  }

  reset() {
    this.magnitudes = [];
    this.stepCount = 0;
    this.motion = 'stationary';
    this.lastStepTime = -Infinity;
    this.prev = null; // { mag, timestamp }
    this.prevPrevMag = null;
    this.fallbackTime = 0;
  }

  /**
   * @param {object} sample calibrated sample (timestamp in ms)
   * @returns {{motion:'stationary'|'moving', stepDetected:boolean, stepCount:number, accelMagnitude:number}}
   */
  update(sample) {
    const mag = magnitude(sample.accel);
    let timestamp = sample.timestamp;
    if (!Number.isFinite(timestamp)) {
      this.fallbackTime += 20;
      timestamp = this.fallbackTime;
    }

    this.magnitudes.push(mag);
    if (this.magnitudes.length > this.window) this.magnitudes.shift();
    if (this.magnitudes.length >= 2) {
      const { std } = meanAndStd(this.magnitudes);
      this.motion = std > this.stationaryStdDevG ? 'moving' : 'stationary';
    }

    // The previous sample is a peak if it rose from the one before and current is lower.
    let stepDetected = false;
    if (this.prev && this.prevPrevMag !== null) {
      const p = this.prev;
      if (
        p.mag > STEP_THRESHOLD_G &&
        p.mag >= this.prevPrevMag &&
        p.mag > mag &&
        p.timestamp - this.lastStepTime >= MIN_STEP_INTERVAL_MS
      ) {
        stepDetected = true;
        this.stepCount += 1;
        this.lastStepTime = p.timestamp;
      }
    }
    this.prevPrevMag = this.prev ? this.prev.mag : null;
    this.prev = { mag, timestamp };

    return {
      motion: this.motion,
      stepDetected,
      stepCount: this.stepCount,
      accelMagnitude: mag,
    };
  }
}

module.exports = {
  computeCalibration,
  applyCalibration,
  ComplementaryFilter,
  MotionDetector,
  normalizeAngle360,
  STEP_THRESHOLD_G,
  MIN_STEP_INTERVAL_MS,
};
