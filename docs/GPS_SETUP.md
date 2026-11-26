# NEO-6M GPS Module: Wiring, Setup and Usage

Code: `pi-client/src/sensors/gps/` · Tests: `pi-client/tests/gps-*.test.js`

The GPS module is self-contained. It does not change `src/config/env.js`, `src/utils/errors.js`,
`src/index.js` or `package.json`, and it adds no npm dependency (the UART is configured with `stty`
and read as a file).

> GPS gives position only. It does not detect obstacles, kerbs, steps or traffic, and must never be
> presented as obstacle-aware navigation.

## 1. Wiring (Raspberry Pi 4)

| NEO-6M board pin | Raspberry Pi 4 pin | Notes |
|---|---|---|
| VCC | Pin 2 (5 V) **or** Pin 1 (3.3 V) | Common GY-GPS6MV2 boards have an onboard 3.3 V regulator and accept 5 V. A bare module without a regulator must use 3.3 V only. Check your board |
| GND | Pin 6 (GND) | |
| TX | Pin 10 (GPIO15 / RXD) | Module transmits, Pi receives. 3.3 V logic, safe for the Pi |
| RX | Pin 8 (GPIO14 / TXD) | Needed only to send the UBX command that enables accuracy (GST) output |

Antenna: the ceramic patch must face the sky (shoulder strap or cap, not inside a bag or under the Pi).
On most boards an LED blinks once per second when the module has a fix.

## 2. Raspberry Pi OS setup (Bookworm)

```bash
# 1. Free the UART from the serial console
sudo raspi-config
#    Interface Options -> Serial Port
#    "login shell over serial?"  -> No
#    "serial port hardware enabled?" -> Yes

# 2. Give the full PL011 UART to GPIO14/15 (moves Bluetooth off it)
echo -e "enable_uart=1\ndtoverlay=disable-bt" | sudo tee -a /boot/firmware/config.txt
sudo systemctl disable hciuart
sudo reboot

# 3. Check the device and permissions
ls -l /dev/serial0            # should point to ttyAMA0
sudo usermod -aG dialout $USER   # then log out and back in

# 4. Raw check: you should see $GPRMC / $GPGGA lines once per second
stty -F /dev/serial0 9600 raw -echo
cat /dev/serial0
```

If `cat` shows garbage, the baud rate is wrong (try 4800 or 38400). If it shows nothing, swap TX and RX.

First fix (cold start) can take 30 seconds to several minutes outdoors with a clear sky. Indoors the
module usually reports `searching`.

## 3. Try it

```bash
cd pi-client
node src/sensors/gps/gps.cli.js               # real module on /dev/serial0
node src/sensors/gps/gps.cli.js --json > walk.jsonl   # log a test walk, one fix per line
node src/sensors/gps/gps.cli.js --mock        # no hardware: simulated walk near Thapar
node src/sensors/gps/gps.cli.js --mock=no_fix # also: static, signal_loss, silent
node --test tests/gps-*.test.js
```

Example output:

```
[FIX] 30.356400, 76.364712 ±4.1 m (gst) | 3d | sats used=8 in view=8 hdop=1.1 | RELIABLE
    https://maps.google.com/?q=30.356400,76.364712
```

## 4. Configuration (add to `pi-client/.env` as needed)

| Variable | Default | Meaning |
|---|---|---|
| `GPS_MODE` | `serial` | `serial`, `mock` or `off` |
| `GPS_DEVICE` | `/dev/serial0` | UART device (use `/dev/ttyUSB0` for a USB-TTL adapter) |
| `GPS_BAUD_RATE` | `9600` | NEO-6M factory default |
| `GPS_ENABLE_GST` | `true` | Send UBX-CFG-MSG at startup so the module outputs GST (accuracy in metres) |
| `GPS_UPDATE_INTERVAL_MS` | `1000` | How often `update` events fire |
| `GPS_STALE_MS` | `5000` | A position older than this counts as lost |
| `GPS_SIGNAL_TIMEOUT_MS` | `3000` | No NMEA for this long means `no_signal` (module unplugged or dead) |
| `GPS_MAX_ACCURACY_M` | `25` | Fixes worse than this are marked `reliable: false` |
| `GPS_MOCK_SCENARIO` | `walk` | Mock only: `walk`, `static`, `no_fix`, `signal_loss`, `silent` |

## 5. Using it from other modules

```js
const { createGps, loadGpsConfig, GPS_STATUS, googleMapsLink } = require('./sensors/gps');

const gps = createGps(loadGpsConfig());
gps.on('status', ({ from, to }) => {
  // e.g. tell the user via Nipun's audio: "GPS signal lost", "GPS ready"
});
gps.on('update', (fix) => {
  if (!fix.reliable) return; // never give turn instructions on an unreliable fix
  // fix.latitude, fix.longitude, fix.accuracyM, fix.speedMps, fix.courseDeg ...
});
await gps.start();

// For SOS: last known position even if the fix is lost
const last = gps.getLastKnownPosition(); // { latitude, longitude, ageMs } or null
```

### The fix object

| Field | Meaning |
|---|---|
| `status` | `fix`, `lost_fix` (had one, lost it; last position kept), `searching` (never had one), `no_signal` (no data from module) |
| `reliable` | `true` only for a current fix with known accuracy within `GPS_MAX_ACCURACY_M` |
| `reason` | Why it is unreliable: `low_accuracy`, `accuracy_unknown`, `lost_fix`, `searching`, `no_signal` (`2d_fix` is informational) |
| `latitude`, `longitude`, `altitudeM` | Last accepted position (also kept when the fix is lost) |
| `ageMs` | Age of that position |
| `accuracyM`, `accuracySource` | Horizontal error estimate in metres. `gst` = from the receiver's own error statistics. `hdop_estimate` = HDOP × 5 m, used when the module ignores the GST request (some clones). Null when there is no current fix |
| `fixType` | `3d`, `2d` or `none` |
| `satellitesUsed`, `satellitesInView`, `satellites[]` | Satellite info, each with PRN, elevation, azimuth and SNR (dB) |
| `hdop`, `pdop`, `vdop` | Dilution of precision |
| `speedMps`, `courseDeg` | From RMC. Course is meaningless below about 1 m/s |

### How bad data is handled

- **Corrupted sentences** (bad checksum, wrong baud) are dropped and counted in `gps.stats.invalid`.
- **Position jumps** faster than 10 m/s (multipath near buildings) are rejected and emit `outlier`.
  If the new position repeats 3 times in a row it is accepted, so a real relocation is not blocked forever.
- **Fix lost**: status becomes `lost_fix`, `reliable` false, accuracy withheld, last position kept with its age.
- **Module silent**: status becomes `no_signal`. The serial driver also reopens the port automatically
  if the device disappears.

## 6. Known limits and next steps

- The NEO-6M uses GPS satellites only, so near tall buildings expect fewer satellites, slower fixes and
  worse accuracy than multi-GNSS modules. Measure it on a fixed campus loop before relying on it.
- Only one process can read the UART. When the SOS service is built, either it owns the GPS and shares
  fixes over a local socket, or both read from `gpsd`. Decide this before writing the SOS daemon.
- Not yet wired into `src/index.js`; that is left for integration with the voice/audio module.
