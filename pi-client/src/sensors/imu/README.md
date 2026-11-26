# MPU-6500 IMU Module

**Module:** `pi-client/src/sensors/imu/`
**Hardware:** MPU-6500 6-axis accelerometer + gyroscope breakout, I2C, Raspberry Pi 4

This module reads motion data from an MPU-6500 on the wearable and turns it into simple, useful signals for the navigation aid: tilt, turning, whether the user is walking, and a step count. It also includes a mock driver so everything can be developed and tested on a laptop without the sensor.

---

## 1. What It Does (and Does Not Do)

### Does
- Reads the 3-axis accelerometer (in g) and 3-axis gyroscope (in deg/s) over I2C, plus the die temperature.
- **Calibrates** gyro and accelerometer bias while the device sits still and flat.
- Computes **roll and pitch** (degrees) with a complementary filter. These are absolute relative to gravity and do not drift.
- Computes a **relative heading** (degrees, 0-360) by integrating the z-axis gyro since the last `resetHeading()`.
- Reports **turn rate** (deg/s, z-axis gyro, bias-corrected).
- Classifies motion as **`stationary`** or **`moving`** from the variance of acceleration magnitude.
- Counts **steps** (a peak in acceleration magnitude above 1.15 g, at least 300 ms after the previous step).

### Does NOT
- **It is not a compass.** It cannot tell you where north is (see below).
- **It does not detect obstacles.** Obstacle and scene information comes from the camera and backend pipeline. Never present IMU output to the user as obstacle information.
- It does not give position or distance. Step count times an assumed stride length is a rough estimate at best.
- It does not read the magnetometer on MPU-9250 boards, and it does not use the INT pin.

### Heading limits (read this before using `relativeHeading`)

The MPU-6500 has **no magnetometer**. That has direct consequences:

- `relativeHeading` is **relative to the direction the user was facing at the last `resetHeading()`** (or at start-up). 0 means "the way you were facing then", not north.
- It is computed by integrating the gyro, so small errors accumulate and **it drifts**. After a good calibration, expect drift on the order of **a few degrees per minute**. It gets noticeably worse when the sensor's temperature changes (for example in the first minutes after power-on, or moving between indoors and outdoors) or when calibration was poor.
- Use it for **short-term turn information**: "you have turned about 90 degrees right since the last intersection", or "you are veering left". Reset it at meaningful moments (start of a route segment, after a confirmed turn). Do not use it to hold a direction over long walks.
- Never label it "compass", "bearing" or "absolute heading" in code, logs, UI or voice prompts.

Ways to get a **north-referenced** heading:
1. **GPS course-over-ground** from the NEO-6M while the user is walking. It is only valid when moving at walking speed or faster and is noisy at low speed, but it does not drift. It can be used to re-anchor the gyro heading (see Future work).
2. **An external magnetometer** on the same I2C bus, for example a QMC5883L or HMC5883L module. Needs hard/soft-iron calibration and is disturbed by nearby metal and electronics.
3. **An MPU-9250 board** (MPU-6500 + AK8963 magnetometer). The driver accepts it (WHO_AM_I `0x71`/`0x73`) and uses its accel/gyro, but it **does not read the AK8963 magnetometer**. That would need additional driver work.

---

## 2. Wiring (Raspberry Pi 4, 40-pin header)

**Power off the Pi before wiring.**

| MPU-6500 pin | Pi 4 physical pin | Pi signal | Notes |
|---|---|---|---|
| VCC | **Pin 1** | 3.3V | **Use 3.3V, not 5V.** Only use 5V (pin 2/4) if your breakout has an on-board regulator, and check the board's documentation first. 5V on a bare MPU-6500 can damage it and the Pi's GPIO. |
| GND | **Pin 6** | GND | Any GND pin works. |
| SDA | **Pin 3** | GPIO2 (SDA1) | |
| SCL | **Pin 5** | GPIO3 (SCL1) | |
| AD0 / SDO | Pin 6 (GND) or Pin 1 (3.3V) | | To GND -> address **0x68** (default). To 3.3V -> address **0x69**. Many breakouts pull this low already. |
| NCS | Pin 1 (3.3V) | | On boards that expose NCS, tie it high to keep the chip in I2C mode. |
| INT | not connected | | Optional; the driver polls and does not use it. |

