/**
 * Standardized API Response Helpers
 * Ensures consistent response shapes and header conventions across all endpoints.
 */

const success = (res, data = {}, statusCode = 200) => {
  return res.status(statusCode).json({
    success: true,
    ...data,
  });
};

const error = (res, message = 'Internal Server Error', statusCode = 500) => {
  return res.status(statusCode).json({
    success: false,
    message,
  });
};

const audio = (res, audioBuffer, headers = {}) => {
  res.set('Content-Type', 'audio/mpeg');

  // Explicit Content-Length ensures mobile MediaPlayer and clients do not stall on chunked transfers
  if (Buffer.isBuffer(audioBuffer)) {
    res.set('Content-Length', String(audioBuffer.length));
  } else if (audioBuffer && audioBuffer.byteLength !== undefined) {
    res.set('Content-Length', String(audioBuffer.byteLength));
  }

  for (const [key, value] of Object.entries(headers)) {
    if (value !== undefined && value !== null) {
      res.set(key, String(value));
    }
  }
  return res.send(audioBuffer);
};

module.exports = {
  success,
  error,
  audio,
};

