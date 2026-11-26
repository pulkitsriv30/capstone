/**
 * InvenSense MPU-6500 6-axis IMU driver over I2C (Raspberry Pi: /dev/i2c-1, pins 3/5).
 *
 * NOTE: the MPU-6500 has NO magnetometer. This driver only reports accelerometer,
 * gyroscope and die temperature. Any heading derived from it is relative and drifts.
 *
 * Register values follow the MPU-6500 Register Map and Descriptions (RM-MPU-6500A-00).
 */
const { BaseImuDriver } = require('./imu.interface');
const { ImuUnavailableError, ImuReadError, ImuConfigError } = require('./imu.errors');
const logger = require('../../utils/logger');

const REGISTERS = Object.freeze({
  SMPLRT_DIV: 0x19,
  CONFIG: 0x1a,
  GYRO_CONFIG: 0x1b,
  ACCEL_CONFIG: 0x1c,
  ACCEL_CONFIG2: 0x1d,
  ACCEL_XOUT_H: 0x3b,
  TEMP_OUT_H: 0x41,
  GYRO_XOUT_H: 0x43,
  PWR_MGMT_1: 0x6b,
  PWR_MGMT_2: 0x6c,
  WHO_AM_I: 0x75,
});

const PWR_MGMT_1_BITS = Object.freeze({
  DEVICE_RESET: 0x80,
  SLEEP: 0x40,
  CLKSEL_PLL: 0x01, // auto-select best clock (PLL when gyro is ready)
});

const WHO_AM_I_VALUES = Object.freeze({
  MPU6500: 0x70,
  MPU9250: 0x71,
  MPU9255: 0x73,
  MPU6050: 0x68,
});

// FS_SEL / AFS_SEL live in bits [4:3] of GYRO_CONFIG / ACCEL_CONFIG.
const ACCEL_RANGES = Object.freeze({
  2: { bits: 0x00, lsbPerG: 16384 },
  4: { bits: 0x08, lsbPerG: 8192 },
  8: { bits: 0x10, lsbPerG: 4096 },
  16: { bits: 0x18, lsbPerG: 2048 },
});

const GYRO_RANGES = Object.freeze({
  250: { bits: 0x00, lsbPerDps: 131 },
  500: { bits: 0x08, lsbPerDps: 65.5 },
  1000: { bits: 0x10, lsbPerDps: 32.8 },
  2000: { bits: 0x18, lsbPerDps: 16.4 },
});

// Temperature: MPU-6500/9250 TEMP_degC = TEMP_OUT / 333.87 + 21 (RoomTemp_Offset = 21 degC).
const TEMP_MPU6500 = Object.freeze({ sensitivity: 333.87, offsetC: 21 });
// MPU-6050 (register-compatible clone boards) uses TEMP_OUT / 340 + 36.53.
const TEMP_MPU6050 = Object.freeze({ sensitivity: 340, offsetC: 36.53 });

const RAW_BLOCK_LENGTH = 14;
const RESET_DELAY_MS = 100;
const WAKE_DELAY_MS = 10;

const WIRING_HINT =
  'Check wiring (VCC->3.3V pin 1, GND->pin 6, SDA->GPIO2 pin 3, SCL->GPIO3 pin 5), the AD0 pin (low=0x68, high=0x69) and run "i2cdetect -y 1".';

const defaultOpenBus = async (busNumber) => {
  let i2c;
  try {
    // Lazy require: i2c-bus is a native module only needed on the Pi.
    // eslint-disable-next-line global-require
    i2c = require('i2c-bus');
  } catch (err) {
    throw new ImuUnavailableError(
      'The "i2c-bus" package is not installed. Run "npm install i2c-bus@^5.2.3" on the Raspberry Pi, or use IMU_MODE=mock.',
      err
    );
  }
  return i2c.openPromisified(busNumber);
};

const defaultSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Pure helper: converts a 14-byte burst read starting at ACCEL_XOUT_H into a Sample.
 * Layout: AX_H AX_L AY_H AY_L AZ_H AZ_L T_H T_L GX_H GX_L GY_H GY_L GZ_H GZ_L (big-endian int16).
 */
const parseRawBlock = (buffer, { accelRangeG = 2, gyroRangeDps = 250, temp = TEMP_MPU6500 } = {}) => {
  if (!Buffer.isBuffer(buffer) || buffer.length < RAW_BLOCK_LENGTH) {
    throw new ImuReadError(`Expected ${RAW_BLOCK_LENGTH}-byte sensor block, got ${buffer ? buffer.length : 0} bytes`);
  }
  const accel = ACCEL_RANGES[accelRangeG];
  const gyro = GYRO_RANGES[gyroRangeDps];
  if (!accel) throw new ImuConfigError(`Unsupported accelRangeG: ${accelRangeG}`);
  if (!gyro) throw new ImuConfigError(`Unsupported gyroRangeDps: ${gyroRangeDps}`);

  const raw = (offset) => buffer.readInt16BE(offset);
  return {
    accel: {
      x: raw(0) / accel.lsbPerG,
      y: raw(2) / accel.lsbPerG,
      z: raw(4) / accel.lsbPerG,
    },
    tempC: raw(6) / temp.sensitivity + temp.offsetC,
    gyro: {
      x: raw(8) / gyro.lsbPerDps,
      y: raw(10) / gyro.lsbPerDps,
      z: raw(12) / gyro.lsbPerDps,
    },
  };
};

