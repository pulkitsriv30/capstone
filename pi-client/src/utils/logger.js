/**
 * Structured JSON Logger (consistent with backend/src/utils/logger.js)
 */

const formatLog = (level, message, meta = {}) => {
  let contextData = {};

  if (meta instanceof Error) {
    contextData = {
      errorName: meta.name,
      errorCode: meta.code,
      errorMessage: meta.message,
      stack: meta.stack,
    };
  } else if (typeof meta === 'object' && meta !== null) {
    const { level: _l, timestamp: _t, message: _m, ...rest } = meta;
    contextData = rest;
  } else if (meta !== undefined && meta !== null) {
    contextData = { value: meta };
  }

  const logEntry = {
    level,
    timestamp: new Date().toISOString(),
    message: typeof message === 'string' ? message : String(message),
    ...(Object.keys(contextData).length > 0 ? { context: contextData } : {}),
  };

  return JSON.stringify(logEntry);
};

const logger = {
  info: (message, meta) => console.log(formatLog('info', message, meta)),
  warn: (message, meta) => console.warn(formatLog('warn', message, meta)),
  error: (message, meta) => console.error(formatLog('error', message, meta)),
  debug: (message, meta) => console.debug(formatLog('debug', message, meta)),
  formatLog,
};

module.exports = logger;
