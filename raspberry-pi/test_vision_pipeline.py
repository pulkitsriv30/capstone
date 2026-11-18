import tempfile
from pathlib import Path

from config.settings import settings
from services.backend_client import BackendClient
from voice.audio_playback import AudioPlayback
from voice.camera import Camera


def main():
    print("\n=== ASSISTIVE NAVIGATION: VISION PIPELINE TEST ===")

    backend = BackendClient(settings.backend_base_url)

    camera = Camera(
        settings.camera_index,
        settings.image_width,
        settings.image_jpeg_quality
    )

    playback = AudioPlayback()

    # 1. Capture image
    print("\n[1/4] Capturing camera image...")

    with tempfile.TemporaryDirectory() as temp_dir:
        image_path = Path(temp_dir) / "test.jpg"
        camera.capture(image_path)

        print("Image captured:", image_path.stat().st_size, "bytes")

        # 2. Send image to Gemini through existing backend
        print("\n[2/4] Sending image to backend...")
        print("Waiting for Gemini analysis...")

        result = backend.describe_environment(image_path)

        # 3. Process response
        print("\n[3/4] Processing response...")

        if result.get("audio"):
            print("Environmental description:", result.get("text"))
            audio = result["audio"]

        else:
            text = (
                result.get("textResponse")
                or result.get("message")
                or result.get("text")
            )

            if not text:
                raise RuntimeError(
                    f"No description returned: {result}"
                )

            print("Environmental description:", text)

            print("Generating speech through ElevenLabs...")
            audio = backend.speak(text)

        # 4. Play response
        print("\n[4/4] Playing response...")

        playback.play_mp3(audio)

    print("\nSUCCESS: Vision-to-speech pipeline completed.")


if __name__ == "__main__":
    main()