const test = require('node:test');
const assert = require('node:assert');
const { main, parseArgs, HEADING_NOTE } = require('../src/sensors/imu/imu.cli');
const { ImuConfigError } = require('../src/sensors/imu/imu.errors');

const capture = () => {
  const chunks = [];
  return { write: (s) => chunks.push(s), text: () => chunks.join(''), lines: () => chunks.join('').split('\n').filter(Boolean) };
};

test('imu.cli parseArgs', () => {
  assert.deepStrictEqual(parseArgs(['--mode=mock', '--calibrate', '--seconds=2', '--json']), {
    mode: 'mock',
    calibrate: true,
    seconds: 2,
    json: true,
    help: false,
  });
  assert.throws(() => parseArgs(['--bogus']), ImuConfigError);
  assert.throws(() => parseArgs(['--seconds=-1']), ImuConfigError);
});

test('imu.cli main - mock mode streams readings with relative-heading note', async () => {
  const out = capture();
  const err = capture();
  const code = await main(['--mode=mock', '--calibrate', '--seconds=0.6'], {
    out,
    err,
    env: { IMU_CALIBRATION_SAMPLES: '50' },
    handleSigint: false,
  });
  assert.strictEqual(code, 0, err.text());
  const text = out.text();
  assert.ok(text.includes(HEADING_NOTE));
  assert.match(HEADING_NOTE, /relative/i);
  assert.match(HEADING_NOTE, /drift/i);
  assert.match(text, /keep the device STILL and FLAT/);
  assert.match(text, /Calibration done/);
  const readings = out.lines().filter((l) => l.startsWith('roll='));
  assert.ok(readings.length >= 2 && readings.length <= 5, `got ${readings.length} lines`);
  assert.match(readings[0], /pitch=.*relHeading=.*turnRate=.*motion=.*steps=\d+/);
  assert.ok(!/compass heading:/i.test(text));
});

test('imu.cli main - json mode emits parseable state lines', async () => {
  const out = capture();
  const code = await main(['--mode=mock', '--json', '--seconds=0.5'], {
    out,
    err: capture(),
    env: {},
    handleSigint: false,
  });
  assert.strictEqual(code, 0);
  const objs = out.lines().map((l) => JSON.parse(l));
  assert.ok(objs[0].note.includes('RELATIVE'));
  const states = objs.filter((o) => 'relativeHeading' in o);
  assert.ok(states.length >= 1);
  assert.strictEqual(states[0].driver, 'mock');
});

test('imu.cli main - abort signal stops cleanly', async () => {
  const controller = new AbortController();
  setTimeout(() => controller.abort(), 150);
  const code = await main(['--mode=mock'], { out: capture(), err: capture(), env: {}, handleSigint: false, signal: controller.signal });
  assert.strictEqual(code, 0);
});

test('imu.cli main - unavailable hardware exits non-zero with message', async () => {
  const err = capture();
  const code = await main(['--mode=mpu6500', '--seconds=0.2'], {
    out: capture(),
    err,
    env: {},
    handleSigint: false,
    overrides: {
      openBus: async () => {
        const e = new Error('no such file');
        e.code = 'ENOENT';
        throw e;
      },
    },
  });
  assert.strictEqual(code, 1);
  assert.match(err.text(), /raspi-config/);
});

test('imu.cli main - invalid config exits non-zero', async () => {
  const err = capture();
  const code = await main(['--mode=nope'], { out: capture(), err, env: {}, handleSigint: false });
  assert.strictEqual(code, 1);
  assert.match(err.text(), /IMU_MODE/);
});
