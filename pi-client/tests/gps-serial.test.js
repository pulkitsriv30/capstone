const test = require('node:test');
const assert = require('node:assert');
const { PassThrough } = require('stream');
const SerialGpsDriver = require('../src/sensors/gps/serial.driver');
const { ENABLE_GST } = require('../src/sensors/gps/ubx');
const { GpsUnavailableError } = require('../src/sensors/gps/gps.errors');

const fakeFs = () => {
  const state = { writes: [], stream: null, openedPath: null, closed: false };
  const handle = {
    createReadStream: (opts) => {
      state.stream = new PassThrough();
      state.stream.setEncoding(opts.encoding);
      return state.stream;
    },
    write: async (buf) => {
      state.writes.push(Buffer.from(buf));
    },
    close: async () => {
      state.closed = true;
    },
  };
  return {
    state,
    fsImpl: {
      promises: {
        open: async (p) => {
          state.openedPath = p;
          return handle;
        },
      },
    },
  };
};

test('SerialGpsDriver - Configures Port, Sends UBX GST Request, Splits Lines Across Chunks', async () => {
  const sttyCalls = [];
  const { state, fsImpl } = fakeFs();
  const driver = new SerialGpsDriver({
    device: '/dev/ttyAMA0',
    baudRate: 9600,
    execFile: async (bin, args) => {
      sttyCalls.push({ bin, args });
      return { stdout: '', stderr: '' };
    },
    fsImpl,
  });

  const lines = [];
  driver.on('line', (l) => lines.push(l));
  await driver.open();

  assert.strictEqual(sttyCalls[0].bin, 'stty');
  assert.deepStrictEqual(sttyCalls[0].args.slice(0, 4), ['-F', '/dev/ttyAMA0', '9600', 'raw']);
  assert.strictEqual(state.openedPath, '/dev/ttyAMA0');
  assert.deepStrictEqual(state.writes[0], ENABLE_GST);

  state.stream.write('$GPGGA,1,2');
  state.stream.write(',3*00\r\n$GPRMC,a*00\r\nnoise\r\n$GPG');
  state.stream.write('SV,x*00\n');
  await new Promise((r) => setImmediate(r));

  assert.deepStrictEqual(lines, ['$GPGGA,1,2,3*00', '$GPRMC,a*00', '$GPGSV,x*00']);

  await driver.close();
  assert.strictEqual(state.closed, true);
  assert.strictEqual(driver.opened, false);
});

test('SerialGpsDriver - Clear Error When Port Cannot Be Configured', async () => {
  const driver = new SerialGpsDriver({
    execFile: async () => {
      const err = new Error('stty: /dev/serial0: No such file or directory');
      err.code = 1;
      throw err;
    },
    fsImpl: fakeFs().fsImpl,
  });
  await assert.rejects(
    () => driver.open(),
    (err) => err instanceof GpsUnavailableError && /dialout/.test(err.message) && err.code === 'GPS_UNAVAILABLE'
  );
});

test('SerialGpsDriver - GST Request Can Be Disabled', async () => {
  const { state, fsImpl } = fakeFs();
  const driver = new SerialGpsDriver({ enableGst: false, execFile: async () => ({}), fsImpl });
  await driver.open();
  assert.strictEqual(state.writes.length, 0);
  await driver.close();
});
