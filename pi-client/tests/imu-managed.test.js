const test = require('node:test');
const assert = require('node:assert');
const { ManagedImu, BaseImuDriver } = require('../src/sensors/imu/imu.interface');
const MockImuDriver = require('../src/sensors/imu/mock.driver');
const {
  ImuCalibrationError,
  ImuReadError,
  ImuConfigError,
} = require('../src/sensors/imu/imu.errors');

const fixedNow = () => 1700000000000;

async function readN(imu, n) {
  let state;
  for (let i = 0; i < n; i += 1) state = await imu.read();
  return state;
}

test('MockImuDriver - deterministic, 20 ms timestamps from now()', async () => {
  const a = new MockImuDriver({ now: fixedNow, seed: 7 });
  const b = new MockImuDriver({ now: fixedNow, seed: 7 });
  await a.init();
  await b.init();
  const s1 = await a.readRaw();
  const s2 = await a.readRaw();
  assert.deepStrictEqual(s1, await b.readRaw());
  assert.strictEqual(s1.timestamp, fixedNow());
  assert.strictEqual(s2.timestamp - s1.timestamp, 20);
  assert.ok(Math.abs(s1.accel.z - 1) < 0.01);
  assert.ok(Math.abs(s1.gyro.x - 0.8) < 0.2, 'default gyro bias present');
  assert.throws(() => new MockImuDriver({ scenario: 'flying' }), ImuConfigError);
});

test('MockImuDriver - replays provided samples cyclically', async () => {
  const samples = [
    { accel: { x: 0, y: 0, z: 1 }, gyro: { x: 1, y: 0, z: 0 }, tempC: 25, timestamp: 0 },
    { accel: { x: 0, y: 0, z: 1 }, gyro: { x: 2, y: 0, z: 0 }, timestamp: 0 },
  ];
  const d = new MockImuDriver({ samples, now: () => 1000 });
  await d.init();
  const out = [];
  for (let i = 0; i < 3; i += 1) out.push(await d.readRaw());
  assert.deepStrictEqual(out.map((s) => s.gyro.x), [1, 2, 1]);
  assert.deepStrictEqual(out.map((s) => s.timestamp), [1000, 1020, 1040]);
  assert.strictEqual(out[1].tempC, null);
});

test('ManagedImu - calibration removes gyro bias', async () => {
  const imu = new ManagedImu(new MockImuDriver({ now: fixedNow }), { now: fixedNow });
  await imu.init();
  assert.strictEqual(imu.getCalibration(), null);
  assert.strictEqual(imu.getState().calibrated, false);

  const cal = await imu.calibrate({ samples: 200 });
  assert.ok(Math.abs(cal.gyroBias.x - 0.8) < 0.05);
  assert.ok(Math.abs(cal.gyroBias.y + 0.5) < 0.05);
  assert.ok(Math.abs(cal.gyroBias.z - 0.3) < 0.05);
  assert.ok(Math.abs(cal.accelBias.z) < 0.01);
  assert.strictEqual(cal.samples, 200);
  assert.strictEqual(cal.calibratedAt, new Date(fixedNow()).toISOString());

  // 60 s stationary: heading drift should be tiny after calibration.
  const state = await readN(imu, 3000);
  assert.strictEqual(state.calibrated, true);
  assert.strictEqual(state.motion, 'stationary');
  assert.strictEqual(state.stepCount, 0);
  assert.ok(Math.abs(state.turnRate) < 0.2);
  const drift = Math.min(state.relativeHeading, 360 - state.relativeHeading);
  assert.ok(drift < 3, `drift ${drift} deg after 60 s`);
  assert.ok(Math.abs(state.roll) < 1 && Math.abs(state.pitch) < 1);
  assert.strictEqual(state.driver, 'mock');
});

test('ManagedImu - uncalibrated heading drifts with gyro bias', async () => {
  const imu = new ManagedImu(new MockImuDriver({ now: fixedNow }), { now: fixedNow });
  const state = await readN(imu, 1001); // 20 s * 0.3 deg/s = 6 deg
  assert.ok(Math.abs(state.relativeHeading - 6) < 0.5, `got ${state.relativeHeading}`);
});

