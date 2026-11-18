
import logging
from pathlib import Path

from openwakeword.model import Model

logger = logging.getLogger(__name__)


class WakeWordDetector:
    """Local Hey Mycroft wake-word detection using OpenWakeWord ONNX."""

    def __init__(self, model_path: Path, threshold: float):
        model_path = Path(model_path).resolve()
        model_dir = model_path.parent

        melspec_path = model_dir / "melspectrogram.onnx"
        embedding_path = model_dir / "embedding_model.onnx"

        required_files = [
            model_path,
            melspec_path,
            embedding_path,
        ]

        for file_path in required_files:
            if not file_path.is_file():
                raise FileNotFoundError(
                    f"Required wake-word model file not found: {file_path}"
                )

        self.threshold = threshold

        self.model = Model(
            wakeword_models=[str(model_path)],
            inference_framework="onnx",
            melspec_model_path=str(melspec_path),
            embedding_model_path=str(embedding_path),
        )

        self.model_name = next(iter(self.model.models.keys()))

        logger.info(
            "Loaded wake-word model: %s | Threshold: %.2f",
            self.model_name,
            self.threshold,
        )

    def detected(self, audio_frame):
        scores = self.model.predict(audio_frame)
        score = float(scores.get(self.model_name, 0.0))

        if score >= self.threshold:
            logger.info("Wake word detected. Confidence: %.3f", score)
            self.model.reset()
            return True

        return False