const { BaseImuDriver } = require('./imu.interface');
const { ImuConfigError } = require('./imu.errors');

const SAMPLE_INTERVAL_MS = 20;
const VALID_SCENARIOS = ['stationary', 'walking', 'turning'];
// Gyro noise (deg/s) per unit of accel noise (g): 0.005 g -> 0.1 deg/s.
const GYRO_NOISE_PER_G = 20;

/** mulberry32: small deterministic PRNG returning floats in [0, 1). */
function createPrng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Synthetic IMU for tests and laptops. Samples are 20 ms apart starting at now() at init.
 *
 * Scenarios (device held flat, gravity on +z):
 *  - stationary: gravity + noise, gyro = bias + noise
 *  - walking: vertical bounce of +/-0.25 g at stepHz (one accel-magnitude peak per step)
 *    plus some body sway on the x/y gyro axes
 *  - turning: constant rotation of turnRateDps about z
 * A `samples` array replays those samples (cycled) with fresh 20 ms timestamps.
 */
class MockImuDriver extends BaseImuDriver {
  constructor(options = {}) {
    super('mock');
    const {
      scenario = 'stationary',
      noise = 0.005,
      seed = 1,
      gyroBias = { x: 0.8, y: -0.5, z: 0.3 },
      turnRateDps = 30,
      stepHz = 1.8,
      samples = null,
      now = () => Date.now(),
    } = options;

    if (!VALID_SCENARIOS.includes(scenario)) {
      throw new ImuConfigError(
        `Unknown mock IMU scenario "${scenario}". Valid: ${VALID_SCENARIOS.join(', ')}`
      );
    }
    if (samples !== null && (!Array.isArray(samples) || samples.length === 0)) {
      throw new ImuConfigError('Mock IMU "samples" must be a non-empty array of samples');
    }

    this.scenario = scenario;
    this.noise = noise;
    this.seed = seed;
    this.gyroBias = { ...gyroBias };
    this.turnRateDps = turnRateDps;
    this.stepHz = stepHz;
    this.samples = samples;
    this.now = now;
    this.random = createPrng(seed);
    this.index = 0;
    this.startTime = null;
    this.readCount = 0;
  }

  async init() {
    this.startTime = this.now();
    this.index = 0;
    this.random = createPrng(this.seed);
    this.initialized = true;
  }

  _noise(scale) {
    return (this.random() * 2 - 1) * scale;
  }

  async readRaw() {
    if (this.startTime === null) {
      this.startTime = this.now();
    }
    const i = this.index;
    this.index += 1;
    this.readCount += 1;
    const timestamp = this.startTime + i * SAMPLE_INTERVAL_MS;

    if (this.samples) {
      const src = this.samples[i % this.samples.length];
      return {
        accel: { ...src.accel },
        gyro: { ...src.gyro },
        tempC: src.tempC === undefined ? null : src.tempC,
        timestamp,
      };
    }

    const t = (i * SAMPLE_INTERVAL_MS) / 1000;
    const n = this.noise;
    const gn = n * GYRO_NOISE_PER_G;
    const accel = { x: this._noise(n), y: this._noise(n), z: 1 + this._noise(n) };
    const gyro = {
      x: this.gyroBias.x + this._noise(gn),
      y: this.gyroBias.y + this._noise(gn),
      z: this.gyroBias.z + this._noise(gn),
    };

    if (this.scenario === 'walking') {
      const phase = 2 * Math.PI * this.stepHz * t;
      accel.z += 0.25 * Math.sin(phase);
      accel.x += 0.05 * Math.sin(phase / 2);
      gyro.x += 15 * Math.sin(phase / 2);
      gyro.y += 8 * Math.cos(phase);
    } else if (this.scenario === 'turning') {
      gyro.z += this.turnRateDps;
    }

    return { accel, gyro, tempC: 30 + this._noise(0.2), timestamp };
  }
}

module.exports = MockImuDriver;
module.exports.MockImuDriver = MockImuDriver;
module.exports.VALID_SCENARIOS = VALID_SCENARIOS;