Notes:
- **Sharing the I2C bus is fine.** Other I2C devices (for example a future magnetometer) can sit on the same SDA/SCL lines as long as addresses differ.
- **The NEO-6M GPS uses the UART, not I2C**, so there is no conflict with the IMU.
- Keep the wires **short** (ideally under 20-30 cm). Long jumper wires cause I2C errors.
- **Mount the IMU rigidly** to the wearable. A loose or wobbling sensor adds noise to everything, especially step detection and heading.
- **Record its orientation.** The code assumes the board is mounted with its **z-axis pointing up** (perpendicular to the ground when the user stands upright). Calibration expects about (0, 0, 1) g at rest. If it is mounted another way, note it so axis remapping can be added.

---

## 3. Raspberry Pi Setup

### Enable I2C
```bash
sudo raspi-config
# Interface Options -> I2C -> Yes
```
Or add this to `/boot/firmware/config.txt` and reboot:
```
dtparam=i2c_arm=on
# Optional: 400 kHz fast mode (the MPU-6500 supports it)
dtparam=i2c_arm_baudrate=400000
```

### Check the sensor is visible
```bash
sudo apt install -y i2c-tools
i2cdetect -y 1
```
**Expected:** `68` appears in the grid (or `69` if AD0 is tied to 3.3V).

### Allow your user to access I2C without sudo
```bash
sudo usermod -aG i2c $USER
# Log out and back in (or reboot) for the group change to apply
```

### Install the Node I2C library
```bash
cd pi-client
sudo apt install -y build-essential python3   # needed to compile the native module
npm install i2c-bus
```

`i2c-bus` is a **native module** and is **not yet in `package.json`**. The team should add `"i2c-bus": "^5.2.3"` to `pi-client/package.json` dependencies when this module is merged. The driver loads it lazily, only when `IMU_MODE=mpu6500` is initialised, so mock mode and the tests work on laptops without it.

---

## 4. Configuration

These variables are read by **`src/sensors/imu/imu.config.js`** (`loadImuConfig()`), **not** by the main `src/config/env.js`. Invalid values throw an `ImuConfigError`.

| Variable | Default | Allowed values | Purpose |
|---|---|---|---|
| `IMU_ENABLED` | `false` | `true` / `false` | Whether the app should start the IMU. |
| `IMU_MODE` | `mock` | `mock`, `mpu6500` | Mock driver or real sensor. |
| `IMU_I2C_BUS` | `1` | integer 0-10 | I2C bus number (`/dev/i2c-1` on the Pi 4 header). |
| `IMU_I2C_ADDRESS` | `0x68` | `0x68`, `0x69` (or `104`, `105`) | Sensor address, set by the AD0 pin. |
| `IMU_ACCEL_RANGE_G` | `4` | `2`, `4`, `8`, `16` | Accelerometer full-scale range. |
| `IMU_GYRO_RANGE_DPS` | `500` | `250`, `500`, `1000`, `2000` | Gyroscope full-scale range. |
| `IMU_SAMPLE_RATE_HZ` | `50` | integer 10-200 | How often the sensor is polled. |
| `IMU_CALIBRATION_SAMPLES` | `200` | integer 50-2000 | Samples averaged during calibration. |

Example for the real sensor:
```bash
IMU_ENABLED=true
IMU_MODE=mpu6500
IMU_I2C_ADDRESS=0x68
```

---

## 5. Running

All commands run from `pi-client/`.

```bash
# Mock driver (no hardware needed)
node src/sensors/imu/imu.cli.js --mode=mock

# Real sensor, calibrate first
node src/sensors/imu/imu.cli.js --mode=mpu6500 --calibrate

# Other options
node src/sensors/imu/imu.cli.js --mode=mpu6500 --calibrate --seconds=30 --json
```
The CLI prints one line about every 200 ms with roll, pitch, relative heading, turn rate, motion state and step count. Press **Ctrl+C** to stop; the sensor is put to sleep and the bus closed.

### Tests
```bash
node --test tests/imu-*.test.js
```
Tests use a fake I2C bus and the mock driver, so they run anywhere.

### Calibration procedure
1. Place the device **still and flat on a table**, sensor z-axis up. Do not hold it in your hand.
2. Run calibration (`--calibrate`, or `imu.calibrate()` in code). With defaults it takes **200 samples at 50 Hz, about 4 seconds**. Do not touch or bump the table.
3. Calibration is rejected if the gyro standard deviation is above 2 deg/s or the measured gravity is off from 1 g by more than 0.15 g; both mean the device moved or was not flat. Just retry.
4. **Recalibrate after warm-up (about 5 minutes after power-on).** Gyro bias shifts with temperature, and the chip and Pi warm up noticeably at first. A calibration done cold will drift faster once warm.

