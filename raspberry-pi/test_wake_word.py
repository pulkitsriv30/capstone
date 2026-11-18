import logging

from config.settings import settings
from voice.audio_capture import AudioCapture
from voice.wake_word import WakeWordDetector

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s: %(message)s"
)

def main():
    print("\n=== HEY MYCROFT WAKE WORD TEST ===")

    detector = WakeWordDetector(
        settings.wake_word_model,
        settings.wake_word_threshold
    )

    audio = AudioCapture(
        settings.sample_rate,
        settings.input_device,
        settings.command_rms_threshold
    )

    print("\nModel:", detector.model_name)
    print("Threshold:", detector.threshold)
    print("Microphone:", settings.input_device)
    print("\nListening... Say 'Hey Mycroft'")
    print("Press CTRL+C to stop.\n")

    try:
        frame_count = 0

        for frame in audio.listen_for_wake_word():
            scores = detector.model.predict(frame)
            score = float(
                scores.get(detector.model_name, 0.0)
            )

            frame_count += 1

            if frame_count % 10 == 0:
                print(
                    f"\rWake confidence: {score:.4f}",
                    end="",
                    flush=True
                )

            if score >= detector.threshold:
                print(
                    f"\n\nWAKE WORD DETECTED!"
                    f"\nConfidence: {score:.4f}\n"
                )

                detector.model.reset()
                frame_count = 0

    except KeyboardInterrupt:
        print("\n\nWake-word test stopped.")

if __name__ == "__main__":
    main()