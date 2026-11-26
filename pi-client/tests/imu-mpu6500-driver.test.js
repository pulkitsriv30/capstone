const test = require('node:test');
const assert = require('node:assert');
const Mpu6500Driver = require('../src/sensors/imu/mpu6500.driver');
const { REGISTERS, parseRawBlock } = require('../src/sensors/imu/mpu6500.driver');
const {
  ImuUnavailableError,
  ImuReadError,
  ImuConfigError,
} = require('../src/sensors/imu/imu.errors');

/**
 * Fake promisified i2c-bus: a 128-byte register file per address, records every write.
 */
const createFakeBus = ({ whoAmI = 0x70, address = 0x68, failRead = null, failWrite = false } = {}) => {
  const regs = new Uint8Array(128);
  regs[REGISTERS.WHO_AM_I] = whoAmI;
  const bus = {
    regs,
    writes: [],
    reads: [],
    closed: false,
    async readByte(addr, reg) {
      if (addr !== address) {
        const err = new Error('Remote I/O error');
        err.code = 'EREMOTEIO';
        throw err;
      }
      bus.reads.push(reg);
      return regs[reg];
    },
    async writeByte(addr, reg, val) {
      if (failWrite) throw new Error('write failed');
      bus.writes.push({ addr, reg, val });
      regs[reg] = reg === REGISTERS.PWR_MGMT_1 ? val & 0x7f : val; // DEVICE_RESET self-clears
    },
    async readI2cBlock(addr, reg, length, buffer) {
      if (failRead) throw failRead;
      for (let i = 0; i < length; i += 1) buffer[i] = regs[reg + i];
      return { bytesRead: length, buffer };
    },
    async close() {
      bus.closed = true;
    },
  };
  // Helper: load signed 16-bit values into the 14-byte data block at ACCEL_XOUT_H.
  bus.setRaw = (values) => {
    const buf = Buffer.alloc(14);
    values.forEach((v, i) => buf.writeInt16BE(v, i * 2));
    regs.set(buf, REGISTERS.ACCEL_XOUT_H);
  };
  return bus;
};

const makeDriver = (bus, options = {}) =>
  new Mpu6500Driver({
    openBus: async () => bus,
    sleep: async () => {},
    now: () => 1234,
    ...options,
  });

test('Mpu6500Driver - init reads WHO_AM_I and writes the register sequence', async () => {
  const bus = createFakeBus();
  const sleeps = [];
  const driver = makeDriver(bus, {
    accelRangeG: 8,
    gyroRangeDps: 1000,
    sleep: async (ms) => sleeps.push(ms),
  });
  assert.strictEqual(driver.name, 'mpu6500');
  await driver.init();

  assert.strictEqual(driver.initialized, true);
  assert.strictEqual(driver.chip, 'MPU-6500');
  assert.deepStrictEqual(bus.reads, [0x75]);
  assert.deepStrictEqual(
    bus.writes.map(({ reg, val }) => [reg, val]),
    [
      [0x6b, 0x80], // reset
      [0x6b, 0x01], // wake, PLL clock
      [0x6c, 0x00], // all axes on
      [0x19, 19], // SMPLRT_DIV -> 1kHz/20 = 50 Hz
      [0x1a, 3], // DLPF_CFG
      [0x1b, 0x10], // GYRO_CONFIG FS_SEL=2 (1000 dps)
      [0x1c, 0x10], // ACCEL_CONFIG AFS_SEL=2 (8 g)
      [0x1d, 3], // ACCEL_CONFIG2 A_DLPF_CFG
    ]
  );
  assert.ok(bus.writes.every((w) => w.addr === 0x68));
  assert.strictEqual(sleeps[0], 100);
});

