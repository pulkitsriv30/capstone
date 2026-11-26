const crypto = require('crypto');
const logger = require('../utils/logger');

const requestLogger = (req, res, next) => {
  // Use incoming X-Request-Id or generate a fresh UUID v4
  const requestId = req.headers['x-request-id'] || crypto.randomUUID();
  req.id = requestId;
  res.setHeader('X-Request-Id', requestId);

  const startTime = Date.now();

  res.on('finish', () => {
    const durationMs = Date.now() - startTime;
    const logData = {
      requestId,
      method: req.method,
      path: req.originalUrl || req.url,
      statusCode: res.statusCode,
      durationMs,
      ip: req.ip || (req.socket && req.socket.remoteAddress) || 'unknown',
    };

    const logSummary = `HTTP ${req.method} ${req.originalUrl || req.url} ${res.statusCode} (${durationMs}ms)`;

    if (res.statusCode >= 500) {
      logger.error(logSummary, logData);
    } else if (res.statusCode >= 400) {
      logger.warn(logSummary, logData);
    } else {
      logger.info(logSummary, logData);
    }
  });

  next();
};

module.exports = requestLogger;

