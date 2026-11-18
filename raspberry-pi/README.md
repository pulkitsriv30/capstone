# Raspberry Pi Voice Client

This is the first laptop-testable implementation of the standalone voice client. It is separate from the Android app and keeps API credentials on the existing Node.js backend.

## Current flow

1. OpenWakeWord performs local, continuous wake-word inference.
2. After the wake word, the client waits briefly for a follow-up command. If none is spoken, it defaults to environmental analysis. Otherwise, it records the command until sustained silence or the configured maximum duration.
3. The WAV recording is uploaded to the existing `POST /api/voice/transcribe` endpoint. The backend calls ElevenLabs Scribe.
4. The command router dispatches `analyse` to `/api/navigation/environment`, and `find ...` / `where is ...` / `locate ...` to `/api/vision/analyze` with the transcribed text as the question.
5. Responses returned as MP3 are played locally. Text-only results are sent to `/api/voice/speak` first.
6. The loop returns to wake-word listening.

## Important prerequisite: custom wake-word model

The repository does not contain a trained OpenWakeWord model for the phrase **Analyse**. The application deliberately does not pretend a generic pretrained model recognizes this custom phrase. Obtain/train an OpenWakeWord-compatible ONNX model for `Analyse` and place it at `models/analyse.onnx` (or configure `WAKE_WORD_MODEL`). Until then, startup exits with a clear missing-model error.

Wake-word quality must be evaluated with multiple speakers, accents, distances, and background-noise conditions before claiming reliable hands-free activation.

## Laptop setup (Windows PowerShell)

1. Start the existing backend from `backend/` and confirm `http://localhost:3000/api/health` is reachable.
2. In this directory, create a virtual environment and install dependencies:

   ```powershell
   py -3.11 -m venv .venv
   .\.venv\Scripts\Activate.ps1
   python -m pip install --upgrade pip
   pip install -r requirements.txt
   Copy-Item .env.example .env
   ```

3. Set `BACKEND_BASE_URL=http://127.0.0.1:3000` in `.env`.
4. Connect a webcam and microphone. Adjust `CAMERA_INDEX` / `INPUT_DEVICE` if needed.
5. Add the trained `Analyse` model at `models/analyse.onnx`.
6. Run:

   ```powershell
   python main.py
   ```

MP3 playback uses pygame, so the same Python implementation can be used for Windows laptop simulation and Raspberry Pi OS.

## Raspberry Pi OS setup

```bash
sudo apt update
sudo apt install -y python3-venv python3-dev libportaudio2 portaudio19-dev libsndfile1
python3 -m venv .venv --system-site-packages
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
```

Set `BACKEND_BASE_URL` to the backend host reachable over the network, and set the correct camera/microphone devices. Install the trained wake-word model, then test manually with `python main.py` before enabling boot startup.

## Run at boot with systemd

Copy `systemd/assistive-voice.service` to `/etc/systemd/system/` and edit its `WorkingDirectory`, `ExecStart`, and `User` values to match the Pi deployment path/user. Then:

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now assistive-voice.service
sudo journalctl -u assistive-voice.service -f
```

## Current limitations / integration boundaries

- The `Analyse` ONNX model is not included and must be trained/provided.
- `Find` uses the existing text-question vision endpoint, avoiding the existing `/navigation/search` path that performs a second transcription through Gemini.
- GPS navigation and SOS are not wired because the corresponding team modules/API contracts are not yet in this repository snapshot. The client responds honestly that these interfaces are pending.
- `Stop` is currently handled when the client is listening for a new command. The main interaction loop is synchronous, so a wake-word interruption during active playback is not yet implemented.
- Command capture uses a configurable RMS silence gate and a short initial-silence timeout. Tune it for the selected microphone and environment; replace it with a proper VAD if field tests show clipping or false stops.
- This is a development prototype, not a safety-certified mobility aid. Do not rely on it as the sole means of avoiding obstacles or navigating traffic.
