const { ManagedImu } = require('./imu.interface');
const Mpu6500Driver = require('./mpu6500.driver');
const mockDriverModule = require('./mock.driver');

const MockImuDriver = mockDriverModule.MockImuDriver || mockDriverModule;
const { ImuConfigError } = require('./imu.errors');

/**
 * Builds a ManagedImu for the configured IMU_MODE.
 * `overrides` are passed to the driver (e.g. openBus, now, scenario); `overrides.now`
 * is also forwarded to ManagedImu so both share one clock in tests.
 */
const createImuDriver = (config = {}, overrides = {}) => {
  const mode = String(config.IMU_MODE || 'mock').trim().toLowerCase();
  let driver;

  switch (mode) {
    case 'mpu6500':
      driver = new Mpu6500Driver({
        busNumber: config.IMU_I2C_BUS,
        address: config.IMU_I2C_ADDRESS,
        accelRangeG: config.IMU_ACCEL_RANGE_G,
        gyroRangeDps: config.IMU_GYRO_RANGE_DPS,
        ...overrides,
      });
      break;

    case 'mock':
      driver = new MockImuDriver(overrides);
      break;

    default:
      throw new ImuConfigError(`Unsupported IMU_MODE: "${mode}" (expected mpu6500 or mock)`);
  }

  const managedOptions = {};
  if (config.IMU_SAMPLE_RATE_HZ !== undefined) managedOptions.sampleRateHz = config.IMU_SAMPLE_RATE_HZ;
  if (config.IMU_CALIBRATION_SAMPLES !== undefined) {
    managedOptions.calibrationSamples = config.IMU_CALIBRATION_SAMPLES;
  }
  if (typeof overrides.now === 'function') managedOptions.now = overrides.now;

  return new ManagedImu(driver, managedOptions);
};

module.exports = {
  createImuDriver,
};