test('ManagedImu - calibration rejects a moving device', async () => {
  const walking = new ManagedImu(new MockImuDriver({ scenario: 'walking', now: fixedNow }));
  await assert.rejects(() => walking.calibrate({ samples: 100 }), ImuCalibrationError);
  assert.strictEqual(walking.getCalibration(), null);

  const turning = new ManagedImu(new MockImuDriver({ scenario: 'turning', now: fixedNow }));
  await assert.rejects(() => turning.calibrate({ samples: 100 }), ImuCalibrationError);

  const shaky = new ManagedImu(new MockImuDriver({ noise: 0.3, now: fixedNow }));
  await assert.rejects(() => shaky.calibrate({ samples: 100 }), ImuCalibrationError);

  const upsideDownish = [{ accel: { x: 0, y: 0, z: 0.7 }, gyro: { x: 0, y: 0, z: 0 } }];
  const bad = new ManagedImu(new MockImuDriver({ samples: upsideDownish }));
  await assert.rejects(() => bad.calibrate({ samples: 10 }), /accel/);

  await assert.rejects(() => bad.calibrate({ samples: 1 }), ImuCalibrationError);
});

test('ManagedImu - turning scenario integrates heading ~ turnRate * t', async () => {
  const driver = new MockImuDriver({ scenario: 'turning', turnRateDps: 30, now: fixedNow });
  const imu = new ManagedImu(driver);
  imu.setCalibration({ gyroBias: { x: 0.8, y: -0.5, z: 0.3 }, accelBias: { x: 0, y: 0, z: 0 } });
  let state = await readN(imu, 101); // 2 s
  assert.ok(Math.abs(state.relativeHeading - 60) < 1, `got ${state.relativeHeading}`);
  assert.ok(Math.abs(state.turnRate - 30) < 0.5);

  state = await readN(imu, 500); // +10 s -> 360 deg -> wraps
  assert.ok(Math.abs(state.relativeHeading - 0) < 2 || Math.abs(state.relativeHeading - 360) < 2);
  assert.ok(state.relativeHeading >= 0 && state.relativeHeading < 360);

  imu.resetHeading();
  assert.strictEqual(imu.getState().relativeHeading, 0);
  state = await readN(imu, 50); // 1 s
  assert.ok(Math.abs(state.relativeHeading - 30) < 1, `got ${state.relativeHeading}`);
});

test('ManagedImu - walking counts roughly stepHz * seconds steps', async () => {
  const imu = new ManagedImu(new MockImuDriver({ scenario: 'walking', stepHz: 1.8, now: fixedNow }));
  const motions = [];
  imu.on('motion', (next, prev) => motions.push([prev.motion, next.motion]));
  const state = await readN(imu, 500); // 10 s
  assert.ok(Math.abs(state.stepCount - 18) <= 1, `steps ${state.stepCount}`);
  assert.strictEqual(state.motion, 'moving');
  assert.deepStrictEqual(motions[0], ['stationary', 'moving']);
});

test('ManagedImu - tilted replay gives absolute roll/pitch', async () => {
  const s = Math.SQRT1_2;
  const imu = new ManagedImu(
    new MockImuDriver({ samples: [{ accel: { x: 0, y: s, z: s }, gyro: { x: 0, y: 0, z: 0 } }] })
  );
  const state = await readN(imu, 5);
  assert.ok(Math.abs(state.roll - 45) < 1e-6);
  assert.ok(Math.abs(state.pitch) < 1e-6);
});

test('ManagedImu - read wraps driver errors and rejects malformed samples', async () => {
  class Broken extends BaseImuDriver {
    constructor() {
      super('broken');
    }
    async readRaw() {
      throw new Error('EIO');
    }
  }
  class Malformed extends BaseImuDriver {
    constructor() {
      super('malformed');
    }
    async readRaw() {
      return { accel: { x: 0, y: 0 }, gyro: { x: 0, y: 0, z: 0 } };
    }
  }
  await assert.rejects(() => new ManagedImu(new Broken()).read(), (err) => {
    assert.ok(err instanceof ImuReadError);
    assert.match(err.message, /EIO/);
    return true;
  });
  await assert.rejects(() => new ManagedImu(new Malformed()).read(), ImuReadError);
  await assert.rejects(() => new BaseImuDriver('x').readRaw(), /must be implemented/);
  assert.throws(() => new ManagedImu({}), TypeError);
  assert.throws(() => new ManagedImu(new Broken()).setCalibration({ gyroBias: {} }), ImuCalibrationError);
});

