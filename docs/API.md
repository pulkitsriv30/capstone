# API Documentation & Contracts

**AI-Based Smart Navigation System for Visually Impaired Individuals**  
*Backend Service API Specification & Contract Reference*

---

## 1. Overview & Transport Protocol

- **Base URL (Localhost via ADB):** `http://localhost:3000`
- **Base URL (Local Network / Pi):** `http://<HOST_IP>:3000`
- **Host Binding:** `0.0.0.0:3000`
- **Content Types:** `application/json`, `multipart/form-data`, `audio/mpeg`

### Standard Request & Response Headers

| Header | Direction | Description |
|---|---|---|
| `X-Request-Id` | Request / Response | Unique UUID v4 identifying the request lifecycle across client, backend, and logs. |
| `Content-Type` | Both | `application/json`, `multipart/form-data`, or `audio/mpeg`. |
| `Content-Length` | Response | Byte count of the payload (automatically set on all binary audio buffers). |
| `X-Response-Text` | Response | URL-encoded string containing spoken AI instruction text. |
| `X-User-Query` | Response | URL-encoded string containing the transcribed user voice input. |
| `X-Navigation-Status` | Response | Navigation state: `searching`, `found`, `limit_reached`, `environment_described`. |

---

## 2. Standard Error Response Envelope

All API errors return a consistent JSON error schema:

```json
{
  "success": false,
  "message": "Human-readable error description"
}
```

### Standard Status Codes
- `200 OK`: Successful request.
- `201 Created`: Successful creation (e.g. SOS activation).
- `400 Bad Request`: Validation failure (missing fields, unsupported parameters).
- `404 Not Found`: Requested resource or session ID not found.
- `413 Payload Too Large`: Upload exceeded the 5MB file size limit.
- `500 Internal Server Error`: Internal failure (sanitized; raw secrets/traces are never exposed).
- `502 Bad Gateway`: Upstream external API failure (Gemini / ElevenLabs).
- `504 Gateway Timeout`: External API request exceeded the 30-second timeout threshold.

---

## 3. Endpoints

### 3.1 System Health Diagnostics

#### `GET /api/health`
Returns system status, process uptime, memory diagnostics, and external API readiness.

