const test = require('node:test');
const assert = require('node:assert');
const { loadImuConfig, VALID_IMU_MODES } = require('../src/sensors/imu/imu.config');
const { ImuConfigError } = require('../src/sensors/imu/imu.errors');

test('loadImuConfig - defaults with empty env', () => {
  const config = loadImuConfig({}, {});
  assert.deepStrictEqual({ ...config }, {
    IMU_ENABLED: false,
    IMU_MODE: 'mock',
    IMU_I2C_BUS: 1,
    IMU_I2C_ADDRESS: 0x68,
    IMU_ACCEL_RANGE_G: 4,
    IMU_GYRO_RANGE_DPS: 500,
    IMU_SAMPLE_RATE_HZ: 50,
    IMU_CALIBRATION_SAMPLES: 200,
  });
  assert.ok(Object.isFrozen(config));
  assert.ok(VALID_IMU_MODES.has('mpu6500'));
  assert.ok(VALID_IMU_MODES.has('mock'));
});

test('loadImuConfig - parses env strings, overrides win', () => {
  const env = {
    IMU_ENABLED: 'true',
    IMU_MODE: ' MPU6500 ',
    IMU_I2C_BUS: '0',
    IMU_I2C_ADDRESS: '0x69',
    IMU_ACCEL_RANGE_G: '16',
    IMU_GYRO_RANGE_DPS: '2000',
    IMU_SAMPLE_RATE_HZ: '100',
    IMU_CALIBRATION_SAMPLES: '500',
  };
  const config = loadImuConfig({ IMU_SAMPLE_RATE_HZ: 25 }, env);
  assert.strictEqual(config.IMU_ENABLED, true);
  assert.strictEqual(config.IMU_MODE, 'mpu6500');
  assert.strictEqual(config.IMU_I2C_BUS, 0);
  assert.strictEqual(config.IMU_I2C_ADDRESS, 0x69);
  assert.strictEqual(config.IMU_ACCEL_RANGE_G, 16);
  assert.strictEqual(config.IMU_GYRO_RANGE_DPS, 2000);
  assert.strictEqual(config.IMU_SAMPLE_RATE_HZ, 25);
  assert.strictEqual(config.IMU_CALIBRATION_SAMPLES, 500);
});

test('loadImuConfig - I2C address forms', () => {
  for (const value of ['0x68', '0X68', 104, '104']) {
    assert.strictEqual(loadImuConfig({ IMU_I2C_ADDRESS: value }, {}).IMU_I2C_ADDRESS, 0x68);
  }
  for (const value of ['0x69', 105, '105']) {
    assert.strictEqual(loadImuConfig({ IMU_I2C_ADDRESS: value }, {}).IMU_I2C_ADDRESS, 0x69);
  }
  for (const value of ['0x70', 'abc', 0x40, '68']) {
    assert.throws(() => loadImuConfig({ IMU_I2C_ADDRESS: value }, {}), ImuConfigError);
  }
});

test('loadImuConfig - rejects invalid values with ImuConfigError', () => {
  const bad = [
    { IMU_MODE: 'bno055' },
    { IMU_ENABLED: 'yes' },
    { IMU_I2C_BUS: '11' },
    { IMU_I2C_BUS: '1.5' },
    { IMU_ACCEL_RANGE_G: '3' },
    { IMU_GYRO_RANGE_DPS: '300' },
    { IMU_SAMPLE_RATE_HZ: '5' },
    { IMU_SAMPLE_RATE_HZ: '201' },
    { IMU_CALIBRATION_SAMPLES: '49' },
    { IMU_CALIBRATION_SAMPLES: '2001' },
  ];
  for (const override of bad) {
    assert.throws(
      () => loadImuConfig(override, {}),
      (err) => err instanceof ImuConfigError && err.code === 'IMU_CONFIG_ERROR',
      JSON.stringify(override)
    );
  }
});

test('loadImuConfig - booleans', () => {
  assert.strictEqual(loadImuConfig({ IMU_ENABLED: '1' }, {}).IMU_ENABLED, true);
  assert.strictEqual(loadImuConfig({ IMU_ENABLED: 'FALSE' }, {}).IMU_ENABLED, false);
  assert.strictEqual(loadImuConfig({ IMU_ENABLED: true }, {}).IMU_ENABLED, true);
  assert.strictEqual(loadImuConfig({}, { IMU_ENABLED: '' }).IMU_ENABLED, false);
});
