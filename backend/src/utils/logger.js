/**
 * Structured JSON Logger
 * Formats log lines with level, timestamp, message, and safely isolated context.
 */

const formatLog = (level, message, meta = {}) => {
  let contextData = {};
  let requestId = undefined;

  if (meta instanceof Error) {
    contextData = {
      errorName: meta.name,
      errorMessage: meta.message,
      stack: meta.stack,
    };
  } else if (typeof meta === 'object' && meta !== null) {
    // Prevent meta from overriding reserved root properties
    const { requestId: reqId, level: _l, timestamp: _t, message: _m, ...rest } = meta;
    if (reqId) {
      requestId = reqId;
    }
    contextData = rest;
  } else if (meta !== undefined && meta !== null) {
    contextData = { value: meta };
  }

  const logEntry = {
    level,
    timestamp: new Date().toISOString(),
    message: typeof message === 'string' ? message : String(message),
    ...(requestId ? { requestId } : {}),
    ...(Object.keys(contextData).length > 0 ? { context: contextData } : {}),
  };

  return JSON.stringify(logEntry);
};

const logger = {
  info: (message, meta) => {
    console.log(formatLog('info', message, meta));
  },
  warn: (message, meta) => {
    console.warn(formatLog('warn', message, meta));
  },
  error: (message, meta) => {
    console.error(formatLog('error', message, meta));
  },
  debug: (message, meta) => {
    console.debug(formatLog('debug', message, meta));
  },
  formatLog, // exported for unit testing
};

module.exports = logger;
