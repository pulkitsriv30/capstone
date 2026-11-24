# Architecture

## Stack Overview

```
Android/Kotlin Client
    │
    │  USB cable (ADB reverse tcp:3000 tcp:3000)
    │
    ▼
Node.js / Express Backend  (port 3000)
    │
    ├── POST /api/navigation/search        ← voice query + camera frame
    │       │
    │       ├── VisionService.transcribeAudio()   → Gemini STT
    │       ├── VisionService.analyzeImage()      → Gemini Vision (object-search prompt)
    │       └── NavigationService.decideNextAction()  → session state machine
    │
    ├── POST /api/navigation/environment   ← camera frame only
    │       │
    │       ├── VisionService.describeEnvironment()  → Gemini Vision (environment prompt)
    │       └── NavigationService.describeEnvironment()
    │
    ├── POST /api/vision/analyze           ← raw vision debug endpoint
    └── POST /api/voice/speak              ← ElevenLabs TTS
        POST /api/voice/transcribe         ← ElevenLabs STT (unused in main flow)
    │
    ├── ElevenLabs TTS  → audio/mpeg response
    │   (falls back to JSON text if ElevenLabs fails — Android uses native TTS)
    │
    └── Gemini Vision API
            Model fallback chain: gemini-3.6-flash → gemini-3.5-flash → gemini-3.5-flash-lite
```

## Key Design Decisions

| Decision | Reason |
|----------|--------|
| ADB USB reverse port forwarding | Bypasses Wi-Fi, router isolation, and Windows Firewall completely |
| Gemini model fallback chain | Handles 503/429 overloads automatically without user-visible errors |
| Dual-mode response (audio/JSON) | If ElevenLabs TTS fails, Android falls back to native TextToSpeech |
| Camera frame resized to 800px | Prevents HTTP 408 timeouts caused by 5MB+ raw camera uploads |
| Two separate Gemini prompts | Environment description (safety-first) vs object search (strict boolean) serve different user needs |
| Session-based search (max 6 attempts) | Gives the user structured scan guidance without looping forever |

## Prompt Architecture

Prompts live in `shared/prompts/` and are loaded at backend startup:

| File | Used by | Purpose |
|------|---------|---------|
| `environment.prompt` | `VisionService.describeEnvironment()` | Safety-first scene description for navigation |
| `object-search.prompt` | `VisionService.analyzeImage()` | Locating a specific object in the frame |
| `navigation.prompt` | *(reference)* | Navigation-specific guidance principles |

## API Keys

All API keys remain exclusively on the backend in `backend/.env`.
The Android app never contacts Gemini or ElevenLabs directly.
`.env` is excluded from Git via `.gitignore`.
