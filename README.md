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

## Backend Setup
1. Navigate to the `backend/` directory.
2. Run `npm install` to install dependencies.
3. Configure your `.env` file.
4. Run `npm run dev` to start the development server.

## Android Setup
1. Open the `mobile/android` directory in Android Studio.
2. Sync Gradle dependencies.
3. Build and deploy to an Android device.

## Running Locally
- Start the backend server on your machine.
- Ensure the Android app points to your local machine's IP address if running on the same network.

## Testing
- Backend tests can be run via `npm test` inside the `backend` directory.

## API Endpoints
- `GET /api/health` - Health check
- `POST /api/voice/transcribe` - Convert audio to text
- `POST /api/voice/speak` - Convert text to audio
- `POST /api/vision/analyze` - Analyze camera frame

## Known Limitations
- Current version relies on an active internet connection.
- Vision AI may misidentify small or distant objects.

## Future Improvements
- Offline AI support
- GPS navigation & Route planning
- Depth estimation and object tracking
