/**
 * IMU sensor module (MPU-6500 over I2C, plus a mock for laptops/tests).
 * Heading from this module is relative and drifts; there is no magnetometer.
 */
const { BaseImuDriver, ManagedImu } = require('./imu.interface');
const processing = require('./imu.processing');
const mockDriverModule = require('./mock.driver');
const Mpu6500Driver = require('./mpu6500.driver');
const { createImuDriver } = require('./imu.factory');
const { loadImuConfig, VALID_IMU_MODES } = require('./imu.config');
const errors = require('./imu.errors');

const MockImuDriver = mockDriverModule.MockImuDriver || mockDriverModule;

module.exports = {
  BaseImuDriver,
  ManagedImu,
  ...processing,
  MockImuDriver,
  Mpu6500Driver,
  REGISTERS: Mpu6500Driver.REGISTERS,
  parseRawBlock: Mpu6500Driver.parseRawBlock,
  createImuDriver,
  loadImuConfig,
  VALID_IMU_MODES,
  ...errors,
};
