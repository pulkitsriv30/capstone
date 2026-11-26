const { EventEmitter } = require('events');
const { parseSentence } = require('./nmea.parser');
const { haversineMeters } = require('./geo.utils');
const { GpsUnavailableError } = require('./gps.errors');
const logger = require('../../utils/logger');

/**
 * Status values reported by ManagedGps.getFix():
 *   no_signal - no NMEA data at all for GPS_SIGNAL_TIMEOUT_MS (module unplugged, wrong UART, dead)
 *   searching - receiving data but never had a fix (cold start, indoors)
 *   lost_fix  - had a fix before, but none now (or it is older than GPS_STALE_MS); last known position is kept
 *   fix       - current position available
 */
const GPS_STATUS = Object.freeze({
  NO_SIGNAL: 'no_signal',
  SEARCHING: 'searching',
  LOST_FIX: 'lost_fix',
  FIX: 'fix',
});

/**
 * Base class for GPS byte/line sources. Drivers emit:
 *   'line'  (string)  one NMEA sentence
 *   'error' (Error)   transport problem
 */
class BaseGpsDriver extends EventEmitter {
  constructor(name) {
    super();
    this.name = name;
    this.opened = false;
  }

  async open() {
    this.opened = true;
  }

  /** Optional: send raw bytes to the receiver (UBX config). Drivers may no-op. */
  async write(_buffer) {}

  async close() {
    this.opened = false;
  }
}

/**
 * Turns a stream of NMEA lines into a reliable position state:
 * accuracy estimate, satellite info, outlier rejection, signal-loss detection,
 * and periodic 'update' events.
 *
 * Events:
 *   'update' (fix)                 every updateIntervalMs while started
 *   'status' ({ from, to, fix })   whenever status changes (fix acquired / lost / no signal)
 *   'outlier' ({ distanceM, impliedSpeedMps })  a position jump was rejected
 */
class ManagedGps extends EventEmitter {
  constructor(driver, options = {}) {
    super();
    this.driver = driver;
    this.updateIntervalMs = options.updateIntervalMs ?? 1000;
    this.staleMs = options.staleMs ?? 5000;
    this.signalTimeoutMs = options.signalTimeoutMs ?? 3000;
    this.maxAccuracyM = options.maxAccuracyM ?? 25;
    // User Equivalent Range Error used to turn HDOP into metres when GST is unavailable.
    this.uereM = options.uereM ?? 5;
    this.maxSpeedMps = options.maxSpeedMps ?? 10;
    this.maxConsecutiveOutliers = options.maxConsecutiveOutliers ?? 3;
    this.now = options.now || Date.now;

    this._timer = null;
    this._lastStatus = null;
    this._onLine = (line) => this.handleLine(line);
    this._onError = (err) => logger.warn('GPS driver error', { driver: this.driver.name, error: err.message });
    this.reset();
  }

  reset() {
    this.lastDataAt = null;
    this.lastSentenceAt = {};
    this.currentFix = false;
    this.position = null; // { latitude, longitude, altitudeM, fixedAt }
    this.fixQuality = 0;
    this.fixType = 1;
    this.satellitesUsed = null;
    this.hdop = null;
    this.pdop = null;
    this.vdop = null;
    this.gst = null; // { latErrorM, lonErrorM, receivedAt }
    this.speedMps = null;
    this.courseDeg = null;
    this.utcDateTime = null;
    this.satellites = [];
    this._gsvBuffer = [];
    this._consecutiveOutliers = 0;
    this.stats = { sentences: 0, invalid: 0, outliersRejected: 0 };
  }

  async start() {
    if (!this.driver.opened) {
      try {
        await this.driver.open();
      } catch (err) {
        throw new GpsUnavailableError(`Failed to open GPS driver "${this.driver.name}": ${err.message}`, err);
      }
    }
    this.driver.on('line', this._onLine);
    this.driver.on('error', this._onError);
    logger.info('GPS started', { driver: this.driver.name, updateIntervalMs: this.updateIntervalMs });

    if (this.updateIntervalMs > 0 && !this._timer) {
      this._timer = setInterval(() => this.tick(), this.updateIntervalMs);
    }
  }

  async stop() {
    if (this._timer) {
      clearInterval(this._timer);
      this._timer = null;
    }
    this.driver.off('line', this._onLine);
    this.driver.off('error', this._onError);
    await this.driver.close();
  }

  /** Emits the periodic update and any status change. Called by the timer, or manually in tests. */
  tick() {
    const fix = this.getFix();
    if (fix.status !== this._lastStatus) {
      const from = this._lastStatus;
      this._lastStatus = fix.status;
      if (from !== null || fix.status !== GPS_STATUS.NO_SIGNAL) {
        logger.info('GPS status changed', { from, to: fix.status });
      }
      this.emit('status', { from, to: fix.status, fix });
    }
    this.emit('update', fix);
    return fix;
  }

  handleLine(line) {
    const sentence = parseSentence(line);
    const now = this.now();
    if (!sentence) {
      this.stats.invalid += 1;
      // Garbage still proves the UART is alive, but not that the receiver is healthy.
      return null;
    }

    this.stats.sentences += 1;
    this.lastDataAt = now;
    this.lastSentenceAt[sentence.type] = now;

    switch (sentence.type) {
      case 'GGA':
        this._handleGGA(sentence, now);
        break;
      case 'RMC':
        this._handleRMC(sentence, now);
        break;
      case 'GSA':
        this.fixType = sentence.fixType;
        this.pdop = sentence.pdop;
        this.vdop = sentence.vdop;
        if (sentence.hdop !== null) this.hdop = sentence.hdop;
        break;
      case 'GSV':
        this._handleGSV(sentence);
        break;
      case 'GST':
        if (sentence.latErrorM !== null && sentence.lonErrorM !== null) {
          this.gst = { latErrorM: sentence.latErrorM, lonErrorM: sentence.lonErrorM, receivedAt: now };
        }
        break;
      default:
        break;
    }
    return sentence;
  }

