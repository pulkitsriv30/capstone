/**
 * Custom Error Classes for AI Assistive Navigation Backend
 */

class AppError extends Error {
  constructor(message, statusCode = 500, isOperational = true) {
    super(message);
    this.name = this.constructor.name;
    this.statusCode = statusCode;
    this.isOperational = isOperational;
    Error.captureStackTrace(this, this.constructor);
  }
}

class ValidationError extends AppError {
  constructor(message = 'Validation failed') {
    super(message, 400, true);
  }
}

class NotFoundError extends AppError {
  constructor(message = 'Resource not found') {
    super(message, 404, true);
  }
}

class ExternalServiceError extends AppError {
  constructor(serviceName, originalMessage, statusCode = 502) {
    super(`${serviceName} service error: ${originalMessage}`, statusCode, true);
    this.serviceName = serviceName;
  }
}

class TimeoutError extends AppError {
  constructor(serviceName = 'External service') {
    super(`${serviceName} request timed out`, 504, true);
  }
}

module.exports = {
  AppError,
  ValidationError,
  NotFoundError,
  ExternalServiceError,
  TimeoutError,
};

