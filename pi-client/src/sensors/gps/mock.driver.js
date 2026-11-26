const { BaseGpsDriver } = require('./gps.interface');
const { withChecksum } = require('./nmea.parser');

// Default start point: Thapar Institute, Patiala (approximate).
const DEFAULT_START = { latitude: 30.3564, longitude: 76.3647 };

const pad = (n, width) => String(n).padStart(width, '0');

const toNmeaCoord = (value, isLat) => {
  const abs = Math.abs(value);
  const deg = Math.floor(abs);
  const min = (abs - deg) * 60;
  const degStr = pad(deg, isLat ? 2 : 3);
  const minStr = min.toFixed(5).padStart(8, '0');
  const hemi = isLat ? (value >= 0 ? 'N' : 'S') : value >= 0 ? 'E' : 'W';
  return [`${degStr}${minStr}`, hemi];
};

const nmeaTime = (date) =>
  `${pad(date.getUTCHours(), 2)}${pad(date.getUTCMinutes(), 2)}${pad(date.getUTCSeconds(), 2)}.00`;
const nmeaDate = (date) =>
  `${pad(date.getUTCDate(), 2)}${pad(date.getUTCMonth() + 1, 2)}${pad(date.getUTCFullYear() % 100, 2)}`;

/**
 * Builds one second's worth of NEO-6M-style NMEA sentences.
 * Exported so tests can feed exact sentences into ManagedGps.
 */
const buildEpoch = ({
  date = new Date(),
  latitude,
  longitude,
  hasFix = true,
  satellitesUsed = 8,
  hdop = 1.1,
  speedMps = 1.2,
  courseDeg = 90,
  latErrorM = 3.2,
  lonErrorM = 2.6,
  includeGst = true,
}) => {
  const t = nmeaTime(date);
  const [lat, ns] = toNmeaCoord(latitude, true);
  const [lon, ew] = toNmeaCoord(longitude, false);
  const knots = (speedMps / 0.514444).toFixed(3);

  if (!hasFix) {
    return [
      withChecksum(`GPRMC,${t},V,,,,,,,${nmeaDate(date)},,,N`),
      withChecksum(`GPGGA,${t},,,,,0,00,99.99,,,,,,`),
      withChecksum('GPGSA,A,1,,,,,,,,,,,,,99.99,99.99,99.99'),
      withChecksum('GPGSV,1,1,02,12,,,18,25,,,15'),
    ];
  }

  const lines = [
    withChecksum(`GPRMC,${t},A,${lat},${ns},${lon},${ew},${knots},${courseDeg.toFixed(2)},${nmeaDate(date)},,,A`),
    withChecksum(`GPGGA,${t},${lat},${ns},${lon},${ew},1,${pad(satellitesUsed, 2)},${hdop.toFixed(2)},250.4,M,-41.2,M,,`),
    withChecksum(`GPGSA,A,3,02,05,12,13,15,18,24,25,,,,,${(hdop * 1.6).toFixed(2)},${hdop.toFixed(2)},${(hdop * 1.3).toFixed(2)}`),
    withChecksum('GPGSV,2,1,08,02,45,120,38,05,30,200,34,12,60,045,41,13,15,300,29'),
    withChecksum('GPGSV,2,2,08,15,20,250,31,18,70,010,43,24,35,160,36,25,10,080,27'),
  ];
  if (includeGst) {
    lines.push(withChecksum(`GPGST,${t},4.1,5.0,3.0,45.0,${latErrorM.toFixed(1)},${lonErrorM.toFixed(1)},6.5`));
  }
  return lines;
};

/**
 * Simulated NEO-6M. Scenarios:
 *   walk        - fix, walking east at ~1.2 m/s (default)
 *   static      - fix, not moving
 *   no_fix      - receiver talking but no satellites locked (indoors)
 *   signal_loss - walk for `fixEpochs` seconds, then no fix
 *   silent      - opens but never sends data (unplugged / wrong UART)
 */
class MockGpsDriver extends BaseGpsDriver {
  constructor(options = {}) {
    super('mock');
    this.scenario = options.scenario || 'walk';
    this.intervalMs = options.intervalMs ?? 1000;
    this.start = options.start || DEFAULT_START;
    this.fixEpochs = options.fixEpochs ?? 10;
    this.includeGst = options.includeGst ?? true;
    this.epoch = 0;
    this._timer = null;
  }

  async open() {
    this.opened = true;
    if (this.scenario === 'silent' || this.intervalMs <= 0) return;
    this._timer = setInterval(() => this.emitEpoch(), this.intervalMs);
  }

  emitEpoch() {
    const speedMps = this.scenario === 'static' ? 0 : 1.2;
    const metresEast = speedMps * this.epoch;
    const longitude =
      this.start.longitude + metresEast / (111320 * Math.cos((this.start.latitude * Math.PI) / 180));
    const hasFix =
      this.scenario !== 'no_fix' && !(this.scenario === 'signal_loss' && this.epoch >= this.fixEpochs);

    const lines = buildEpoch({
      latitude: this.start.latitude,
      longitude,
      hasFix,
      speedMps,
      includeGst: this.includeGst,
    });
    this.epoch += 1;
    for (const line of lines) this.emit('line', line);
  }

  async close() {
    if (this._timer) {
      clearInterval(this._timer);
      this._timer = null;
    }
    this.opened = false;
  }
}

module.exports = MockGpsDriver;
module.exports.buildEpoch = buildEpoch;
module.exports.DEFAULT_START = DEFAULT_START;
