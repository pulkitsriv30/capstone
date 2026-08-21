# API Documentation

## 1. Health
`GET /api/health`
Returns the status of the backend.

**Response:**
```json
{
  "success": true,
  "message": "Backend is running"
}
```

## 2. Voice Services
`POST /api/voice/transcribe`
Converts uploaded audio to text using ElevenLabs.
**Form Data:**
- `audio`: The audio file

**Response:**
```json
{
  "success": true,
  "text": "Where are my spectacles?"
}
```

`POST /api/voice/speak`
Converts text to speech audio.
**JSON Body:**
```json
{
  "text": "Please turn slightly left."
}
```
**Response:** `audio/mpeg` binary data.

## 3. Vision Services
`POST /api/vision/analyze`
Analyzes an image and answers a question.
**Form Data:**
- `image`: The camera frame
- `question`: (Optional) Text question

**Response:**
```json
{
  "success": true,
  "data": {
    "found": true,
    "target": "spectacles",
    "position": { "horizontal": "right", "vertical": "center" },
    "distance_category": "near",
    "location": "on a table",
    "confidence": 0.91,
    "description": "Spectacles are visible on a table to the right."
  }
}
```

## 4. Navigation (Orchestrator)
`POST /api/navigation/search`
The full object search workflow.
**Form Data:**
- `sessionId`: Unique ID for the current search session.
- `audio`: User's voice query.
- `image`: Current camera frame.

**Response:** `audio/mpeg` binary data containing the spoken instructions.
**Headers:**
- `X-Response-Text`: The text response.
- `X-Navigation-Status`: Status of the search (`searching`, `found`, `limit_reached`).

`POST /api/navigation/environment`
Describes the environment.
**Form Data:**
- `image`: Current camera frame.

**Response:** `audio/mpeg` binary data containing the environment description.
