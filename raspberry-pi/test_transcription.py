import tempfile
from pathlib import Path

import numpy as np
import soundfile as sf

from config.settings import settings
from services.backend_client import BackendClient
from voice.audio_capture import AudioCapture


def main():
    print("\n=== MICROPHONE TO SPEECH-TO-TEXT TEST ===\n")

    backend = BackendClient(settings.backend_base_url)

    microphone = AudioCapture(
        sample_rate=settings.sample_rate,
        input_device=settings.input_device,
        rms_threshold=settings.command_rms_threshold,
    )

    print("Microphone initialized.")
    print("Speak clearly when recording begins.")
    input("Press ENTER to start recording...")

    print("\nRecording...")
    
    audio_bytes = microphone.record_command(
        max_seconds=settings.command_max_seconds,
        end_silence_seconds=settings.command_end_silence_seconds,
        initial_silence_seconds=settings.command_initial_silence_seconds,
    )

    if not audio_bytes:
        print("ERROR: No speech detected.")
        return

    print(f"Captured {len(audio_bytes)} bytes of audio.")

    audio_array = np.frombuffer(audio_bytes, dtype=np.int16)

    with tempfile.TemporaryDirectory(prefix="transcription-test-") as temp_dir:
        audio_path = Path(temp_dir) / "command.wav"

        sf.write(
            str(audio_path),
            audio_array,
            settings.sample_rate,
            subtype="PCM_16",
            format="WAV",
        )

        print("\nWAV file generated.")
        print(f"Duration: {len(audio_array) / settings.sample_rate:.2f} seconds")

        print("\nSending audio to backend...")
        print("Waiting for ElevenLabs transcription...")

        try:
            transcription = backend.transcribe(audio_path)

            print("\n=== TRANSCRIPTION RESULT ===")
            print(transcription)
            print("\nSUCCESS: Microphone-to-transcription pipeline completed.")

        except Exception as error:
            print("\nTRANSCRIPTION FAILED:")
            print(str(error))


if __name__ == "__main__":
    main()