const test = require('node:test');
const assert = require('node:assert');
const {
  computeCalibration,
  applyCalibration,
  ComplementaryFilter,
  MotionDetector,
  normalizeAngle360,
} = require('../src/sensors/imu/imu.processing');
const { ImuCalibrationError } = require('../src/sensors/imu/imu.errors');

const sample = (accel, gyro = { x: 0, y: 0, z: 0 }, timestamp = 0) => ({
  accel,
  gyro,
  tempC: null,
  timestamp,
});

const FLAT = { x: 0, y: 0, z: 1 };

test('normalizeAngle360 wraps into [0, 360)', () => {
  assert.strictEqual(normalizeAngle360(0), 0);
  assert.strictEqual(normalizeAngle360(360), 0);
  assert.strictEqual(normalizeAngle360(-90), 270);
  assert.strictEqual(normalizeAngle360(725), 5);
  assert.strictEqual(normalizeAngle360(-720), 0);
  assert.ok(!Object.is(normalizeAngle360(-360), -0));
});

test('computeCalibration - computes means, biases and spread', () => {
  const samples = [
    sample({ x: 0.01, y: -0.02, z: 1.03 }, { x: 1, y: -1, z: 0.5 }),
    sample({ x: 0.03, y: -0.02, z: 1.01 }, { x: 3, y: -1, z: 0.5 }),
  ];
  const cal = computeCalibration(samples);
  assert.deepStrictEqual(cal.gyroBias, { x: 2, y: -1, z: 0.5 });
  assert.ok(Math.abs(cal.accelBias.x - 0.02) < 1e-9);
  assert.ok(Math.abs(cal.accelBias.y + 0.02) < 1e-9);
  assert.ok(Math.abs(cal.accelBias.z - 0.02) < 1e-9);
  assert.ok(Math.abs(cal.gyroStdDev - 1) < 1e-9, 'max per-axis std dev');
  assert.ok(Math.abs(cal.accelMagnitudeMean - 1.02) < 0.002);
});

test('computeCalibration - rejects empty input', () => {
  assert.throws(() => computeCalibration([]), ImuCalibrationError);
});

test('applyCalibration - subtracts biases without mutating input', () => {
  const raw = sample({ x: 0.1, y: 0.2, z: 1.1 }, { x: 1, y: 2, z: 3 }, 1234);
  const cal = { gyroBias: { x: 1, y: 1, z: 1 }, accelBias: { x: 0.1, y: 0, z: 0.1 } };
  const out = applyCalibration(raw, cal);
  assert.deepStrictEqual(out.gyro, { x: 0, y: 1, z: 2 });
  assert.ok(Math.abs(out.accel.x) < 1e-12);
  assert.ok(Math.abs(out.accel.z - 1) < 1e-12);
  assert.strictEqual(out.timestamp, 1234);
  assert.strictEqual(raw.gyro.x, 1, 'input untouched');
  assert.deepStrictEqual(applyCalibration(raw, null).gyro, raw.gyro);
});

test('ComplementaryFilter - first sample initializes tilt from gravity', () => {
  const f = new ComplementaryFilter({ alpha: 0.98 });
  const s = Math.SQRT1_2;
  const out = f.update(sample({ x: 0, y: s, z: s }), 0);
  assert.ok(Math.abs(out.roll - 45) < 1e-9);
  assert.ok(Math.abs(out.pitch) < 1e-9);

  const f2 = new ComplementaryFilter();
  const out2 = f2.update(sample({ x: -0.5, y: 0, z: Math.sqrt(0.75) }), 0);
  assert.ok(Math.abs(out2.pitch - 30) < 1e-9);
});

test('ComplementaryFilter - gyro bias drift is pulled back by accel', () => {
  const f = new ComplementaryFilter({ alpha: 0.98 });
  f.update(sample(FLAT), 0);
  let out;
  // Uncorrected 5 deg/s roll gyro error for 20 s would be 100 deg.
  for (let i = 0; i < 1000; i += 1) out = f.update(sample(FLAT, { x: 5, y: 0, z: 0 }), 0.02);
  assert.ok(Math.abs(out.roll) < 10, `roll stays bounded, got ${out.roll}`);
  // Steady-state error = alpha * rate * dt / (1 - alpha) = 4.9 deg
  assert.ok(Math.abs(out.roll - 4.9) < 0.1);
});

