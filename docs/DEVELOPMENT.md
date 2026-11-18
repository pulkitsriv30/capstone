# Development & Infrastructure Guide

This guide covers local environment setup, backend execution, and network connectivity between client devices (Android and Raspberry Pi) and the Node.js backend.

---

## 1. Local Environment Setup

### Prerequisites
- Node.js (v18.0.0 or higher)
- npm (v9.0.0 or higher)

### Setup Steps
1. Navigate to the backend directory:
   ```bash
   cd backend
   ```
2. Copy the environment configuration template:
   ```bash
   cp .env.example .env
   # Or on Windows PowerShell:
   Copy-Item .env.example .env
   ```
3. Populate `.env` with your API credentials:
   ```env
   PORT=3000
   GEMINI_API_KEY=your_gemini_api_key_here
   ELEVENLABS_API_KEY=your_elevenlabs_api_key_here
   ELEVENLABS_VOICE_ID=your_elevenlabs_voice_id_here
   CORS_ORIGINS=http://localhost:3000
   ```
4. Install dependencies:
   ```bash
   npm install
   ```
5. Run the server:
   ```bash
   # Development mode with auto-reload (Node 18+ watch mode)
   npm run dev

   # Or standard production start
   npm start
   ```

---

## 2. Raspberry Pi Integration & Networking Architecture

The backend binds to `0.0.0.0:${PORT}` (by default port `3000`), allowing connections from any device on the local network (Wi-Fi or Ethernet).

### A. Finding Your Host Machine's Local IP Address
On your development machine (where the backend runs):
- **Windows:** Run `ipconfig` in PowerShell or CMD. Look for `IPv4 Address` under your active Wi-Fi or Ethernet adapter (e.g., `192.168.1.45`).
- **macOS / Linux:** Run `ifconfig` or `ip addr show`. Look for `inet` under `wlan0` or `en0`.

> [!NOTE]
> `localhost` on the Raspberry Pi refers to the Pi itself, **not** your development laptop. The Raspberry Pi must point to your laptop's Wi-Fi IP address.

### B. Windows Firewall Configuration
By default, Windows Firewall blocks incoming connections on non-standard ports like `3000`. To permit incoming connections from your Raspberry Pi, run the following command in **PowerShell as Administrator**:

```powershell
New-NetFirewallRule -DisplayName "Capstone Assistive Backend 3000" -Direction Inbound -LocalPort 3000 -Protocol TCP -Action Allow
```

To remove the rule later if needed:
```powershell
Remove-NetFirewallRule -DisplayName "Capstone Assistive Backend 3000"
```

### C. Raspberry Pi Client Configuration
On the Raspberry Pi, configure the backend base URL using an environment variable or configuration file:

```bash
export BACKEND_URL="http://192.168.1.45:3000"
```

In your Pi Python client (`requests` or `httpx`):
```python
import os
import requests

BACKEND_URL = os.getenv("BACKEND_URL", "http://192.168.1.45:3000")

# Verify connection
response = requests.get(f"{BACKEND_URL}/api/health", timeout=10)
print(response.json())
```

### D. Critical Timeout Considerations for Raspberry Pi
The `/api/navigation/search` endpoint orchestrates:
1. Audio upload and transcription (Gemini STT: 1–3s)
2. Camera image upload and scene reasoning (Gemini Vision: 2–5s)
3. Navigation decision engine (NavigationService: <5ms)
4. Audio speech generation (ElevenLabs TTS: 1–4s)

**Total latency can range between 4 to 15 seconds depending on network speed.**

* Always configure your Raspberry Pi HTTP client timeout to **at least 60 seconds**:
  ```python
  # Python requests example
  response = requests.post(
      f"{BACKEND_URL}/api/navigation/search",
      files={"audio": audio_file, "image": image_file},
      data={"sessionId": session_id},
      timeout=60 # Must not be default or short (<10s)
  )
  ```

### E. Health Diagnostic Verification
Verify the backend status from the Raspberry Pi terminal:
```bash
curl http://<HOST_IP>:3000/api/health
```
Expected JSON response:
```json
{
  "success": true,
  "message": "Backend is running",
  "uptimeSeconds": 142,
  "timestamp": "2026-11-19T00:00:00.000Z",
  "memory": {
    "heapUsedMB": 38,
    "heapTotalMB": 56
  },
  "services": {
    "geminiConfigured": true,
    "elevenlabsConfigured": true
  }
}
```
