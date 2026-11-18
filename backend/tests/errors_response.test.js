const test = require('node:test');
const assert = require('node:assert');
const {
  AppError,
  ValidationError,
  NotFoundError,
  ExternalServiceError,
  TimeoutError,
} = require('../src/utils/errors');
const response = require('../src/utils/response');
const errorHandler = require('../src/middleware/error.middleware');

test('Errors Utility - Custom Error Classes', () => {
  const appErr = new AppError('Something bad', 500);
  assert.strictEqual(appErr.message, 'Something bad');
  assert.strictEqual(appErr.statusCode, 500);
  assert.strictEqual(appErr.isOperational, true);

  const valErr = new ValidationError('Invalid input');
  assert.strictEqual(valErr.statusCode, 400);
  assert.strictEqual(valErr.message, 'Invalid input');
  assert.strictEqual(valErr.isOperational, true);

  const notFound = new NotFoundError('Not found');
  assert.strictEqual(notFound.statusCode, 404);

  const extErr = new ExternalServiceError('Gemini', 'Rate limit exceeded', 502);
  assert.strictEqual(extErr.statusCode, 502);
  assert.strictEqual(extErr.serviceName, 'Gemini');
  assert.ok(extErr.message.includes('Rate limit exceeded'));

  const timeoutErr = new TimeoutError('ElevenLabs');
  assert.strictEqual(timeoutErr.statusCode, 504);
  assert.ok(timeoutErr.message.includes('timed out'));
});

test('Response Utility - Formatting & Headers', () => {
  // Mock response object
  const createMockRes = () => {
    const res = {
      statusCode: 200,
      headers: {},
      body: null,
      status(code) {
        this.statusCode = code;
        return this;
      },
      json(data) {
        this.body = data;
        return this;
      },
      set(key, val) {
        this.headers[key] = val;
        return this;
      },
      send(data) {
        this.body = data;
        return this;
      },
    };
    return res;
  };

  const res1 = createMockRes();
  response.success(res1, { userQuery: 'find keys', status: 'searching' });
  assert.strictEqual(res1.statusCode, 200);
  assert.strictEqual(res1.body.success, true);
  assert.strictEqual(res1.body.userQuery, 'find keys');

  const res2 = createMockRes();
  response.error(res2, 'Invalid sessionId', 400);
  assert.strictEqual(res2.statusCode, 400);
  assert.strictEqual(res2.body.success, false);
  assert.strictEqual(res2.body.message, 'Invalid sessionId');

  const res3 = createMockRes();
  const dummyBuffer = Buffer.from('audio-data');
  response.audio(res3, dummyBuffer, { 'X-Navigation-Status': 'found' });
  assert.strictEqual(res3.headers['Content-Type'], 'audio/mpeg');
  assert.strictEqual(res3.headers['Content-Length'], String(dummyBuffer.length));
  assert.strictEqual(res3.headers['X-Navigation-Status'], 'found');
  assert.strictEqual(res3.body, dummyBuffer);
});

test('Error Middleware - Sanitization and Status Handling', () => {
  const createMockRes = () => {
    const res = {
      statusCode: 200,
      body: null,
      status(code) {
        this.statusCode = code;
        return this;
      },
      json(data) {
        this.body = data;
        return this;
      },
    };
    return res;
  };

  const dummyReq = { path: '/test', method: 'POST' };

  // 1. AppError (operational error)
  const res1 = createMockRes();
  errorHandler(new ValidationError('sessionId is required'), dummyReq, res1, () => {});
  assert.strictEqual(res1.statusCode, 400);
  assert.strictEqual(res1.body.success, false);
  assert.strictEqual(res1.body.message, 'sessionId is required');

  // 2. Multer LIMIT_FILE_SIZE
  const res2 = createMockRes();
  const multerSizeErr = new Error('File too large');
  multerSizeErr.code = 'LIMIT_FILE_SIZE';
  errorHandler(multerSizeErr, dummyReq, res2, () => {});
  assert.strictEqual(res2.statusCode, 413);
  assert.strictEqual(res2.body.message, 'File too large. Maximum size is 5MB.');

  // 3. Raw internal error (must be sanitized to Internal Server Error)
  const res3 = createMockRes();
  const rawErr = new Error('Database connection failed at postgres://user:secret@internal-db:5432');
  errorHandler(rawErr, dummyReq, res3, () => {});
  assert.strictEqual(res3.statusCode, 500);
  assert.strictEqual(res3.body.message, 'Internal Server Error');
  assert.strictEqual(res3.body.success, false);
});

