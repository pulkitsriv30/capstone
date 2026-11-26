/**
 * Tiny UBX (u-blox binary protocol) helpers. Used only to ask the NEO-6M to
 * output the NMEA GST sentence, which carries a real position-error estimate
 * in metres. Clone modules that ignore UBX still work: accuracy then falls
 * back to an HDOP-based estimate (clearly labelled as such).
 */

const ubxPacket = (msgClass, msgId, payload = Buffer.alloc(0)) => {
  const header = Buffer.from([0xb5, 0x62, msgClass, msgId, payload.length & 0xff, payload.length >> 8]);
  let ckA = 0;
  let ckB = 0;
  for (const byte of Buffer.concat([header.subarray(2), payload])) {
    ckA = (ckA + byte) & 0xff;
    ckB = (ckB + ckA) & 0xff;
  }
  return Buffer.concat([header, payload, Buffer.from([ckA, ckB])]);
};

/** UBX-CFG-MSG (short form): set the output rate of an NMEA message on the current port. */
const cfgMsgRate = (nmeaClass, nmeaId, rate) => ubxPacket(0x06, 0x01, Buffer.from([nmeaClass, nmeaId, rate]));

// NMEA standard messages are UBX class 0xF0; GST is id 0x07.
const ENABLE_GST = cfgMsgRate(0xf0, 0x07, 1);

module.exports = {
  ubxPacket,
  cfgMsgRate,
  ENABLE_GST,
};
