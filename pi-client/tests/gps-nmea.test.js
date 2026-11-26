const test = require('node:test');
const assert = require('node:assert');
const {
  parseSentence,
  parseCoordinate,
  validateChecksum,
  withChecksum,
} = require('../src/sensors/gps/nmea.parser');
const { ubxPacket, ENABLE_GST } = require('../src/sensors/gps/ubx');
const { haversineMeters, googleMapsLink } = require('../src/sensors/gps/geo.utils');

test('NMEA - Coordinate Conversion Handles Hemispheres and Bad Input', () => {
  assert.strictEqual(parseCoordinate('3021.3840', 'N'), 30.3564);
  assert.strictEqual(parseCoordinate('07621.8820', 'E'), 76.3647);
  assert.strictEqual(parseCoordinate('3021.3840', 'S'), -30.3564);
  assert.strictEqual(parseCoordinate('07621.8820', 'W'), -76.3647);
  assert.strictEqual(parseCoordinate('', 'N'), null);
  assert.strictEqual(parseCoordinate('3075.0000', 'N'), null); // 75 minutes is invalid
  assert.strictEqual(parseCoordinate('3021.3840', 'X'), null);
});

test('NMEA - Checksum Validation Rejects Corrupted Sentences', () => {
  const good = '$GPGGA,123519,4807.038,N,01131.000,E,1,08,0.9,545.4,M,46.9,M,,*47';
  assert.strictEqual(validateChecksum(good), true);
  assert.strictEqual(validateChecksum(good.replace('4807', '4808')), false);
  assert.strictEqual(validateChecksum('GPGGA,no-dollar*00'), false);
  assert.strictEqual(validateChecksum('$GPGGA,no-star'), false);
  assert.strictEqual(parseSentence(good.replace('4807', '4808')), null);
  assert.strictEqual(parseSentence('\u0000ÿ garbage at wrong baud'), null);
  assert.strictEqual(parseSentence(null), null);
});

test('NMEA - Parses GGA Fix Quality, Satellites, HDOP and Altitude', () => {
  const s = parseSentence('$GPGGA,123519,4807.038,N,01131.000,E,1,08,0.9,545.4,M,46.9,M,,*47');
  assert.strictEqual(s.type, 'GGA');
  assert.strictEqual(s.talker, 'GP');
  assert.strictEqual(s.fixQuality, 1);
  assert.strictEqual(s.satellitesUsed, 8);
  assert.strictEqual(s.hdop, 0.9);
  assert.strictEqual(s.altitudeM, 545.4);
  assert.ok(Math.abs(s.latitude - 48.1173) < 1e-6);
  assert.ok(Math.abs(s.longitude - 11.5166667) < 1e-6);

  const noFix = parseSentence(withChecksum('GPGGA,101010.00,,,,,0,00,99.99,,,,,,'));
  assert.strictEqual(noFix.fixQuality, 0);
  assert.strictEqual(noFix.latitude, null);
});

test('NMEA - Parses RMC Validity, Speed, Course and UTC Date', () => {
  const s = parseSentence('$GPRMC,123519,A,4807.038,N,01131.000,E,022.4,084.4,230394,003.1,W*6A');
  assert.strictEqual(s.type, 'RMC');
  assert.strictEqual(s.valid, true);
  assert.strictEqual(s.courseDeg, 84.4);
  assert.ok(Math.abs(s.speedMps - 22.4 * 0.514444) < 0.001);
  assert.strictEqual(s.utcDateTime, '1994-03-23T12:35:19.000Z');

  const invalid = parseSentence(withChecksum('GPRMC,101010.00,V,,,,,,,261126,,,N'));
  assert.strictEqual(invalid.valid, false);
  assert.strictEqual(invalid.latitude, null);
});

test('NMEA - Parses GSA, GSV and GST (Including GN Talker)', () => {
  const gsa = parseSentence(withChecksum('GNGSA,A,3,02,05,12,,,,,,,,,,2.10,1.20,1.70'));
  assert.strictEqual(gsa.talker, 'GN');
  assert.strictEqual(gsa.fixType, 3);
  assert.deepStrictEqual(gsa.satellitePrns, [2, 5, 12]);
  assert.strictEqual(gsa.hdop, 1.2);

  const gsv = parseSentence(withChecksum('GPGSV,2,1,05,02,45,120,38,05,30,200,,12,60,045,41,13,15,300,29'));
  assert.strictEqual(gsv.totalMessages, 2);
  assert.strictEqual(gsv.satellitesInView, 5);
  assert.strictEqual(gsv.satellites.length, 4);
  assert.deepStrictEqual(gsv.satellites[1], { prn: 5, constellation: 'GP', elevationDeg: 30, azimuthDeg: 200, snrDb: null });

  const gst = parseSentence(withChecksum('GPGST,101010.00,4.1,5.0,3.0,45.0,3.2,2.6,6.5'));
  assert.strictEqual(gst.latErrorM, 3.2);
  assert.strictEqual(gst.lonErrorM, 2.6);

  assert.strictEqual(parseSentence(withChecksum('GPVTG,084.4,T,,M,022.4,N,041.5,K,A')), null);
});

test('UBX - Packet Framing and Fletcher Checksum', () => {
  const pkt = ubxPacket(0x06, 0x01, Buffer.from([0xf0, 0x07, 0x01]));
  assert.deepStrictEqual([...pkt.subarray(0, 6)], [0xb5, 0x62, 0x06, 0x01, 0x03, 0x00]);
  assert.strictEqual(pkt.length, 6 + 3 + 2);
  let a = 0;
  let b = 0;
  for (const byte of [0x06, 0x01, 0x03, 0x00, 0xf0, 0x07, 0x01]) {
    a = (a + byte) & 0xff;
    b = (b + a) & 0xff;
  }
  assert.deepStrictEqual([...pkt.subarray(9)], [a, b]);
  assert.deepStrictEqual(ENABLE_GST, pkt);
});

test('Geo - Haversine Distance and Maps Link', () => {
  const d = haversineMeters({ latitude: 30.3564, longitude: 76.3647 }, { latitude: 30.3574, longitude: 76.3647 });
  assert.ok(Math.abs(d - 111.2) < 0.5, `expected ~111 m, got ${d}`);
  assert.strictEqual(googleMapsLink(30.3564, 76.3647), 'https://maps.google.com/?q=30.356400,76.364700');
});
