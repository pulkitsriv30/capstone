/**
 * Standalone GPS test tool for the Raspberry Pi.
 *
 *   node src/sensors/gps/gps.cli.js              # real NEO-6M on GPS_DEVICE (default /dev/serial0)
 *   node src/sensors/gps/gps.cli.js --mock       # simulated walk
 *   node src/sensors/gps/gps.cli.js --mock=no_fix
 *   node src/sensors/gps/gps.cli.js --json       # one JSON fix per line (for logging walks)
 */
const { loadGpsConfig } = require('./gps.config');
const { createGps } = require('./gps.factory');
const { googleMapsLink } = require('./geo.utils');

const describe = (fix) => {
  const head = `[${fix.status.toUpperCase()}]`;
  const sats = `sats used=${fix.satellitesUsed ?? '-'} in view=${fix.satellitesInView} hdop=${fix.hdop ?? '-'}`;
  if (fix.latitude === null) return `${head} no position yet | ${sats}`;
  const acc = fix.accuracyM === null ? 'accuracy unknown' : `±${fix.accuracyM} m (${fix.accuracySource})`;
  const age = fix.status === 'fix' ? '' : ` | last known ${Math.round(fix.ageMs / 1000)} s ago`;
  const flag = fix.reliable ? 'RELIABLE' : `UNRELIABLE: ${fix.reason}`;
  return `${head} ${fix.latitude.toFixed(6)}, ${fix.longitude.toFixed(6)} ${acc} | ${fix.fixType} | ${sats}${age} | ${flag}\n    ${googleMapsLink(fix.latitude, fix.longitude)}`;
};

async function main() {
  const mockArg = process.argv.find((a) => a.startsWith('--mock'));
  const json = process.argv.includes('--json');
  const overrides = {};
  if (mockArg) {
    overrides.GPS_MODE = 'mock';
    const scenario = mockArg.split('=')[1];
    if (scenario) overrides.GPS_MOCK_SCENARIO = scenario;
  }

  const config = loadGpsConfig(overrides);
  const gps = createGps(config);
  if (!gps) {
    console.log('GPS_MODE=off, nothing to do.');
    return;
  }

  gps.on('status', ({ from, to }) => {
    if (!json) console.log(`\n*** GPS status: ${from ?? 'start'} -> ${to} ***\n`);
  });
  gps.on('outlier', (o) => {
    if (!json) console.log(`!!! Rejected position jump of ${o.distanceM} m (${o.impliedSpeedMps} m/s)`);
  });
  gps.on('update', (fix) => {
    if (json) {
      const { satellites, ...compact } = fix;
      console.log(JSON.stringify(compact));
    } else {
      console.log(describe(fix));
    }
  });

  await gps.start();
  if (!json) console.log(`GPS running (mode=${config.GPS_MODE}, device=${config.GPS_DEVICE}). Ctrl+C to stop.`);

  const shutdown = async () => {
    await gps.stop();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

if (require.main === module) {
  main().catch((err) => {
    console.error(`GPS failed: [${err.code || 'ERROR'}] ${err.message}`);
    process.exit(1);
  });
}

module.exports = { describe };
