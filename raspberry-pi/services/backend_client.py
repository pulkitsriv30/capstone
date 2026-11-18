from pathlib import Path
import requests


class BackendClient:
    def __init__(self, base_url: str, timeout=(10, 120)):
        self.base_url = base_url.rstrip("/")
        self.session = requests.Session()
        self.timeout = timeout

    def transcribe(self, audio_path: Path) -> str:
        # ElevenLabs STT is called server-side; API credentials never leave backend.
        with audio_path.open("rb") as audio:
            response = self.session.post(
                f"{self.base_url}/api/voice/transcribe",
                files={"audio": (audio_path.name, audio, "audio/wav")},
                timeout=self.timeout,
            )
        response.raise_for_status()
        text = response.json().get("text", "").strip()
        if not text:
            raise RuntimeError("Speech transcription returned no text.")
        return text

    def describe_environment(self, image_path: Path):
        with image_path.open("rb") as image:
            response = self.session.post(
                f"{self.base_url}/api/navigation/environment",
                files={"image": (image_path.name, image, "image/jpeg")},
                timeout=self.timeout,
            )
        response.raise_for_status()
        content_type = response.headers.get("Content-Type", "")
        if "audio" in content_type:
            return {"audio": response.content, "text": response.headers.get("X-Response-Text", "")}
        return response.json()

    def analyze_question(self, image_path: Path, question: str):
        # Existing vision endpoint accepts a text question and returns structured JSON.
        with image_path.open("rb") as image:
            response = self.session.post(
                f"{self.base_url}/api/vision/analyze",
                files={"image": (image_path.name, image, "image/jpeg")},
                data={"question": question},
                timeout=self.timeout,
            )
        response.raise_for_status()
        return response.json()

    def speak(self, text: str) -> bytes:
        response = self.session.post(
            f"{self.base_url}/api/voice/speak",
            json={"text": text},
            timeout=self.timeout,
        )
        response.raise_for_status()
        return response.content