---

## 6. Programmatic Usage

```js
const { createImuDriver, loadImuConfig } = require('./sensors/imu');
const logger = require('./utils/logger');

async function startImu() {
  const config = loadImuConfig();            // or loadImuConfig({ IMU_MODE: 'mpu6500' })
  const imu = createImuDriver(config);       // returns a ManagedImu

  await imu.init();
  await imu.calibrate();                     // device still and flat, ~4 s at defaults

  imu.on('sample', (state) => {
    // state: { roll, pitch, relativeHeading, turnRate, motion,
    //          stepCount, accelMagnitude, calibrated, driver, timestamp }
  });

  imu.on('motion', (state, prev) => {
    logger.info(`User is now ${state.motion} (was ${prev.motion})`);
  });

  imu.on('error', (err) => logger.error(`IMU error: ${err.message}`));

  imu.start();

  // At the start of a route segment, make "straight ahead" = 0 degrees
  imu.resetHeading();

  return imu;                                // later: imu.stop(); await imu.dispose();
}
```

Other useful calls: `imu.read()` for a single sample without the polling loop, `imu.getState()` for the latest state, and `imu.getCalibration()` / `imu.setCalibration(cal)` to save and restore a calibration (still recalibrate after warm-up).

---

## 7. Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| `ENOENT` opening `/dev/i2c-1` | I2C not enabled | Enable I2C in `raspi-config` (or `dtparam=i2c_arm=on`) and reboot. Check `ls /dev/i2c-*`. |
| `EACCES` / permission denied | User not in the `i2c` group | `sudo usermod -aG i2c $USER`, then log out and back in. |
| `EREMOTEIO` / no device at address | Wiring, power or wrong address | Run `i2cdetect -y 1`. If nothing shows, check VCC (3.3V, pin 1), GND, SDA (pin 3) and SCL (pin 5) and shorten the wires. If it shows `69`, set `IMU_I2C_ADDRESS=0x69` (or tie AD0 to GND). |
| Warning: WHO_AM_I `0x68` | Board is an MPU-6050 (common on clones sold as MPU-6500) | Accepted with a warning; accel/gyro data should work. Expect slightly different noise and temperature behaviour. |
| Warning: WHO_AM_I `0x71` / `0x73` | Board is an MPU-9250 / MPU-9255 | Accepted; accel/gyro are used, the AK8963 magnetometer is **not** read. |
| Any other WHO_AM_I value | Different chip, or a bad connection | Check the part marking and wiring. |
| `cannot find module 'i2c-bus'` | Library not installed | `npm install i2c-bus` on the Pi (needs `build-essential`, `python3`). |
| Heading drifts quickly or jumps | Poor/cold calibration, loose mount, temperature change | Recalibrate after ~5 minutes of warm-up, mount the sensor rigidly, `resetHeading()` more often. Some drift is expected; see Heading limits. |
| Noisy roll/pitch or false steps | Vibration or loose mounting | Mount rigidly; check the board is not flexing on the strap. |
| Calibration rejected (`ImuCalibrationError`) | Device moved, or not flat during calibration | Put it flat on a table, do not touch it, retry. |

---

## 8. Integration Notes (`archits-work` branch)

### Files to copy
```
pi-client/src/sensors/imu/          (whole folder: driver, mock, processing, interface,
                                     factory, config, errors, cli, index, README)
pi-client/tests/imu-*.test.js
```

### Shared files
- **No changes** were made to `src/config/env.js`, `src/utils/errors.js`, `src/index.js`, `package.json` or `.env.example`. The IMU has its own config loader and error classes, so it can be merged without conflicts.
- **To do when merging:** add `"i2c-bus": "^5.2.3"` to `pi-client/package.json` dependencies. Optionally add the `IMU_*` variables to `.env.example` and start the IMU from `src/index.js` when `IMU_ENABLED=true`.

### Future work
- **Fuse with GPS course-over-ground** (NEO-6M): while the user walks steadily, use GPS course to re-anchor the gyro heading to north and cancel drift; fall back to gyro-only heading for short turns and when stopped.
- **Turn and veer cues:** feed `turnRate` and `relativeHeading` changes into haptic feedback or voice prompts through Nipun's audio module (for example "turned right about 90 degrees", or a gentle cue when veering off a straight segment).
- Optional magnetometer support (QMC5883L, or the AK8963 on MPU-9250 boards).
- Axis remapping for non z-up mounting.
