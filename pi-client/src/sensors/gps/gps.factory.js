const { ManagedGps } = require('./gps.interface');
const SerialGpsDriver = require('./serial.driver');
const MockGpsDriver = require('./mock.driver');
const { ConfigValidationError } = require('../../utils/errors');

/** Returns a ManagedGps for GPS_MODE "serial" or "mock", or null for "off". */
const createGps = (config, overrides = {}) => {
  const mode = (config.GPS_MODE || 'serial').toLowerCase();
  let driver;

  switch (mode) {
    case 'serial':
      driver = new SerialGpsDriver({
        device: config.GPS_DEVICE,
        baudRate: config.GPS_BAUD_RATE,
        enableGst: config.GPS_ENABLE_GST,
        ...overrides,
      });
      break;
    case 'mock':
      driver = new MockGpsDriver({ scenario: config.GPS_MOCK_SCENARIO, ...overrides });
      break;
    case 'off':
      return null;
    default:
      throw new ConfigValidationError(`Unsupported GPS_MODE: "${mode}"`);
  }

  return new ManagedGps(driver, {
    updateIntervalMs: config.GPS_UPDATE_INTERVAL_MS,
    staleMs: config.GPS_STALE_MS,
    signalTimeoutMs: config.GPS_SIGNAL_TIMEOUT_MS,
    maxAccuracyM: config.GPS_MAX_ACCURACY_M,
  });
};

module.exports = {
  createGps,
};
