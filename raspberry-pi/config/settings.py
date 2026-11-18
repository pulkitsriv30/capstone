from dataclasses import dataclass
import os
from pathlib import Path
from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parents[1]
load_dotenv(ROOT / ".env")


def _optional_int(name: str):
    value = os.getenv(name, "").strip()
    return int(value) if value else None


@dataclass(frozen=True)
class Settings:
    backend_base_url: str = os.getenv("BACKEND_BASE_URL", "http://127.0.0.1:3000").rstrip("/")
    input_device: int | None = _optional_int("INPUT_DEVICE")
    wake_word_model: Path = ROOT / os.getenv("WAKE_WORD_MODEL", "models/analyse.onnx")
    wake_word_threshold: float = float(os.getenv("WAKE_WORD_THRESHOLD", "0.55"))
    sample_rate: int = int(os.getenv("SAMPLE_RATE", "16000"))
    command_max_seconds: int = int(os.getenv("COMMAND_MAX_SECONDS", "8"))
    command_end_silence_seconds: float = float(os.getenv("COMMAND_END_SILENCE_SECONDS", "1.2"))
    command_initial_silence_seconds: float = float(os.getenv("COMMAND_INITIAL_SILENCE_SECONDS", "2.0"))
    command_rms_threshold: float = float(os.getenv("COMMAND_RMS_THRESHOLD", "350"))
    camera_index: int = int(os.getenv("CAMERA_INDEX", "0"))
    image_width: int = int(os.getenv("IMAGE_WIDTH", "1280"))
    image_jpeg_quality: int = int(os.getenv("IMAGE_JPEG_QUALITY", "85"))


settings = Settings()
