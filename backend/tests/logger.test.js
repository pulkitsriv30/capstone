const test = require('node:test');
const assert = require('node:assert');
const logger = require('../src/utils/logger');
const requestLogger = require('../src/middleware/request-logger.middleware');

test('Logger Utility - Structured JSON Formatting & Safety', () => {
  // Test basic log format
  const rawLog = logger.formatLog('info', 'Service started');
  const parsed = JSON.parse(rawLog);

  assert.strictEqual(parsed.level, 'info');
  assert.strictEqual(parsed.message, 'Service started');
  assert.ok(parsed.timestamp);

  // Test that meta cannot overwrite level or timestamp
  const hostileLog = logger.formatLog('info', 'Attempted override', {
    level: 'CRITICAL_OVERWRITE',
    timestamp: '1970-01-01',
    userQuery: 'find bottle',
  });
  const parsedHostile = JSON.parse(hostileLog);

  assert.strictEqual(parsedHostile.level, 'info');
  assert.notStrictEqual(parsedHostile.timestamp, '1970-01-01');
  assert.strictEqual(parsedHostile.context.userQuery, 'find bottle');

  // Test requestId extraction
  const reqLog = logger.formatLog('info', 'Step completed', {
    requestId: 'req-uuid-1234',
    step: 'stt',
  });
  const parsedReq = JSON.parse(reqLog);
  assert.strictEqual(parsedReq.requestId, 'req-uuid-1234');
  assert.strictEqual(parsedReq.context.step, 'stt');

  // Test Error object serialization
  const errLog = logger.formatLog('error', 'Operation failed', new Error('Disk full'));
  const parsedErr = JSON.parse(errLog);
  assert.strictEqual(parsedErr.level, 'error');
  assert.strictEqual(parsedErr.context.errorMessage, 'Disk full');
  assert.ok(parsedErr.context.stack);
});

test('Request Logger Middleware - RequestId & Header Handling', () => {
  const mockReq = {
    method: 'GET',
    url: '/api/health',
    headers: {},
  };

  const headersSet = {};
  const mockRes = {
    setHeader(key, val) {
      headersSet[key] = val;
    },
    on(event, handler) {
      // Mock event listener
    },
  };

  let nextCalled = false;
  requestLogger(mockReq, mockRes, () => {
    nextCalled = true;
  });

  assert.strictEqual(nextCalled, true);
  assert.ok(mockReq.id);
  assert.strictEqual(headersSet['X-Request-Id'], mockReq.id);

  // Test preserving incoming X-Request-Id
  const customReq = {
    method: 'POST',
    url: '/api/navigation/search',
    headers: { 'x-request-id': 'client-trace-abc' },
  };
  const customRes = {
    setHeader(key, val) {
      headersSet[key] = val;
    },
    on() {},
  };

  requestLogger(customReq, customRes, () => {});
  assert.strictEqual(customReq.id, 'client-trace-abc');
  assert.strictEqual(headersSet['X-Request-Id'], 'client-trace-abc');
});