- **Request:** None
- **Response Status:** `200 OK`
- **Response Format:** `application/json`
```json
{
  "success": true,
  "message": "Backend is running",
  "uptimeSeconds": 312,
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

---

### 3.2 Navigation Orchestrator Services

#### `POST /api/navigation/search`
The primary multi-modal assistive navigation loop. Transcribes user voice query, analyzes camera frame, computes navigation step, and returns spoken audio or native fallback text.

- **Content-Type:** `multipart/form-data`
- **Form Fields:**
  - `sessionId` *(string, required)*: Session identifier (max 128 chars). Used for search attempt tracking.
  - `audio` *(file, required)*: User voice query (`.m4a`, `.mp4`, `.mp3`, `.wav`, max 5MB).
  - `image` *(file, required)*: Current camera frame (`.jpg`, `.jpeg`, `.png`, `.webp`, max 5MB).

- **Success Response (Primary — ElevenLabs TTS Succeeded):**
  - **Status:** `200 OK`
  - **Content-Type:** `audio/mpeg`
  - **Headers:**
    - `Content-Length`: Binary size in bytes
    - `X-Response-Text`: Spoken instruction text (`encodeURIComponent`)
    - `X-User-Query`: Transcribed query (`encodeURIComponent`)
    - `X-Navigation-Status`: `searching` | `found` | `limit_reached`
  - **Body:** Binary MP3 audio buffer

- **Success Response (Fallback — TTS Offline / Rate-Limited):**
  - **Status:** `200 OK`
  - **Content-Type:** `application/json`
  ```json
  {
    "success": true,
    "textResponse": "Your keys are located on the dining table.",
    "userQuery": "where are my keys",
    "status": "found",
    "audioAvailable": false
  }
  ```

---

#### `POST /api/navigation/environment`
Single-shot scene understanding. Captures a camera frame, asks Gemini to describe obstacles, terrain, and hazards, and returns spoken audio description.

- **Content-Type:** `multipart/form-data`
- **Form Fields:**
  - `image` *(file, required)*: Current camera frame (JPEG/PNG/WebP, max 5MB).

- **Success Response (Primary):**
  - **Status:** `200 OK`
  - **Content-Type:** `audio/mpeg`
  - **Headers:**
    - `Content-Length`: Binary size in bytes
    - `X-Response-Text`: Spoken description (`encodeURIComponent`)
    - `X-Navigation-Status`: `environment_described`
  - **Body:** Binary MP3 audio buffer

- **Success Response (Fallback):**
  - **Status:** `200 OK`
  - **Content-Type:** `application/json`
  ```json
  {
    "success": true,
    "textResponse": "A wooden chair is 2 meters directly in front of you. A doorway is open to your left.",
    "status": "environment_described",
    "audioAvailable": false
  }
  ```

---

### 3.3 Vision Services

#### `POST /api/vision/analyze`
Direct Gemini Vision scene analysis endpoint.

- **Content-Type:** `multipart/form-data`
- **Form Fields:**
  - `image` *(file, required)*: Camera image (max 5MB).
  - `question` *(string, optional)*: Specific inquiry (max 1000 chars, defaults to "What is in front of me?").

- **Response:**
  - **Status:** `200 OK`
  - **Content-Type:** `application/json`
  ```json
  {
    "success": true,
    "data": {
      "found": true,
      "target": "water bottle",
      "position": {
        "horizontal": "left",
        "vertical": "center"
      },
      "distance_category": "near",
      "location": "on the kitchen counter",
      "confidence": 0.94,
      "description": "A water bottle is located on the kitchen counter to your left."
    }
  }
  ```

---

### 3.4 Voice Services

#### `POST /api/voice/transcribe`
Converts speech audio into text using ElevenLabs Speech-to-Text (Scribe v1).

- **Content-Type:** `multipart/form-data`
- **Form Fields:**
  - `audio` *(file, required)*: Audio recording (max 5MB).

- **Response:**
  - **Status:** `200 OK`
  ```json
  {
    "success": true,
    "text": "Where did I put my prescription glasses?"
  }
  ```

---

#### `POST /api/voice/speak`
Converts text to speech audio using ElevenLabs Text-to-Speech (`eleven_multilingual_v2`).

- **Content-Type:** `application/json`
- **Request Body:**
  ```json
  {
    "text": "Please turn slightly to your right."
  }
  ```
- **Response:**
  - **Status:** `200 OK`
  - **Content-Type:** `audio/mpeg`
  - **Headers:**
    - `Content-Length`: Binary size in bytes
    - `X-Response-Text`: Encoded text
  - **Body:** Binary MP3 audio buffer

---

### 3.5 GPS Location Services (Archit)

#### `POST /api/gps/location`
Stores current device GPS coordinates.

- **Content-Type:** `application/json`
- **Request Body:**
  ```json
  {
    "deviceId": "pi-device-01",
    "latitude": 28.6139,
    "longitude": 77.2090,
    "accuracy": 4.5,
    "timestamp": "2026-11-19T00:05:00.000Z"
  }
  ```
- **Response:** `200 OK`
  ```json
  {
    "success": true,
    "message": "Location updated",
    "data": {
      "latitude": 28.6139,
      "longitude": 77.2090,
      "accuracy": 4.5,
      "timestamp": "2026-11-19T00:05:00.000Z",
      "updatedAt": "2026-11-19T00:05:01.120Z"
    }
  }
  ```

---

#### `GET /api/gps/location/:deviceId`
Retrieves last known GPS coordinates for a specific device.

- **Response:** `200 OK`
  ```json
  {
    "success": true,
    "data": {
      "latitude": 28.6139,
      "longitude": 77.2090,
      "accuracy": 4.5,
      "timestamp": "2026-11-19T00:05:00.000Z",
      "updatedAt": "2026-11-19T00:05:01.120Z"
    }
  }
  ```

---

### 3.6 Emergency SOS Subsystem (Archit)

> [!IMPORTANT]
> **Independent Execution Path:** The emergency SOS system has **zero dependencies** on Gemini, ElevenLabs, or any AI services. It will function with 100% reliability even during cloud/AI outages.

#### `POST /api/sos/activate`
Triggers an emergency alert, broadcasts notification, and enriches coordinates with last-known GPS data if omitted.

- **Content-Type:** `application/json`
- **Request Body:**
  ```json
  {
    "deviceId": "pi-device-01",
    "trigger": "voice_activation",
    "message": "User initiated emergency SOS assistance",
    "latitude": 28.6139,
    "longitude": 77.2090,
    "accuracy": 5.0
  }
  ```
- **Response:** `201 Created`
  ```json
  {
    "success": true,
    "sosId": "c8a49c95-3b95-46f9-bd60-ea795dbebb32",
    "active": true,
    "alertsSent": 2,
    "message": "Emergency contacts notified successfully",
    "isDuplicate": false
  }
  ```

*(Note: Triggering within a 15-second debounce window returns `isDuplicate: true` with the existing `sosId` to prevent notification flooding).*

---

#### `GET /api/sos/status/:sosId`
Fetches real-time status of an active or resolved emergency alert.

- **Response:** `200 OK`
  ```json
  {
    "success": true,
    "data": {
      "sosId": "c8a49c95-3b95-46f9-bd60-ea795dbebb32",
      "deviceId": "pi-device-01",
      "active": true,
      "activatedAt": "2026-11-19T00:05:00.000Z",
      "deactivatedAt": null,
      "location": {
        "latitude": 28.6139,
        "longitude": 77.2090,
        "accuracy": 5.0
      },
      "trigger": "voice_activation",
      "message": "User initiated emergency SOS assistance",
      "contactsNotified": [
        { "name": "Primary Emergency Contact", "method": "sms", "status": "delivered" },
        { "name": "Secondary Emergency Contact", "method": "sms", "status": "delivered" }
      ],
      "alertsSent": 2
    }
  }
  ```

---

#### `POST /api/sos/deactivate`
Deactivates an active emergency alert.

- **Content-Type:** `application/json`
- **Request Body:**
  ```json
  {
    "sosId": "c8a49c95-3b95-46f9-bd60-ea795dbebb32",
    "deviceId": "pi-device-01"
  }
  ```
- **Response:** `200 OK`
  ```json
  {
    "success": true,
    "sosId": "c8a49c95-3b95-46f9-bd60-ea795dbebb32",
    "active": false,
    "message": "SOS emergency alert deactivated",
    "deactivatedAt": "2026-11-19T00:07:15.000Z"
  }
  ```

---

## 4. File Upload Constraints & Specifications

- **Maximum File Size:** 5MB (`5 * 1024 * 1024` bytes) across all file fields.
- **Allowed Image Formats:** `image/jpeg`, `image/jpg`, `image/png`, `image/webp`.
- **Allowed Audio Formats:** `audio/mp4`, `audio/m4a`, `audio/mpeg`, `audio/mp3`, `audio/wav`, `audio/aac`, `audio/webm`.
- **Field Names:**
  - `image`: Single camera snapshot frame.
  - `audio`: Single audio query recording.
