const test = require('node:test');
const assert = require('node:assert');
const { ManagedGps, BaseGpsDriver, GPS_STATUS } = require('../src/sensors/gps/gps.interface');
const MockGpsDriver = require('../src/sensors/gps/mock.driver');
const { buildEpoch, DEFAULT_START } = require('../src/sensors/gps/mock.driver');
const { createGps } = require('../src/sensors/gps/gps.factory');
const { loadGpsConfig } = require('../src/sensors/gps/gps.config');
const { validateChecksum } = require('../src/sensors/gps/nmea.parser');
const { ConfigValidationError } = require('../src/utils/errors');

/** ManagedGps with a manual clock and no timer, fed line by line. */
const setup = (options = {}) => {
  let nowMs = 1_000_000;
  const gps = new ManagedGps(new BaseGpsDriver('test'), {
    updateIntervalMs: 0,
    now: () => nowMs,
    ...options,
  });
  const feed = (epochOptions = {}) => {
    for (const line of buildEpoch({ ...DEFAULT_START, ...epochOptions })) gps.handleLine(line);
  };
  const advance = (ms) => {
    nowMs += ms;
  };
  return { gps, feed, advance };
};

test('ManagedGps - Reports Fix With GST Accuracy and Satellite Info', () => {
  const { gps, feed } = setup();
  feed();
  const fix = gps.getFix();
  assert.strictEqual(fix.status, GPS_STATUS.FIX);
  assert.strictEqual(fix.reliable, true);
  assert.strictEqual(fix.reason, null);
  assert.ok(Math.abs(fix.latitude - DEFAULT_START.latitude) < 1e-6);
  assert.ok(Math.abs(fix.longitude - DEFAULT_START.longitude) < 1e-6);
  assert.strictEqual(fix.accuracySource, 'gst');
  assert.strictEqual(fix.accuracyM, Number(Math.sqrt(3.2 ** 2 + 2.6 ** 2).toFixed(1)));
  assert.strictEqual(fix.fixType, '3d');
  assert.strictEqual(fix.satellitesUsed, 8);
  assert.strictEqual(fix.satellitesInView, 8);
  assert.strictEqual(fix.ageMs, 0);
});

test('ManagedGps - Falls Back to Labelled HDOP Estimate When GST Is Missing (Clone Modules)', () => {
  const { gps, feed } = setup();
  feed({ includeGst: false, hdop: 1.2 });
  const fix = gps.getFix();
  assert.strictEqual(fix.accuracySource, 'hdop_estimate');
  assert.strictEqual(fix.accuracyM, 6);
  assert.strictEqual(fix.reliable, true);
});

test('ManagedGps - Flags Poor Accuracy as Unreliable', () => {
  const { gps, feed } = setup({ maxAccuracyM: 25 });
  feed({ includeGst: false, hdop: 8 });
  const fix = gps.getFix();
  assert.strictEqual(fix.status, GPS_STATUS.FIX);
  assert.strictEqual(fix.accuracyM, 40);
  assert.strictEqual(fix.reliable, false);
  assert.strictEqual(fix.reason, 'low_accuracy');
});

test('ManagedGps - Searching, Lost Fix and No Signal States', () => {
  const { gps, feed, advance } = setup({ signalTimeoutMs: 3000, staleMs: 5000 });

  assert.strictEqual(gps.getFix().status, GPS_STATUS.NO_SIGNAL);

  feed({ hasFix: false });
  let fix = gps.getFix();
  assert.strictEqual(fix.status, GPS_STATUS.SEARCHING);
  assert.strictEqual(fix.latitude, null);
  assert.strictEqual(fix.reliable, false);
  assert.strictEqual(gps.getLastKnownPosition(), null);

  feed();
  assert.strictEqual(gps.getFix().status, GPS_STATUS.FIX);

  // Satellites lost (e.g. walked under a flyover): last known position kept, accuracy withheld.
  advance(1000);
  feed({ hasFix: false });
  fix = gps.getFix();
  assert.strictEqual(fix.status, GPS_STATUS.LOST_FIX);
  assert.strictEqual(fix.reliable, false);
  assert.strictEqual(fix.reason, 'lost_fix');
  assert.strictEqual(fix.accuracyM, null);
  assert.strictEqual(fix.ageMs, 1000);
  assert.ok(gps.getLastKnownPosition().latitude);

  // UART goes silent (module unplugged).
  advance(3500);
  fix = gps.getFix();
  assert.strictEqual(fix.status, GPS_STATUS.NO_SIGNAL);
  assert.strictEqual(fix.ageMs, 4500);
});