test('ManagedImu - init calls driver.init once; dispose disposes driver', async () => {
  const driver = new MockImuDriver();
  let inits = 0;
  const origInit = driver.init.bind(driver);
  driver.init = async () => {
    inits += 1;
    return origInit();
  };
  let disposed = false;
  driver.dispose = async () => {
    disposed = true;
  };
  const imu = new ManagedImu(driver);
  await Promise.all([imu.init(), imu.init()]);
  await imu.init();
  await imu.read();
  assert.strictEqual(inits, 1);
  await imu.dispose();
  assert.strictEqual(disposed, true);
});

test('ManagedImu - concurrent read() calls never overlap driver reads', async () => {
  let active = 0;
  let maxActive = 0;
  let t = 0;
  class Slow extends BaseImuDriver {
    constructor() {
      super('slow');
    }
    async readRaw() {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise((r) => setTimeout(r, 5));
      active -= 1;
      t += 20;
      return { accel: { x: 0, y: 0, z: 1 }, gyro: { x: 0, y: 0, z: 0 }, tempC: null, timestamp: t };
    }
  }
  const imu = new ManagedImu(new Slow());
  const states = await Promise.all([imu.read(), imu.read(), imu.read(), imu.read()]);
  assert.strictEqual(maxActive, 1);
  assert.deepStrictEqual(states.map((s) => s.timestamp), [20, 40, 60, 80]);
});

test('ManagedImu - start/stop polls, emits samples, no overlapping reads', async () => {
  let active = 0;
  let maxActive = 0;
  const driver = new MockImuDriver({ scenario: 'walking' });
  const origRead = driver.readRaw.bind(driver);
  driver.readRaw = async () => {
    active += 1;
    maxActive = Math.max(maxActive, active);
    await new Promise((r) => setTimeout(r, 2));
    const s = await origRead();
    active -= 1;
    return s;
  };

  const imu = new ManagedImu(driver, { sampleRateHz: 200 });
  const samples = [];
  const motions = [];
  imu.on('sample', (s) => samples.push(s));
  imu.on('motion', (next, prev) => motions.push({ next, prev }));
  imu.start();
  imu.start(); // idempotent
  await new Promise((r) => setTimeout(r, 250));
  await imu.stop();
  const count = samples.length;
  assert.ok(count >= 5, `expected samples, got ${count}`);
  assert.strictEqual(maxActive, 1);
  assert.ok(motions.length >= 1);
  assert.strictEqual(motions[0].next.motion, 'moving');
  assert.ok(samples.every((s) => typeof s.roll === 'number' && s.driver === 'mock'));

  await new Promise((r) => setTimeout(r, 30));
  assert.strictEqual(samples.length, count, 'no samples after stop');
  await imu.dispose();
});

test('ManagedImu - polling loop emits error and keeps running', async () => {
  let calls = 0;
  class Flaky extends BaseImuDriver {
    constructor() {
      super('flaky');
    }
    async readRaw() {
      calls += 1;
      if (calls % 2 === 0) throw new Error('bus glitch');
      return { accel: { x: 0, y: 0, z: 1 }, gyro: { x: 0, y: 0, z: 0 }, timestamp: calls * 20 };
    }
  }
  const imu = new ManagedImu(new Flaky(), { sampleRateHz: 200 });
  const errors = [];
  let samples = 0;
  imu.on('error', (e) => errors.push(e));
  imu.on('sample', () => {
    samples += 1;
  });
  imu.start();
  await new Promise((r) => setTimeout(r, 100));
  await imu.stop();
  assert.ok(errors.length >= 2);
  assert.ok(errors.every((e) => e instanceof ImuReadError));
  assert.ok(samples >= 2);
});
