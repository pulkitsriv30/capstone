const test = require('node:test');
const assert = require('node:assert');
const { createImuDriver } = require('../src/sensors/imu/imu.factory');
const { ManagedImu } = require('../src/sensors/imu/imu.interface');
const Mpu6500Driver = require('../src/sensors/imu/mpu6500.driver');
const { MockImuDriver } = require('../src/sensors/imu/mock.driver');
const { loadImuConfig } = require('../src/sensors/imu/imu.config');
const { ImuConfigError } = require('../src/sensors/imu/imu.errors');
const imu = require('../src/sensors/imu');

test('ImuFactory - mock mode returns ManagedImu with config-driven options', async () => {
  const config = loadImuConfig({ IMU_MODE: 'mock', IMU_SAMPLE_RATE_HZ: 100, IMU_CALIBRATION_SAMPLES: 60 }, {});
  const managed = createImuDriver(config, { scenario: 'stationary', seed: 7 });
  assert.ok(managed instanceof ManagedImu);
  assert.ok(managed.driver instanceof MockImuDriver);
  assert.strictEqual(managed.sampleRateHz, 100);
  assert.strictEqual(managed.calibrationSamples, 60);

  await managed.init();
  const state = await managed.read();
  assert.strictEqual(state.driver, 'mock');
  assert.strictEqual(typeof state.roll, 'number');
  await managed.dispose();
});

test('ImuFactory - mpu6500 mode passes bus/address/ranges to driver', async () => {
  const openedBuses = [];
  const config = loadImuConfig(
    {
      IMU_MODE: 'mpu6500',
      IMU_I2C_BUS: '3',
      IMU_I2C_ADDRESS: '0x69',
      IMU_ACCEL_RANGE_G: '8',
      IMU_GYRO_RANGE_DPS: '250',
    },
    {}
  );
  const writes = [];
  const fakeBus = {
    readByte: async () => 0x70,
    writeByte: async (addr, reg, val) => writes.push({ addr, reg, val }),
    readI2cBlock: async (addr, reg, len, buffer) => {
      buffer.fill(0);
      buffer.writeInt16BE(4096, 4); // +1 g on z at 8 g range
      return { bytesRead: len, buffer };
    },
    close: async () => {},
  };
  const managed = createImuDriver(config, {
    openBus: async (n) => {
      openedBuses.push(n);
      return fakeBus;
    },
    sleep: async () => {},
  });
  assert.ok(managed.driver instanceof Mpu6500Driver);
  assert.strictEqual(managed.driver.busNumber, 3);
  assert.strictEqual(managed.driver.address, 0x69);
  assert.strictEqual(managed.driver.accelRangeG, 8);
  assert.strictEqual(managed.driver.gyroRangeDps, 250);

  await managed.init();
  assert.deepStrictEqual(openedBuses, [3]);
  assert.ok(writes.every((w) => w.addr === 0x69));
  const state = await managed.read();
  assert.strictEqual(state.driver, 'mpu6500');
  assert.ok(Math.abs(state.accelMagnitude - 1) < 1e-9);
  await managed.dispose();
});

test('ImuFactory - unknown mode throws ImuConfigError', () => {
  assert.throws(() => createImuDriver({ IMU_MODE: 'bno055' }), (err) => err instanceof ImuConfigError);
});

test('IMU index - re-exports the public API', () => {
  for (const key of [
    'BaseImuDriver',
    'ManagedImu',
    'MockImuDriver',
    'Mpu6500Driver',
    'REGISTERS',
    'parseRawBlock',
    'createImuDriver',
    'loadImuConfig',
    'VALID_IMU_MODES',
    'computeCalibration',
    'applyCalibration',
    'ComplementaryFilter',
    'MotionDetector',
    'normalizeAngle360',
    'ImuUnavailableError',
    'ImuReadError',
    'ImuCalibrationError',
    'ImuConfigError',
  ]) {
    assert.ok(imu[key] !== undefined, `missing export ${key}`);
  }
  assert.strictEqual(imu.REGISTERS.WHO_AM_I, 0x75);
});
