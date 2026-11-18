import logging
import tempfile
from pathlib import Path

logger = logging.getLogger(__name__)


class CommandRouter:
    def __init__(self, backend, camera, playback):
        self.backend = backend
        self.camera = camera
        self.playback = playback
        self.last_response_text = ""
        self.last_response_audio = None

    def _speak(self, text: str):
        audio = self.backend.speak(text)
        self.last_response_text = text
        self.last_response_audio = audio
        self.playback.play_mp3(audio)

    def execute(self, command: str):
        normalized = command.lower().strip().rstrip(".!?")
        if not normalized:
            self._speak("I did not receive a command. Please try again.")
            return

        if normalized in {"stop", "stop speaking", "cancel"}:
            self.playback.stop()
            return
        if normalized in {"repeat", "repeat that", "say that again"}:
            if self.last_response_audio:
                self.playback.play_mp3(self.last_response_audio)
            else:
                self._speak("There is no previous response to repeat.")
            return

        # Handle non-visual commands before opening the camera.
        if normalized.startswith("navigate to "):
            self._speak("Navigation is not connected yet. The GPS module interface is pending integration.")
            return
        if normalized in {"emergency", "help", "send sos", "sos"}:
            self._speak("The emergency module is not connected yet. Please use the physical emergency control when available.")
            return

        is_environment = normalized in {
            "analyse", "analyze", "describe", "describe the environment",
            "what is in front of me", "look around",
        }
        is_object_search = (
            normalized.startswith(("find ", "where is ", "where are ", "locate "))
            or normalized.startswith("what is the location of ")
        )
        if not is_environment and not is_object_search:
            self._speak("I did not recognize that command. Please say analyse, find an object, navigate to a destination, or emergency.")
            return

        with tempfile.TemporaryDirectory(prefix="assistive-nav-") as temp_dir:
            image_path = Path(temp_dir) / "camera.jpg"
            self.camera.capture(image_path)
            if is_environment:
                result = self.backend.describe_environment(image_path)
                if result.get("audio"):
                    self.last_response_text = result.get("text", "")
                    self.last_response_audio = result["audio"]
                    self.playback.play_mp3(result["audio"])
                else:
                    text = result.get("textResponse") or result.get("message") or "I could not describe the environment."
                    self._speak(text)
                return

            result = self.backend.analyze_question(image_path, command)
            data = result.get("data", {})
            spoken = data.get("description") or "I could not identify the requested object."
            self._speak(spoken)
