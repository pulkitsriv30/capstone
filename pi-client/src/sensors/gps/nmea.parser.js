/**
 * Minimal, dependency-free NMEA 0183 parser for u-blox NEO-6M (and compatible) receivers.
 *
 * Supported sentences (any talker ID: GP, GN, GL, GA, GB):
 *   GGA - fix quality, position, satellites used, HDOP, altitude
 *   RMC - validity, position, speed, course, UTC date/time
 *   GSA - 2D/3D fix type, PDOP/HDOP/VDOP
 *   GSV - satellites in view with elevation/azimuth/SNR
 *   GST - pseudorange error statistics (lat/lon standard deviation in metres)
 *
 * All parse functions are pure and return null for malformed or unsupported input.
 */

const KNOTS_TO_MPS = 0.514444;

const computeChecksum = (body) => {
  let cs = 0;
  for (let i = 0; i < body.length; i += 1) {
    cs ^= body.charCodeAt(i);
  }
  return cs;
};

const validateChecksum = (line) => {
  const star = line.lastIndexOf('*');
  if (!line.startsWith('$') || star === -1 || star + 3 > line.length) return false;
  const body = line.slice(1, star);
  const expected = parseInt(line.slice(star + 1, star + 3), 16);
  if (Number.isNaN(expected)) return false;
  return computeChecksum(body) === expected;
};

/** Appends "*HH" checksum to a sentence body (without leading "$"). Used by mocks and tests. */
const withChecksum = (body) => {
  const cs = computeChecksum(body).toString(16).toUpperCase().padStart(2, '0');
  return `$${body}*${cs}`;
};

const toNumber = (value) => {
  if (value === undefined || value === null || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};

const toInt = (value) => {
  const n = toNumber(value);
  return n === null ? null : Math.trunc(n);
};

/** Converts NMEA ddmm.mmmm / dddmm.mmmm plus hemisphere to signed decimal degrees. */
const parseCoordinate = (raw, hemisphere) => {
  if (!raw || !hemisphere) return null;
  const dot = raw.indexOf('.');
  const degLen = (dot === -1 ? raw.length : dot) - 2;
  if (degLen < 1) return null;
  const degrees = Number(raw.slice(0, degLen));
  const minutes = Number(raw.slice(degLen));
  if (!Number.isFinite(degrees) || !Number.isFinite(minutes) || minutes >= 60) return null;
  let value = degrees + minutes / 60;
  if (hemisphere === 'S' || hemisphere === 'W') value = -value;
  else if (hemisphere !== 'N' && hemisphere !== 'E') return null;
  return Number(value.toFixed(7));
};

const parseUtcTime = (raw) => {
  if (!raw || raw.length < 6) return null;
  return `${raw.slice(0, 2)}:${raw.slice(2, 4)}:${raw.slice(4)}`;
};

const parseUtcDateTime = (time, date) => {
  if (!time || time.length < 6 || !date || date.length !== 6) return null;
  const dd = date.slice(0, 2);
  const mm = date.slice(2, 4);
  const yy = Number(date.slice(4, 6));
  const year = yy >= 80 ? 1900 + yy : 2000 + yy;
  const iso = `${year}-${mm}-${dd}T${time.slice(0, 2)}:${time.slice(2, 4)}:${time.slice(4)}Z`;
  const parsed = new Date(iso);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
};

const parseGGA = (f) => ({
  type: 'GGA',
  utcTime: parseUtcTime(f[1]),
  latitude: parseCoordinate(f[2], f[3]),
  longitude: parseCoordinate(f[4], f[5]),
  // 0 = invalid, 1 = GPS fix, 2 = DGPS, 6 = dead reckoning (estimated)
  fixQuality: toInt(f[6]) ?? 0,
  satellitesUsed: toInt(f[7]),
  hdop: toNumber(f[8]),
  altitudeM: toNumber(f[9]),
});

const parseRMC = (f) => {
  const speedKnots = toNumber(f[7]);
  return {
    type: 'RMC',
    valid: f[2] === 'A',
    utcTime: parseUtcTime(f[1]),
    utcDateTime: parseUtcDateTime(f[1], f[9]),
    latitude: parseCoordinate(f[3], f[4]),
    longitude: parseCoordinate(f[5], f[6]),
    speedMps: speedKnots === null ? null : Number((speedKnots * KNOTS_TO_MPS).toFixed(3)),
    courseDeg: toNumber(f[8]),
  };
};

const parseGSA = (f) => ({
  type: 'GSA',
  // 1 = no fix, 2 = 2D, 3 = 3D
  fixType: toInt(f[2]) ?? 1,
  satellitePrns: f.slice(3, 15).filter((s) => s !== '').map(Number),
  pdop: toNumber(f[15]),
  hdop: toNumber(f[16]),
  vdop: toNumber(f[17]),
});

const parseGSV = (f, talker) => {
  const satellites = [];
  for (let i = 4; i < f.length; i += 4) {
    const prn = toInt(f[i]);
    if (prn === null) continue;
    satellites.push({
      prn,
      constellation: talker,
      elevationDeg: toInt(f[i + 1]),
      azimuthDeg: toInt(f[i + 2]),
      snrDb: toInt(f[i + 3]),
    });
  }
  return {
    type: 'GSV',
    totalMessages: toInt(f[1]),
    messageNumber: toInt(f[2]),
    satellitesInView: toInt(f[3]),
    satellites,
  };
};

const parseGST = (f) => ({
  type: 'GST',
  utcTime: parseUtcTime(f[1]),
  rmsM: toNumber(f[2]),
  latErrorM: toNumber(f[6]),
  lonErrorM: toNumber(f[7]),
  altErrorM: toNumber(f[8]),
});

const PARSERS = { GGA: parseGGA, RMC: parseRMC, GSA: parseGSA, GSV: parseGSV, GST: parseGST };

/**
 * Parses one NMEA line. Returns a typed object, or null when the line is
 * malformed, fails its checksum, or is a sentence type we do not use.
 */
const parseSentence = (rawLine) => {
  if (typeof rawLine !== 'string') return null;
  const line = rawLine.trim();
  if (!validateChecksum(line)) return null;

  const body = line.slice(1, line.lastIndexOf('*'));
  const fields = body.split(',');
  const address = fields[0];
  if (address.length !== 5) return null;

  const talker = address.slice(0, 2);
  const parser = PARSERS[address.slice(2)];
  if (!parser) return null;

  try {
    return { talker, ...parser(fields, talker) };
  } catch (_) {
    return null;
  }
};

module.exports = {
  parseSentence,
  parseCoordinate,
  validateChecksum,
  computeChecksum,
  withChecksum,
  KNOTS_TO_MPS,
};
