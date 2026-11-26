const fs = require('fs');
const { execFile } = require('child_process');
const { promisify } = require('util');
const { BaseGpsDriver } = require('./gps.interface');
const { ENABLE_GST } = require('./ubx');
const { GpsUnavailableError } = require('./gps.errors');
const logger = require('../../utils/logger');

const execFileAsync = promisify(execFile);

/**
 * Reads NMEA from a UART such as /dev/serial0 (NEO-6M on GPIO14/15).
 * No native npm dependency: the port is configured with `stty` and read as a file.
 * Reconnects automatically if the device disappears (USB-TTL unplugged, etc.).
 */
class SerialGpsDriver extends BaseGpsDriver {
  constructor(options = {}) {
    super('serial');
    this.device = options.device || '/dev/serial0';
    this.baudRate = options.baudRate || 9600;
    this.enableGst = options.enableGst ?? true;
    this.reconnectDelayMs = options.reconnectDelayMs ?? 2000;
    this.execFile = options.execFile || execFileAsync;
    this.fsImpl = options.fsImpl || fs;
    this._handle = null;
    this._stream = null;
    this._buffer = '';
    this._closing = false;
    this._reconnectTimer = null;
  }

  async open() {
    this._closing = false;
    await this._configurePort();
    await this._openStream();
    this.opened = true;

    if (this.enableGst) {
      try {
        await this.write(ENABLE_GST);
        logger.info('Requested NMEA GST output from receiver (UBX-CFG-MSG)', { device: this.device });
      } catch (err) {
        logger.warn('Could not send UBX config; accuracy will use HDOP estimate', { error: err.message });
      }
    }
  }

  async _configurePort() {
    try {
      await this.execFile(
        'stty',
        ['-F', this.device, String(this.baudRate), 'raw', '-echo', '-echoe', '-echok', 'cs8', '-cstopb', '-parenb', '-crtscts'],
        { timeout: 3000 }
      );
    } catch (err) {
      const hint =
        err.code === 'ENOENT'
          ? '"stty" not found.'
          : `Check that ${this.device} exists, the serial console is disabled, and your user is in the "dialout" group.`;
      throw new GpsUnavailableError(`Unable to configure GPS serial port ${this.device}. ${hint}`, err);
    }
  }

  async _openStream() {
    try {
      this._handle = await this.fsImpl.promises.open(this.device, 'r+');
    } catch (err) {
      throw new GpsUnavailableError(`Unable to open GPS serial port ${this.device}: ${err.message}`, err);
    }

    this._stream = this._handle.createReadStream({ encoding: 'ascii', highWaterMark: 256 });
    this._stream.on('data', (chunk) => this._onData(chunk));
    this._stream.on('error', (err) => {
      this.emit('error', err);
      this._scheduleReconnect();
    });
    this._stream.on('close', () => {
      this._handle = null;
      this._stream = null;
      if (!this._closing) this._scheduleReconnect();
    });
    logger.info('GPS serial port opened', { device: this.device, baudRate: this.baudRate });
  }

  _onData(chunk) {
    this._buffer += chunk;
    // Guard against a stuck stream of binary garbage (wrong baud rate).
    if (this._buffer.length > 4096) this._buffer = this._buffer.slice(-1024);
    let idx;
    while ((idx = this._buffer.indexOf('\n')) !== -1) {
      const line = this._buffer.slice(0, idx).replace(/\r$/, '');
      this._buffer = this._buffer.slice(idx + 1);
      if (line.startsWith('$')) this.emit('line', line);
    }
  }

  _scheduleReconnect() {
    if (this._closing || this._reconnectTimer) return;
    logger.warn('GPS serial stream closed, reconnecting', { device: this.device, delayMs: this.reconnectDelayMs });
    this._reconnectTimer = setTimeout(async () => {
      this._reconnectTimer = null;
      try {
        await this._configurePort();
        await this._openStream();
      } catch (err) {
        this.emit('error', err);
        this._scheduleReconnect();
      }
    }, this.reconnectDelayMs);
  }

  async write(buffer) {
    if (!this._handle) throw new GpsUnavailableError('GPS serial port is not open');
    await this._handle.write(buffer);
  }

  async close() {
    this._closing = true;
    if (this._reconnectTimer) {
      clearTimeout(this._reconnectTimer);
      this._reconnectTimer = null;
    }
    if (this._stream) {
      this._stream.destroy();
      this._stream = null;
    }
    if (this._handle) {
      await this._handle.close().catch(() => {});
      this._handle = null;
    }
    this.opened = false;
  }
}

module.exports = SerialGpsDriver;
