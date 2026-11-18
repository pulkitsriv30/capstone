import time
import numpy as np
import sounddevice as sd


class AudioCapture:
    def __init__(self, sample_rate: int, input_device=None, rms_threshold: float = 350):
        self.sample_rate = sample_rate
        self.input_device = input_device
        self.rms_threshold = rms_threshold

    def listen_for_wake_word(self):
        """Yield mono int16 microphone frames for local wake-word inference."""
        blocksize = 1280  # 80 ms at 16 kHz
        with sd.InputStream(
            samplerate=self.sample_rate, channels=1, dtype="int16",
            blocksize=blocksize, device=self.input_device,
        ) as stream:
            while True:
                frame, overflowed = stream.read(blocksize)
                if not overflowed:
                    yield np.asarray(frame, dtype=np.int16).reshape(-1)

    def record_command(
        self, max_seconds: int, end_silence_seconds: float,
        initial_silence_seconds: float = 2.0,
    ) -> bytes:
        """Record speech; return empty bytes if no command follows the wake word."""
        frames = []
        blocksize = 1024
        silence_seconds = 0.0
        started = time.monotonic()
        speech_seen = False
        with sd.InputStream(
            samplerate=self.sample_rate, channels=1, dtype="int16",
            blocksize=blocksize, device=self.input_device,
        ) as stream:
            while time.monotonic() - started < max_seconds:
                frame, overflowed = stream.read(blocksize)
                if overflowed:
                    continue
                audio = np.asarray(frame, dtype=np.int16).reshape(-1)
                frames.append(audio)
                rms = float(np.sqrt(np.mean(audio.astype(np.float32) ** 2)))
                if rms >= self.rms_threshold:
                    speech_seen = True
                    silence_seconds = 0.0
                elif speech_seen:
                    silence_seconds += len(audio) / self.sample_rate
                    if silence_seconds >= end_silence_seconds:
                        break
                elif time.monotonic() - started >= initial_silence_seconds:
                    break
        if not frames or not speech_seen:
            return b""
        return np.concatenate(frames).astype(np.int16).tobytes()
