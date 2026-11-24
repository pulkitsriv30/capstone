# API Documentation

All endpoints are served on `http://localhost:3000` (via ADB reverse port forwarding on physical devices).

---

## 1. Health

### `GET /api/health`
Returns backend status.

**Response:**
```json
{ "success": true, "message": "Backend is running" }
```

---

## 2. Voice Services

### `POST /api/voice/transcribe`
Converts uploaded audio to text using ElevenLabs STT.

**Form Data:**
- `audio` — audio file

**Response:**
```json
{ "success": true, "text": "Where are my spectacles?" }
```

---

### `POST /api/voice/speak`
Converts text to speech audio using ElevenLabs TTS.

**JSON Body:**
```json
{ "text": "Please turn slightly left." }
```

**Response:** `audio/mpeg` binary audio data.

---

## 3. Vision Services

### `POST /api/vision/analyze`
Raw vision debug endpoint. Analyzes an image for a specific object (uses object-search prompt).

**Form Data:**
- `image` — camera frame (JPEG)
- `question` *(optional)* — text question / object to find

**Response:**
```json
{
  "success": true,
  "data": {
    "found": true,
    "target": "spectacles",
    "position": { "horizontal": "right", "vertical": "center" },
    "distance_category": "near",
    "location": "on a table to the right",
    "confidence": 0.91,
    "description": "Your spectacles are visible on a table to your right."
  }
}
```

---

## 4. Navigation (Orchestrator)

### `POST /api/navigation/search`
Full object-search workflow: STT → Gemini Vision (object-search prompt) → navigation decision → TTS.

**Form Data:**
- `sessionId` — unique string per search session
- `audio` — user's voice query (audio file)
- `image` — current camera frame (JPEG)

**Response — when ElevenLabs TTS succeeds:**
```
Content-Type: audio/mpeg
X-Response-Text: (URL-encoded spoken instruction)
X-User-Query: (URL-encoded transcribed user query)
X-Navigation-Status: searching | found | limit_reached
Body: <audio/mpeg binary>
```

**Response — when ElevenLabs TTS fails (fallback):**
```json
{
  "success": true,
  "textResponse": "Your keys are visible on the desk to your left.",
  "userQuery": "where are my keys",
  "status": "found",
  "audioAvailable": false
}
```
*(Android client falls back to native TextToSpeech when `audioAvailable: false`)*

---

### `POST /api/navigation/environment`
Environment description workflow: Gemini Vision (environment/safety-first prompt) → TTS.

**Form Data:**
- `image` — current camera frame (JPEG)

**Response — when ElevenLabs TTS succeeds:**
```
Content-Type: audio/mpeg
X-Response-Text: (URL-encoded scene description)
X-Navigation-Status: environment_described
Body: <audio/mpeg binary>
```

**Response — when ElevenLabs TTS fails (fallback):**
```json
{
  "success": true,
  "textResponse": "Directly ahead there is a closed door. To your left is a table with chairs around it.",
  "status": "environment_described",
  "audioAvailable": false
}
```

---

## Navigation Status Values

| Status | Meaning |
|--------|---------|
| `searching` | Object not found in this frame; scan instruction provided |
| `found` | Object located; position described |
| `limit_reached` | 6 search attempts exhausted; suggest moving to new position |
| `environment_described` | Scene description complete |

---

## Distance Categories

| Value | Rough meaning |
|-------|---------------|
| `very_close` | Arm's reach or closer |
| `near` | A few steps away |
| `medium` | Across the room |
| `far` | Visible but distant |
| `unknown` | Cannot be estimated from image alone |

> **Important:** These categories are approximations based on 2D image analysis only. The system does NOT perform real depth sensing or guarantee metric accuracy.