test('ManagedGps - Fix Becomes Stale When Position Sentences Stop', () => {
  const { gps, feed, advance } = setup({ staleMs: 5000, signalTimeoutMs: 3000 });
  feed();
  for (let i = 0; i < 6; i += 1) {
    advance(1000);
    gps.handleLine('$GPGSV,1,1,01,02,45,120,38*4C'.replace(/\*..$/, '') + '*00'); // invalid, ignored
    gps.handleLine(buildEpoch({ ...DEFAULT_START })[3]); // valid GSV only, keeps signal alive
  }
  const fix = gps.getFix();
  assert.strictEqual(fix.status, GPS_STATUS.LOST_FIX);
  assert.ok(gps.stats.invalid >= 6);
});

test('ManagedGps - Rejects Implausible Jumps, Accepts Them if They Persist', () => {
  const { gps, feed, advance } = setup({ maxSpeedMps: 10, maxConsecutiveOutliers: 3 });
  const outliers = [];
  gps.on('outlier', (o) => outliers.push(o));

  feed();
  const jumped = { latitude: DEFAULT_START.latitude + 0.01 }; // ~1.1 km north

  advance(1000);
  feed(jumped);
  assert.ok(Math.abs(gps.getFix().latitude - DEFAULT_START.latitude) < 1e-6, 'jump should be rejected');
  assert.ok(outliers.length >= 1);
  assert.ok(outliers[0].distanceM > 1000);

  // A real relocation (e.g. cold start drift) is accepted after repeated agreement.
  for (let i = 0; i < 3; i += 1) {
    advance(1000);
    feed(jumped);
  }
  assert.ok(Math.abs(gps.getFix().latitude - jumped.latitude) < 1e-6, 'persistent position should be accepted');
});

test('ManagedGps - Emits Periodic Updates and Status Transitions', async () => {
  const driver = new MockGpsDriver({ scenario: 'signal_loss', fixEpochs: 2, intervalMs: 0 });
  const gps = new ManagedGps(driver, { updateIntervalMs: 0 });
  const statuses = [];
  const updates = [];
  gps.on('status', (s) => statuses.push(s.to));
  gps.on('update', (f) => updates.push(f));

  await gps.start();
  gps.tick();
  driver.emitEpoch();
  gps.tick();
  driver.emitEpoch();
  gps.tick();
  driver.emitEpoch(); // epoch 2: fix lost
  gps.tick();
  await gps.stop();

  assert.deepStrictEqual(statuses, [GPS_STATUS.NO_SIGNAL, GPS_STATUS.FIX, GPS_STATUS.LOST_FIX]);
  assert.strictEqual(updates.length, 4);
  assert.ok(updates[2].longitude > updates[1].longitude, 'mock walk should move east');
});

test('MockGpsDriver - Emits Valid NMEA on a Timer and Stops Cleanly', async () => {
  const driver = new MockGpsDriver({ scenario: 'walk', intervalMs: 10 });
  const lines = [];
  driver.on('line', (l) => lines.push(l));
  await driver.open();
  await new Promise((r) => setTimeout(r, 45));
  await driver.close();
  const count = lines.length;
  assert.ok(count >= 6);
  assert.ok(lines.every(validateChecksum));
  await new Promise((r) => setTimeout(r, 25));
  assert.strictEqual(lines.length, count, 'no lines after close');
});

test('GPS Config and Factory - Defaults, Validation, Off Mode', () => {
  const cfg = loadGpsConfig({ GPS_MODE: '', GPS_DEVICE: '', GPS_BAUD_RATE: '' });
  assert.strictEqual(cfg.GPS_MODE, 'serial');
  assert.strictEqual(cfg.GPS_DEVICE, '/dev/serial0');
  assert.strictEqual(cfg.GPS_BAUD_RATE, 9600);
  assert.strictEqual(cfg.GPS_ENABLE_GST, true);
  assert.strictEqual(cfg.GPS_MAX_ACCURACY_M, 25);

  assert.throws(() => loadGpsConfig({ GPS_MODE: 'bluetooth' }), (e) => e instanceof ConfigValidationError);
  assert.throws(() => loadGpsConfig({ GPS_BAUD_RATE: '12345' }), (e) => e instanceof ConfigValidationError);
  assert.throws(() => loadGpsConfig({ GPS_DEVICE: 'COM3' }), (e) => e instanceof ConfigValidationError);
  assert.throws(() => loadGpsConfig({ GPS_UPDATE_INTERVAL_MS: '10' }), (e) => e instanceof ConfigValidationError);

  assert.strictEqual(createGps({ GPS_MODE: 'off' }), null);
  const mock = createGps(loadGpsConfig({ GPS_MODE: 'mock', GPS_MOCK_SCENARIO: 'no_fix' }));
  assert.strictEqual(mock.driver.name, 'mock');
  assert.strictEqual(mock.driver.scenario, 'no_fix');
  assert.throws(() => createGps({ GPS_MODE: 'nope' }), (e) => e instanceof ConfigValidationError);
});