test('ComplementaryFilter - follows a real tilt', () => {
  const f = new ComplementaryFilter({ alpha: 0.98 });
  f.update(sample(FLAT), 0);
  const tilted = { x: 0, y: Math.sin(Math.PI / 6), z: Math.cos(Math.PI / 6) };
  let out;
  for (let i = 0; i < 500; i += 1) out = f.update(sample(tilted), 0.02);
  assert.ok(Math.abs(out.roll - 30) < 0.5);
});

test('ComplementaryFilter - yaw integrates z gyro only, wraps, and resets', () => {
  const f = new ComplementaryFilter();
  f.update(sample(FLAT), 0);
  let out;
  for (let i = 0; i < 50; i += 1) out = f.update(sample(FLAT, { x: 0, y: 0, z: 90 }), 0.02);
  assert.ok(Math.abs(out.yaw - 90) < 1e-6);
  for (let i = 0; i < 50; i += 1) out = f.update(sample(FLAT, { x: 0, y: 0, z: -180 }), 0.02);
  assert.ok(Math.abs(out.yaw - 270) < 1e-6, `wrapped to 270, got ${out.yaw}`);
  f.resetYaw();
  assert.strictEqual(f.yaw, 0);
  // Invalid / huge dt is safe.
  out = f.update(sample(FLAT, { x: 0, y: 0, z: 10 }), -1);
  assert.strictEqual(out.yaw, 0);
  out = f.update(sample(FLAT, { x: 0, y: 0, z: 10 }), 100);
  assert.ok(Math.abs(out.yaw - 5) < 1e-9, 'dt clamped to 0.5 s');
  f.reset();
  assert.strictEqual(f.initialized, false);
});

test('ComplementaryFilter - rejects invalid alpha', () => {
  assert.throws(() => new ComplementaryFilter({ alpha: 1.5 }), RangeError);
});

test('MotionDetector - classifies stationary vs moving', () => {
  const d = new MotionDetector({ window: 10 });
  let r;
  for (let i = 0; i < 20; i += 1) r = d.update(sample({ x: 0, y: 0, z: 1 + (i % 2) * 0.005 }, undefined, i * 20));
  assert.strictEqual(r.motion, 'stationary');
  assert.strictEqual(r.stepCount, 0);
  for (let i = 20; i < 40; i += 1) r = d.update(sample({ x: 0, y: 0, z: 1 + (i % 2) * 0.2 }, undefined, i * 20));
  assert.strictEqual(r.motion, 'moving');
});

test('MotionDetector - counts peaks above 1.15 g with 300 ms refractory period', () => {
  const d = new MotionDetector();
  const mags = [1.0, 1.1, 1.2, 1.1, 1.0, 1.2, 1.25, 1.0]; // second peak only 80 ms after the first
  const results = mags.map((z, i) => d.update(sample({ x: 0, y: 0, z }, undefined, i * 20)));
  assert.strictEqual(results[3].stepDetected, true, 'peak at index 2 detected one sample later');
  assert.strictEqual(results[results.length - 1].stepCount, 1, 'second peak suppressed');

  // A peak below the threshold is not a step.
  const d2 = new MotionDetector();
  [1.0, 1.1, 1.14, 1.1, 1.0].forEach((z, i) => d2.update(sample({ x: 0, y: 0, z }, undefined, i * 20)));
  assert.strictEqual(d2.stepCount, 0);

  // Peaks 400 ms apart both count.
  const d3 = new MotionDetector();
  let r;
  for (let i = 0; i < 60; i += 1) {
    const z = i % 20 === 10 ? 1.3 : 1.0;
    r = d3.update(sample({ x: 0, y: 0, z }, undefined, i * 20));
  }
  assert.strictEqual(r.stepCount, 3);
  d3.reset();
  assert.strictEqual(d3.stepCount, 0);
});
