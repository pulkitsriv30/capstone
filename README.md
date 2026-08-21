# AI Assistive Navigation App

Prototype architecture for an AI-powered voice-first assistive navigation Android app.

## Project Purpose
To build a production-oriented prototype of an AI-powered assistive navigation application for visually impaired users. The application allows a blind user to operate the system primarily through voice, interacting with a camera-based AI vision system to understand their surroundings and navigate safely.

## Architecture
- **Mobile Client**: Android App (Kotlin, CameraX, Text-to-Speech, Speech-to-Text). Minimal UI, voice-first interaction.
- **Backend API**: Node.js/Express.js Server. Orchestrates AI services, keeping API keys secure.
- **AI Services**:
  - **Speech-to-Text (STT)**: ElevenLabs
  - **Text-to-Speech (TTS)**: ElevenLabs
  - **Vision**: Gemini Vision

## Technologies
- Android (Kotlin)
- Node.js (Express, JavaScript)
- ElevenLabs API
- Gemini API

## Environment Variables
See `.env.example` for the list of required environment variables. Add a `.env` file in the `backend` directory.

## Execution Guide (Step-by-Step)

### Prerequisites
- Node.js (v18+)
- Android Studio
- Physical Android Device connected via USB cable (USB Debugging enabled)

---

### Step 1: Environment Setup
Ensure `backend/.env` exists with your API keys:
```env
PORT=3000
ELEVENLABS_API_KEY=your_elevenlabs_key
ELEVENLABS_VOICE_ID=pNInz6obpgDQGcFmaJgB
GEMINI_API_KEY=your_gemini_api_key
```

---

### Step 2: Start the Backend Server
Open terminal in the project directory:
```bash
cd backend
npm install
npm run dev
```
The server will start listening on `http://0.0.0.0:3000`.

---

### Step 3: Enable ADB USB Port Forwarding
Connect your physical Android phone via USB cable and run:
```bash
adb reverse tcp:3000 tcp:3000
```
*(If `adb` is not in your system PATH, use `C:\Users\Pulkit\AppData\Local\Android\Sdk\platform-tools\adb.exe reverse tcp:3000 tcp:3000`)*

This routes `localhost:3000` on the Android phone directly to your laptop over USB, completely bypassing Wi-Fi or firewall issues.

---

### Step 4: Run the App in Android Studio
1. Open Android Studio and select the `mobile/android` project folder.
2. Select your connected physical Android phone from the device dropdown.
3. Click the green **Run (Play ▶)** button (`Shift + F10`).

---

### Step 5: Operating the App
- **Voice Query / Search**:
  1. Press and **HOLD** anywhere on the screen.
  2. Listen for the audio feedback: *"Started listening"*.
  3. Speak your query (e.g., *"What is in front of me?"*).
  4. **Release** your finger. Listen for: *"Stopped listening. Analyzing."*
  5. The AI response will be spoken aloud and displayed in green text.
- **Describe Environment**:
  - Tap the **"Describe Environment"** button to capture a frame and hear a full scene overview.

---

## Known Architecture & Fallbacks
- **Vision & STT**: Google Gemini 3.6 Flash (`gemini-3.6-flash`). Automatic model fallback across Gemini 3.x series if rate-limited.
- **Text-to-Speech (TTS)**: ElevenLabs API (`elevenlabs_multilingual_v2`), with automatic fallback to Android Native TextToSpeech if network or tier limits occur.
- **Image Optimization**: CameraX captures frames and auto-resizes them to 800px width before transmission to ensure sub-second response times.
