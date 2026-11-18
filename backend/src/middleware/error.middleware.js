const logger = require('../utils/logger');
const { AppError } = require('../utils/errors');
const response = require('../utils/response');

// Map of known error messages to safe, user-facing responses
const SAFE_MESSAGES = {
  'Image file is required': { status: 400, message: 'Image file is required' },
  'Audio file is required': { status: 400, message: 'Audio file is required' },
  'Text is required': { status: 400, message: 'Text is required' },
  'sessionId is required': { status: 400, message: 'sessionId is required' },
  'Both audio and image files are required': { status: 400, message: 'Both audio and image files are required' },
};

const errorHandler = (err, req, res, next) => {
  // Always log the full error server-side for auditing and debugging
  logger.error('Unhandled Error', {
    error: err.message,
    stack: err.stack,
    path: req.path,
    method: req.method,
  });

  // Check if error is an instance of our structured AppError
  if (err instanceof AppError || err.isOperational) {
    return response.error(res, err.message, err.statusCode || 500);
  }

  // Check if this is a known, safe-to-expose error message
  const knownError = SAFE_MESSAGES[err.message];
  if (knownError) {
    return response.error(res, knownError.message, knownError.status);
  }

  // Check for Multer file-size limit errors
  if (err.code === 'LIMIT_FILE_SIZE') {
    return response.error(res, 'File too large. Maximum size is 5MB.', 413);
  }

  // Check for Multer unexpected field errors
  if (err.code === 'LIMIT_UNEXPECTED_FILE') {
    return response.error(res, 'Unexpected file field.', 400);
  }

  // Handle malformed JSON body errors
  if (err instanceof SyntaxError && err.status === 400 && 'body' in err) {
    return response.error(res, 'Malformed JSON payload.', 400);
  }

  // For all unexpected errors: return a generic message to the client
  // NEVER expose raw err.message — it may contain API keys, internal URLs, or stack traces
  const statusCode = err.statusCode || 500;
  return response.error(
    res,
    statusCode === 500 ? 'Internal Server Error' : err.message,
    statusCode
  );
};

module.exports = errorHandler;
