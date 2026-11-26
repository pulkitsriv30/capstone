const path = require('path');
const { ValidationError } = require('../utils/errors');

let multer;
try {
  multer = require('multer');
} catch (_) {
  // Fallback mock when running in dependency-free test environments
  multer = () => ({
    fields: () => (req, res, next) => next(),
    single: () => (req, res, next) => next(),
  });
}

const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5 MB

const ALLOWED_IMAGE_MIMES = new Set([
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp',
]);

const ALLOWED_AUDIO_MIMES = new Set([
  'audio/mp4',
  'audio/m4a',
  'audio/mpeg',
  'audio/mp3',
  'audio/wav',
  'audio/x-wav',
  'audio/aac',
  'audio/ogg',
  'audio/webm',
]);

const uploadDir = path.resolve(__dirname, '../../uploads');

const fileFilter = (req, file, cb) => {
  if (file.fieldname === 'image') {
    if (ALLOWED_IMAGE_MIMES.has((file.mimetype || '').toLowerCase())) {
      return cb(null, true);
    }
    return cb(
      new ValidationError(
        `Unsupported image format: ${file.mimetype}. Allowed formats: JPEG, PNG, WebP`
      ),
      false
    );
  }

  if (file.fieldname === 'audio') {
    if (ALLOWED_AUDIO_MIMES.has((file.mimetype || '').toLowerCase())) {
      return cb(null, true);
    }
    return cb(
      new ValidationError(
        `Unsupported audio format: ${file.mimetype}. Allowed formats: MP4, M4A, MPEG, WAV, AAC, WebM`
      ),
      false
    );
  }

  cb(null, true);
};

const upload = multer({
  dest: uploadDir,
  limits: {
    fileSize: MAX_FILE_SIZE,
  },
  fileFilter,
});

module.exports = {
  upload,
  MAX_FILE_SIZE,
  ALLOWED_IMAGE_MIMES,
  ALLOWED_AUDIO_MIMES,
};