const formatHex = (value) => `0x${Number(value).toString(16).padStart(2, '0')}`;

const mapOpenError = (err, busNumber) => {
  const code = err && err.code;
  const device = `/dev/i2c-${busNumber}`;
  if (code === 'ENOENT') {
    return new ImuUnavailableError(
      `${device} does not exist. Enable I2C with "sudo raspi-config" (Interface Options > I2C) or add dtparam=i2c_arm=on to /boot/firmware/config.txt, then reboot.`,
      err
    );
  }
  if (code === 'EACCES' || code === 'EPERM') {
    return new ImuUnavailableError(
      `Permission denied opening ${device}. Add the user to the i2c group ("sudo usermod -aG i2c $USER") and log in again.`,
      err
    );
  }
  if (code === 'EREMOTEIO' || code === 'ENXIO' || code === 'EIO') {
    return new ImuUnavailableError(`No response from the IMU on ${device}. ${WIRING_HINT}`, err);
  }
  return new ImuUnavailableError(`Failed to open ${device}: ${err && err.message}. ${WIRING_HINT}`, err);
};

class Mpu6500Driver extends BaseImuDriver {
  constructor(options = {}) {
    super('mpu6500');
    this.busNumber = options.busNumber ?? 1;
    this.address = options.address ?? 0x68;
    this.accelRangeG = Number(options.accelRangeG ?? 4);
    this.gyroRangeDps = Number(options.gyroRangeDps ?? 500);
    this.dlpfConfig = options.dlpfConfig ?? 3;
    this.sampleRateDivider = options.sampleRateDivider ?? 19;
    this.openBus = options.openBus || defaultOpenBus;
    this.sleep = options.sleep || defaultSleep;
    this.now = options.now || (() => Date.now());

    if (!ACCEL_RANGES[this.accelRangeG]) {
      throw new ImuConfigError(`accelRangeG must be one of ${Object.keys(ACCEL_RANGES).join(', ')} (got ${options.accelRangeG})`);
    }
    if (!GYRO_RANGES[this.gyroRangeDps]) {
      throw new ImuConfigError(`gyroRangeDps must be one of ${Object.keys(GYRO_RANGES).join(', ')} (got ${options.gyroRangeDps})`);
    }
    if (!Number.isInteger(this.dlpfConfig) || this.dlpfConfig < 0 || this.dlpfConfig > 7) {
      throw new ImuConfigError(`dlpfConfig must be an integer 0..7 (got ${options.dlpfConfig})`);
    }
    if (!Number.isInteger(this.sampleRateDivider) || this.sampleRateDivider < 0 || this.sampleRateDivider > 255) {
      throw new ImuConfigError(`sampleRateDivider must be an integer 0..255 (got ${options.sampleRateDivider})`);
    }

    this.bus = null;
    this.chip = null;
    this.whoAmI = null;
    this.tempModel = TEMP_MPU6500;
    this.readBuffer = Buffer.alloc(RAW_BLOCK_LENGTH);
  }

  async init() {
    if (this.initialized) return;

    try {
      this.bus = await this.openBus(this.busNumber);
    } catch (err) {
      if (err instanceof ImuUnavailableError) throw err;
      throw mapOpenError(err, this.busNumber);
    }

    try {
      let whoAmI;
      try {
        whoAmI = await this.bus.readByte(this.address, REGISTERS.WHO_AM_I);
      } catch (err) {
        throw new ImuUnavailableError(
          `No IMU answered at address ${formatHex(this.address)} on /dev/i2c-${this.busNumber} (${err.message}). ${WIRING_HINT}`,
          err
        );
      }
      this.whoAmI = whoAmI;
      this.identifyChip(whoAmI);

      await this.configure();
    } catch (err) {
      await this.closeBusQuietly();
      if (err instanceof ImuUnavailableError || err instanceof ImuConfigError) throw err;
      throw new ImuUnavailableError(`Failed to configure IMU: ${err.message}`, err);
    }

    this.initialized = true;
    logger.info('IMU initialized', {
      driver: this.name,
      chip: this.chip,
      whoAmI: formatHex(this.whoAmI),
      bus: this.busNumber,
      address: formatHex(this.address),
      accelRangeG: this.accelRangeG,
      gyroRangeDps: this.gyroRangeDps,
      sampleRateHz: Math.round(1000 / (1 + this.sampleRateDivider)),
    });
  }

