from io import BytesIO
import logging
import time
import pygame

logger = logging.getLogger(__name__)


class AudioPlayback:
    """Cross-platform MP3 playback for Windows development and Raspberry Pi OS."""

    def __init__(self):
        if not pygame.mixer.get_init():
            pygame.mixer.init()

    def play_mp3(self, audio: bytes):
        if not audio:
            raise ValueError("Cannot play empty audio data")
        try:
            pygame.mixer.music.load(BytesIO(audio), "mp3")
            pygame.mixer.music.play()
            while pygame.mixer.music.get_busy():
                time.sleep(0.05)
        except Exception as exc:
            logger.exception("MP3 playback failed")
            raise RuntimeError(f"Audio playback failed: {exc}") from exc

    def stop(self):
        pygame.mixer.music.stop()