test('Mpu6500Driver - range bit encoding for every full-scale setting', async () => {
  const cases = [
    [2, 250, 0x00, 0x00],
    [4, 500, 0x08, 0x08],
    [8, 1000, 0x10, 0x10],
    [16, 2000, 0x18, 0x18],
  ];
  for (const [g, dps, accelBits, gyroBits] of cases) {
    const bus = createFakeBus();
    await makeDriver(bus, { accelRangeG: g, gyroRangeDps: dps }).init();
    assert.strictEqual(bus.regs[REGISTERS.ACCEL_CONFIG], accelBits, `accel ${g}g`);
    assert.strictEqual(bus.regs[REGISTERS.GYRO_CONFIG], gyroBits, `gyro ${dps}dps`);
  }
});

test('Mpu6500Driver - WHO_AM_I handling', async () => {
  for (const id of [0x71, 0x73]) {
    const bus = createFakeBus({ whoAmI: id });
    const driver = makeDriver(bus);
    await driver.init();
    assert.match(driver.chip, /MPU-92(50|55)/);
  }

  const bus6050 = createFakeBus({ whoAmI: 0x68 });
  const d6050 = makeDriver(bus6050);
  await d6050.init();
  assert.strictEqual(d6050.chip, 'MPU-6050');
  assert.ok(!bus6050.writes.some((w) => w.reg === REGISTERS.ACCEL_CONFIG2), 'no ACCEL_CONFIG2 on 6050');

  const badBus = createFakeBus({ whoAmI: 0x12 });
  await assert.rejects(
    () => makeDriver(badBus).init(),
    (err) => err instanceof ImuUnavailableError && /0x12/.test(err.message) && /i2cdetect/.test(err.message)
  );
  assert.strictEqual(badBus.closed, true);
  assert.strictEqual(badBus.writes.length, 0);

  // Nothing at the configured address (AD0 high but driver uses 0x68)
  const wrongAddrBus = createFakeBus({ address: 0x69 });
  await assert.rejects(
    () => makeDriver(wrongAddrBus).init(),
    (err) => err instanceof ImuUnavailableError && /0x68/.test(err.message)
  );
});

test('Mpu6500Driver - readRaw scales accel, gyro and temperature', async () => {
  const bus = createFakeBus();
  const driver = makeDriver(bus, { accelRangeG: 4, gyroRangeDps: 500 });
  await driver.init();
  // ax=0, ay=-0.5g, az=+1g at 8192 LSB/g; temp raw 3339 -> ~31 C; gyro 65.5 LSB/dps
  bus.setRaw([0, -4096, 8192, 3339, 655, -131, 6550]);

  const sample = await driver.readRaw();
  assert.deepStrictEqual(sample.accel, { x: 0, y: -0.5, z: 1 });
  assert.ok(Math.abs(sample.gyro.x - 10) < 1e-9);
  assert.ok(Math.abs(sample.gyro.y - -2) < 1e-9);
  assert.ok(Math.abs(sample.gyro.z - 100) < 1e-9);
  assert.ok(Math.abs(sample.tempC - (3339 / 333.87 + 21)) < 1e-9);
  assert.ok(Math.abs(sample.tempC - 31) < 0.01);
  assert.strictEqual(sample.timestamp, 1234);
});

test('parseRawBlock - big-endian signed parsing across ranges', () => {
  const buf = Buffer.alloc(14);
  buf.writeInt16BE(16384, 0);
  buf.writeInt16BE(-32768, 2);
  buf.writeInt16BE(32767, 4);
  buf.writeInt16BE(0, 6);
  buf.writeInt16BE(131, 8);
  buf.writeInt16BE(-16, 10);
  buf.writeInt16BE(164, 12);

  const s2 = parseRawBlock(buf, { accelRangeG: 2, gyroRangeDps: 250 });
  assert.strictEqual(s2.accel.x, 1);
  assert.strictEqual(s2.accel.y, -2);
  assert.ok(Math.abs(s2.accel.z - 32767 / 16384) < 1e-12);
  assert.strictEqual(s2.tempC, 21);
  assert.strictEqual(s2.gyro.x, 1);

  const s16 = parseRawBlock(buf, { accelRangeG: 16, gyroRangeDps: 2000 });
  assert.strictEqual(s16.accel.x, 8);
  assert.strictEqual(s16.accel.y, -16);
  assert.ok(Math.abs(s16.gyro.z - 10) < 1e-12);
  assert.ok(Math.abs(s16.gyro.y - -16 / 16.4) < 1e-12);

  assert.throws(() => parseRawBlock(Buffer.alloc(6), {}), (err) => err instanceof ImuReadError);
  assert.throws(() => parseRawBlock(buf, { accelRangeG: 3, gyroRangeDps: 250 }), (err) => err instanceof ImuConfigError);
});