  _handleGGA(s, now) {
    this.fixQuality = s.fixQuality;
    this.satellitesUsed = s.satellitesUsed;
    if (s.hdop !== null) this.hdop = s.hdop;

    // Quality 6 = dead-reckoning estimate, not a real satellite fix.
    if (s.fixQuality === 0 || s.fixQuality === 6 || s.latitude === null || s.longitude === null) {
      this.currentFix = false;
      return;
    }
    this._acceptPosition(s.latitude, s.longitude, s.altitudeM, now);
  }

  _handleRMC(s, now) {
    if (s.utcDateTime) this.utcDateTime = s.utcDateTime;
    if (!s.valid || s.latitude === null || s.longitude === null) {
      this.currentFix = false;
      this.speedMps = null;
      this.courseDeg = null;
      return;
    }
    this.speedMps = s.speedMps;
    this.courseDeg = s.courseDeg;
    this._acceptPosition(s.latitude, s.longitude, this.position ? this.position.altitudeM : null, now);
  }

  _handleGSV(s) {
    if (s.messageNumber === 1) this._gsvBuffer = [];
    this._gsvBuffer.push(...s.satellites);
    if (s.messageNumber === s.totalMessages) {
      this.satellites = this._gsvBuffer;
      this._gsvBuffer = [];
    }
  }

  /** Rejects physically implausible jumps (multipath near buildings) unless they persist. */
  _acceptPosition(latitude, longitude, altitudeM, now) {
    if (this.position && this.currentFix) {
      const dtS = Math.max((now - this.position.fixedAt) / 1000, 0.2);
      const distanceM = haversineMeters(this.position, { latitude, longitude });
      const impliedSpeedMps = distanceM / dtS;
      if (impliedSpeedMps > this.maxSpeedMps && this._consecutiveOutliers < this.maxConsecutiveOutliers) {
        this._consecutiveOutliers += 1;
        this.stats.outliersRejected += 1;
        this.emit('outlier', { distanceM: Math.round(distanceM), impliedSpeedMps: Number(impliedSpeedMps.toFixed(1)) });
        return;
      }
    }
    this._consecutiveOutliers = 0;
    this.currentFix = true;
    this.position = { latitude, longitude, altitudeM, fixedAt: now };
  }

  /** Best available horizontal accuracy estimate, in metres, with its source. */
  _accuracy() {
    const now = this.now();
    if (this.gst && now - this.gst.receivedAt <= this.staleMs) {
      const accuracyM = Math.sqrt(this.gst.latErrorM ** 2 + this.gst.lonErrorM ** 2);
      return { accuracyM: Number(accuracyM.toFixed(1)), accuracySource: 'gst' };
    }
    if (this.hdop !== null) {
      return { accuracyM: Number((this.hdop * this.uereM).toFixed(1)), accuracySource: 'hdop_estimate' };
    }
    return { accuracyM: null, accuracySource: null };
  }

  _status(now) {
    if (this.lastDataAt === null || now - this.lastDataAt > this.signalTimeoutMs) return GPS_STATUS.NO_SIGNAL;
    if (!this.position) return GPS_STATUS.SEARCHING;
    if (!this.currentFix || now - this.position.fixedAt > this.staleMs) return GPS_STATUS.LOST_FIX;
    return GPS_STATUS.FIX;
  }

  /**
   * Snapshot for consumers (navigation, SOS). `reliable` is true only for a
   * current fix whose accuracy is known and within maxAccuracyM. Consumers must
   * not give turn instructions when reliable is false.
   */
  getFix() {
    const now = this.now();
    const status = this._status(now);
    const { accuracyM, accuracySource } = this._accuracy();
    const hasPosition = Boolean(this.position);

    let reason = null;
    if (status !== GPS_STATUS.FIX) reason = status;
    else if (accuracyM === null) reason = 'accuracy_unknown';
    else if (accuracyM > this.maxAccuracyM) reason = 'low_accuracy';
    else if (this.fixType === 2) reason = '2d_fix';

    return {
      status,
      reliable: reason === null || reason === '2d_fix',
      reason,
      latitude: hasPosition ? this.position.latitude : null,
      longitude: hasPosition ? this.position.longitude : null,
      altitudeM: hasPosition ? this.position.altitudeM : null,
      ageMs: hasPosition ? now - this.position.fixedAt : null,
      accuracyM: status === GPS_STATUS.FIX ? accuracyM : null,
      accuracySource: status === GPS_STATUS.FIX ? accuracySource : null,
      fixQuality: this.fixQuality,
      fixType: this.fixType === 3 ? '3d' : this.fixType === 2 ? '2d' : 'none',
      satellitesUsed: this.satellitesUsed,
      satellitesInView: this.satellites.length,
      satellites: this.satellites,
      hdop: this.hdop,
      pdop: this.pdop,
      vdop: this.vdop,
      speedMps: status === GPS_STATUS.FIX ? this.speedMps : null,
      courseDeg: status === GPS_STATUS.FIX ? this.courseDeg : null,
      utcDateTime: this.utcDateTime,
      driver: this.driver.name,
      timestamp: new Date(now).toISOString(),
    };
  }

  /** Last known position regardless of age (for SOS). Null if the receiver never had a fix. */
  getLastKnownPosition() {
    if (!this.position) return null;
    return { ...this.position, ageMs: this.now() - this.position.fixedAt };
  }
}

module.exports = {
  BaseGpsDriver,
  ManagedGps,
  GPS_STATUS,
};
