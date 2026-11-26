# Raspberry Pi 4 & Camera Setup Guide

**Module:** `pi-client/` (`feature/camera-integration`)  
**Owner:** Krish Jain — Raspberry Pi & Camera Integration Lead

---

## 1. Raspberry Pi 4 (8GB) OS & Hardware Setup

### A. Flash 64-bit Raspberry Pi OS
1. Download **Raspberry Pi Imager** on your laptop.
2. Select **Raspberry Pi 4** as the device.
3. Choose **Raspberry Pi OS (64-bit)** (Bookworm / Debian 12 or newer).
4. Click **Edit Settings** before writing the microSD card:
   - Set **Hostname** (e.g., `nav-glasses.local`).
   - Enable **SSH** (use password or public key).
   - Configure **Wi-Fi SSID & Password** (must match the same Wi-Fi network as the backend laptop/server).
   - Set username/password (e.g., `pi`).

### B. Connect Camera & Power
1. **Power off** the Pi completely before touching the CSI ribbon cable.
2. Lift the plastic latch on the **CAMERA** port (next to the HDMI ports, *not* the DISPLAY port).
3. Insert the 15-pin CSI ribbon cable with the **blue backing facing the Ethernet/USB ports** (silver contacts facing HDMI ports), then press the latch down firmly.
4. Connect an official **5.1V / 3.0A USB-C power supply** (under-powered phone chargers cause camera timeouts and Wi-Fi drops).

---

## 2. SSH, Node.js & System Packages

Connect from your laptop:
```bash
ssh pi@nav-glasses.local
```

### Install Node.js 20 LTS (ARM64) & System Tools
```bash
# 1. Update OS and install camera/audio system packages
sudo apt update && sudo apt upgrade -y
sudo apt install -y git rpicam-apps ffmpeg mpg123 espeak-ng v4l-utils

# 2. Install Node.js 20 LTS
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs

# Verify versions
node -v   # Should be v20.x or newer
npm -v
```

### Verify Physical Camera Sensor
Run over SSH:
```bash
rpicam-still --list-cameras
```
- **Expected:** Lists your sensor (e.g., `0 : imx219 ...` or `0 : imx708 ...`).
- **If `No cameras available`:** Re-seat the CSI ribbon cable (power off first), ensure `camera_auto_detect=1` is present in `/boot/firmware/config.txt`, and reboot (`sudo reboot`).

### Verify Audio Output
Test your wired 3.5mm earphones, USB audio dongle, or Bluetooth headset:
```bash
espeak-ng "Audio check complete"
```

---

## 3. Project Installation & Configuration

### Clone & Install
```bash
git clone https://github.com/pulkitsriv30/capstone.git
cd capstone
git checkout feature/camera-integration

cd pi-client
npm install
cp .env.example .env
```

### Configure `pi-client/.env`
Find the backend laptop's Wi-Fi IP (`ipconfig` on Windows, `ifconfig` on macOS/Linux) and update `.env`:
```env
BACKEND_URL=http://192.168.1.45:3000
CAMERA_MODE=pi
CAMERA_DEVICE=auto
IMAGE_MAX_WIDTH=800
IMAGE_QUALITY=75
CAMERA_WARMUP_MS=500
REQUEST_TIMEOUT_MS=60000
AUDIO_PLAYER_ENABLED=true
AUDIO_PLAYER_BACKEND=auto
```

> [!IMPORTANT]
> If the Node.js backend runs on Windows, ensure Windows Firewall allows incoming TCP port `3000` (run PowerShell as Administrator):
> ```powershell
> New-NetFirewallRule -DisplayName "Capstone Assistive Backend 3000" -Direction Inbound -LocalPort 3000 -Protocol TCP -Action Allow
> ```

---

## 4. Running the System

### A. Laptop Webcam Simulation Mode (Windows / macOS / Linux)
Test the full pipeline on any laptop before hardware assembly:
```bash
cd pi-client
npm install
cp .env.example .env
# Ensure CAMERA_MODE=webcam and BACKEND_URL=http://localhost:3000
npm run simulate
```
- Press `t` to capture a local webcam test frame and verify resolution (`<=800px` wide), size (`<5MB`), and lighting (`mean brightness`).
- Press `[Enter]` or `e` to capture a frame, send it to `POST /api/navigation/environment`, and hear the spoken AI description through laptop speakers.

### B. Raspberry Pi Mode
On the Raspberry Pi (with `CAMERA_MODE=pi`, or `CAMERA_MODE=usb` for a USB spectacles camera):
```bash
cd pi-client
npm start
```

### C. Offline Automated Test Mode (No Camera / No Backend Required)
```bash
cd pi-client
npm test
```

---

## 5. Optional: Auto-Start on Boot (`systemd`)

To run the wearable controller automatically on boot:
```ini
# /etc/systemd/system/nav-pi-client.service
[Unit]
Description=AI Assistive Navigation Pi Client
After=network-online.target sound.target
Wants=network-online.target

[Service]
Type=simple
User=pi
WorkingDirectory=/home/pi/capstone/pi-client
ExecStart=/usr/bin/node /home/pi/capstone/pi-client/src/index.js
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
```
Enable with:
```bash
sudo systemctl daemon-reload
sudo systemctl enable --now nav-pi-client
```