test('Mpu6500Driver - maps open errors to actionable ImuUnavailableError', async () => {
  const cases = [
    ['ENOENT', /raspi-config/],
    ['EACCES', /i2c group/],
    ['EREMOTEIO', /i2cdetect -y 1/],
  ];
  for (const [code, hint] of cases) {
    const driver = new Mpu6500Driver({
      openBus: async () => {
        const err = new Error(code);
        err.code = code;
        throw err;
      },
    });
    await assert.rejects(
      () => driver.init(),
      (err) => err instanceof ImuUnavailableError && hint.test(err.message) && err.cause && err.cause.code === code
    );
    assert.strictEqual(driver.initialized, false);
  }
});

test('Mpu6500Driver - read I/O errors become ImuReadError; short reads rejected', async () => {
  const ioErr = new Error('EIO');
  ioErr.code = 'EIO';
  const bus = createFakeBus({ failRead: ioErr });
  const driver = makeDriver(bus);
  await driver.init();
  await assert.rejects(
    () => driver.readRaw(),
    (err) => err instanceof ImuReadError && err.cause === ioErr
  );

  const shortBus = createFakeBus();
  shortBus.readI2cBlock = async (addr, reg, length, buffer) => ({ bytesRead: 6, buffer });
  const shortDriver = makeDriver(shortBus);
  await shortDriver.init();
  await assert.rejects(() => shortDriver.readRaw(), (err) => err instanceof ImuReadError);
});

test('Mpu6500Driver - config failure during init closes bus', async () => {
  const bus = createFakeBus({ failWrite: true });
  await assert.rejects(() => makeDriver(bus).init(), (err) => err instanceof ImuUnavailableError);
  assert.strictEqual(bus.closed, true);
});

test('Mpu6500Driver - dispose sleeps the chip, closes the bus, ignores errors', async () => {
  const bus = createFakeBus();
  const driver = makeDriver(bus);
  await driver.init();
  await driver.dispose();
  const last = bus.writes[bus.writes.length - 1];
  assert.deepStrictEqual([last.reg, last.val], [0x6b, 0x40]);
  assert.strictEqual(bus.closed, true);
  assert.strictEqual(driver.initialized, false);

  const brokenBus = createFakeBus();
  const broken = makeDriver(brokenBus);
  await broken.init();
  brokenBus.writeByte = async () => {
    throw new Error('gone');
  };
  brokenBus.close = async () => {
    throw new Error('gone');
  };
  await broken.dispose(); // must not throw
  await driver.dispose(); // double dispose is safe
});

test('Mpu6500Driver - rejects invalid options', () => {
  assert.throws(() => new Mpu6500Driver({ accelRangeG: 3 }), (err) => err instanceof ImuConfigError);
  assert.throws(() => new Mpu6500Driver({ gyroRangeDps: 300 }), (err) => err instanceof ImuConfigError);
  assert.throws(() => new Mpu6500Driver({ dlpfConfig: 9 }), (err) => err instanceof ImuConfigError);
  assert.throws(() => new Mpu6500Driver({ sampleRateDivider: 256 }), (err) => err instanceof ImuConfigError);
});
