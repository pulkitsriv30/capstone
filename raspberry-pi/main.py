import logging
import tempfile
import time
from pathlib import Path

import numpy as np
import soundfile as sf

from config.settings import settings
from services.backend_client import BackendClient
from voice.audio_capture import AudioCapture
from voice.audio_playback import AudioPlayback
from voice.camera import Camera
from voice.command_router import CommandRouter
from voice.wake_word import WakeWordDetector

logging.basicConfig(level=getattr(logging, "INFO"), format="%(asctime)s %(levelname)s %(name)s: %(message)s")
logger = logging.getLogger("assistive-navigation")


def main():
    logger.info("Starting voice assistant")
    wake_word = WakeWordDetector(settings.wake_word_model, settings.wake_word_threshold)
    audio = AudioCapture(settings.sample_rate, settings.input_device, settings.command_rms_threshold)
    playback = AudioPlayback()
    camera = Camera(settings.camera_index, settings.image_width, settings.image_jpeg_quality)
    backend = BackendClient(settings.backend_base_url)
    router = CommandRouter(backend, camera, playback)

    logger.info("Listening continuously for wake word 'Hey Mycroft'")
    while True:
        try:
            for frame in audio.listen_for_wake_word():
                if not wake_word.detected(frame):
                    continue

                logger.info("Wake word detected")
                playback.play_mp3(backend.speak("Listening."))
                command_bytes = audio.record_command(
                    settings.command_max_seconds,
                    settings.command_end_silence_seconds,
                    settings.command_initial_silence_seconds,
                )

                # A standalone wake word means: describe the current environment.
                if not command_bytes:
                    logger.info("No follow-up command; defaulting to environment analysis")
                    router.execute("analyse")
                else:
                    with tempfile.TemporaryDirectory(prefix="assistive-command-") as temp_dir:
                        command_path = Path(temp_dir) / "command.wav"
                        samples = np.frombuffer(command_bytes, dtype=np.int16)
                        sf.write(command_path, samples, settings.sample_rate, subtype="PCM_16")
                        command = backend.transcribe(command_path)
                    logger.info("Recognized command: %s", command)
                    router.execute(command)

                logger.info("Returning to wake-word listening")
                break
        except KeyboardInterrupt:
            logger.info("Shutting down voice assistant")
            return
        except Exception:
            logger.exception("Voice loop error; retrying in 2 seconds")
            time.sleep(2)


if __name__ == "__main__":
    main()