  identifyChip(whoAmI) {
    switch (whoAmI) {
      case WHO_AM_I_VALUES.MPU6500:
        this.chip = 'MPU-6500';
        break;
      case WHO_AM_I_VALUES.MPU9250:
      case WHO_AM_I_VALUES.MPU9255:
        this.chip = whoAmI === WHO_AM_I_VALUES.MPU9250 ? 'MPU-9250' : 'MPU-9255';
        logger.warn('IMU reports MPU-9250/9255; using its MPU-6500 core only (magnetometer not used)', {
          whoAmI: formatHex(whoAmI),
        });
        break;
      case WHO_AM_I_VALUES.MPU6050:
        this.chip = 'MPU-6050';
        this.tempModel = TEMP_MPU6050;
        logger.warn('IMU reports MPU-6050, not MPU-6500; continuing with compatible registers', {
          whoAmI: formatHex(whoAmI),
        });
        break;
      default:
        throw new ImuUnavailableError(
          `Unexpected WHO_AM_I ${formatHex(whoAmI)} at address ${formatHex(this.address)} (expected 0x70 for MPU-6500). Another device may be on this address. ${WIRING_HINT}`
        );
    }
  }

  async configure() {
    const write = (reg, val) => this.bus.writeByte(this.address, reg, val);

    // Full reset, then wake with auto-selected PLL clock (SLEEP bit cleared).
    await write(REGISTERS.PWR_MGMT_1, PWR_MGMT_1_BITS.DEVICE_RESET);
    await this.sleep(RESET_DELAY_MS);
    await write(REGISTERS.PWR_MGMT_1, PWR_MGMT_1_BITS.CLKSEL_PLL);
    await this.sleep(WAKE_DELAY_MS);
    // Enable all accel and gyro axes.
    await write(REGISTERS.PWR_MGMT_2, 0x00);

    // Sample rate = internal 1 kHz (DLPF enabled) / (1 + SMPLRT_DIV).
    await write(REGISTERS.SMPLRT_DIV, this.sampleRateDivider);
    // DLPF_CFG bits [2:0] (FCHOICE_B = 00 so the DLPF is used).
    await write(REGISTERS.CONFIG, this.dlpfConfig & 0x07);
    await write(REGISTERS.GYRO_CONFIG, GYRO_RANGES[this.gyroRangeDps].bits);
    await write(REGISTERS.ACCEL_CONFIG, ACCEL_RANGES[this.accelRangeG].bits);
    // ACCEL_CONFIG2: ACCEL_FCHOICE_B=0, A_DLPF_CFG bits [2:0]. Not present on the MPU-6050.
    if (this.chip !== 'MPU-6050') {
      await write(REGISTERS.ACCEL_CONFIG2, this.dlpfConfig & 0x07);
    }
  }

  async readRaw() {
    if (!this.initialized) {
      await this.init();
    }

    let result;
    try {
      result = await this.bus.readI2cBlock(this.address, REGISTERS.ACCEL_XOUT_H, RAW_BLOCK_LENGTH, this.readBuffer);
    } catch (err) {
      throw new ImuReadError(`I2C read from IMU failed: ${err.message}`, err);
    }

    const bytesRead = result && typeof result.bytesRead === 'number' ? result.bytesRead : RAW_BLOCK_LENGTH;
    if (bytesRead !== RAW_BLOCK_LENGTH) {
      throw new ImuReadError(`Short I2C read from IMU: got ${bytesRead} of ${RAW_BLOCK_LENGTH} bytes`);
    }
    const buffer = (result && result.buffer) || this.readBuffer;

    const parsed = parseRawBlock(buffer, {
      accelRangeG: this.accelRangeG,
      gyroRangeDps: this.gyroRangeDps,
      temp: this.tempModel,
    });
    return { ...parsed, timestamp: this.now() };
  }

  async dispose() {
    if (this.bus) {
      try {
        await this.bus.writeByte(this.address, REGISTERS.PWR_MGMT_1, PWR_MGMT_1_BITS.SLEEP);
      } catch (err) {
        logger.debug('Ignoring error while putting IMU to sleep', { message: err.message });
      }
    }
    await this.closeBusQuietly();
    this.initialized = false;
  }

  async closeBusQuietly() {
    if (!this.bus) return;
    const bus = this.bus;
    this.bus = null;
    try {
      await bus.close();
    } catch (err) {
      logger.debug('Ignoring error while closing I2C bus', { message: err.message });
    }
  }
}

module.exports = Mpu6500Driver;
module.exports.Mpu6500Driver = Mpu6500Driver;
module.exports.REGISTERS = REGISTERS;
module.exports.PWR_MGMT_1_BITS = PWR_MGMT_1_BITS;
module.exports.WHO_AM_I_VALUES = WHO_AM_I_VALUES;
module.exports.ACCEL_RANGES = ACCEL_RANGES;
module.exports.GYRO_RANGES = GYRO_RANGES;
module.exports.TEMP_MPU6500 = TEMP_MPU6500;
module.exports.TEMP_MPU6050 = TEMP_MPU6050;
module.exports.parseRawBlock = parseRawBlock;
