/**
 * Typed Error Classes for Raspberry Pi & Camera Integration Client
 */

class PiClientError extends Error {
  constructor(message, code = 'PI_CLIENT_ERROR', cause = null) {
    super(message);
    this.name = this.constructor.name;
    this.code = code;
    if (cause) {
      this.cause = cause;
    }
    Error.captureStackTrace(this, this.constructor);
  }
}

class ConfigValidationError extends PiClientError {
  constructor(message) {
    super(message, 'CONFIG_VALIDATION_ERROR');
  }
}

class CameraUnavailableError extends PiClientError {
  constructor(message, cause = null) {
    super(message, 'CAMERA_UNAVAILABLE', cause);
  }
}

class CameraBusyError extends PiClientError {
  constructor(message = 'Camera capture already in progress') {
    super(message, 'CAMERA_BUSY');
  }
}

class CameraCaptureTimeoutError extends PiClientError {
  constructor(timeoutMs) {
    super(`Camera capture timed out after ${timeoutMs}ms`, 'CAMERA_TIMEOUT');
  }
}

class ImageValidationError extends PiClientError {
  constructor(message) {
    super(message, 'IMAGE_VALIDATION_ERROR');
  }
}

class BackendConnectionError extends PiClientError {
  constructor(message, statusCode = null, cause = null) {
    super(message, 'BACKEND_ERROR', cause);
    this.statusCode = statusCode;
  }
}

class AudioPlaybackError extends PiClientError {
  constructor(message, cause = null) {
    super(message, 'AUDIO_PLAYBACK_ERROR', cause);
  }
}

module.exports = {
  PiClientError,
  ConfigValidationError,
  CameraUnavailableError,
  CameraBusyError,
  CameraCaptureTimeoutError,
  ImageValidationError,
  BackendConnectionError,
  AudioPlaybackError,
};
