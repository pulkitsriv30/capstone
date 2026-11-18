import cv2
from pathlib import Path


class Camera:
    def __init__(self, device_index: int, image_width: int, jpeg_quality: int):
        self.device_index = device_index
        self.image_width = image_width
        self.jpeg_quality = jpeg_quality

    def capture(self, output_path: Path) -> Path:
        camera = cv2.VideoCapture(self.device_index)
        try:
            if not camera.isOpened():
                raise RuntimeError(f"Unable to open camera device {self.device_index}")
            ok, frame = camera.read()
            if not ok or frame is None:
                raise RuntimeError("Camera did not return a frame")
            height, width = frame.shape[:2]
            if width > self.image_width:
                new_height = int(height * self.image_width / width)
                frame = cv2.resize(frame, (self.image_width, new_height))
            ok = cv2.imwrite(
                str(output_path), frame,
                [int(cv2.IMWRITE_JPEG_QUALITY), self.jpeg_quality],
            )
            if not ok:
                raise RuntimeError("Failed to save captured image")
            return output_path
        finally:
            camera.release()
