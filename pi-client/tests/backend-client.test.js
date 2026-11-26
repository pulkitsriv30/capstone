const test = require('node:test');
const assert = require('node:assert');
const BackendClient = require('../src/network/backend.client');
const { BackendConnectionError } = require('../src/utils/errors');

const createHeaders = (obj = {}) => {
  const map = new Map(Object.entries(obj).map(([k, v]) => [k.toLowerCase(), v]));
  return {
    get: (name) => map.get(name.toLowerCase()) ?? null,
  };
};

test('BackendClient - Health, Multipart Image Upload, Audio Response & Header Decoding', async () => {
  const fakeMp3 = Buffer.from('ID3-fake-mp3-audio-payload');
  const requests = [];

  const mockFetch = async (url, init) => {
    requests.push({ url, init });

    if (url.endsWith('/api/health')) {
      return {
        ok: true,
        status: 200,
        headers: createHeaders({ 'content-type': 'application/json' }),
        json: async () => ({ success: true, message: 'Backend is running' }),
      };
    }

    if (url.endsWith('/api/navigation/environment')) {
      // Verify FormData contains 'image' field with explicit image/jpeg MIME type
      assert.ok(init.body instanceof FormData);
      const imageEntry = init.body.get('image');
      assert.ok(imageEntry, 'FormData must include "image" field');
      assert.strictEqual(imageEntry.type, 'image/jpeg');
      assert.strictEqual(imageEntry.name, 'frame.jpg');

      return {
        ok: true,
        status: 200,
        headers: createHeaders({
          'content-type': 'audio/mpeg',
          'content-length': String(fakeMp3.length),
          'x-response-text': encodeURIComponent('A chair is 2 meters ahead.'),
          'x-navigation-status': 'environment_described',
        }),
        arrayBuffer: async () => fakeMp3.buffer.slice(fakeMp3.byteOffset, fakeMp3.byteOffset + fakeMp3.byteLength),
      };
    }

    throw new Error(`Unexpected URL: ${url}`);
  };

  const client = new BackendClient({
    baseUrl: 'http://192.168.1.45:3000///',
    timeoutMs: 5000,
    fetchImpl: mockFetch,
  });

  assert.strictEqual(client.baseUrl, 'http://192.168.1.45:3000');

  const health = await client.checkHealth();
  assert.strictEqual(health.success, true);

  const result = await client.describeEnvironment({
    buffer: Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]),
    mimeType: 'image/jpeg',
  });

  assert.strictEqual(result.audioAvailable, true);
  assert.strictEqual(result.status, 'environment_described');
  assert.strictEqual(result.textResponse, 'A chair is 2 meters ahead.');
  assert.ok(result.audioBuffer.equals(fakeMp3));
});

test('BackendClient - Handles JSON Fallback When ElevenLabs Fails', async () => {
  const client = new BackendClient({
    baseUrl: 'http://localhost:3000',
    timeoutMs: 5000,
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      headers: createHeaders({ 'content-type': 'application/json' }),
      json: async () => ({
        success: true,
        textResponse: 'Doorway on your left.',
        status: 'environment_described',
        audioAvailable: false,
      }),
    }),
  });

  const result = await client.describeEnvironment({
    buffer: Buffer.from([0xff, 0xd8, 0xff, 0xe0]),
    mimeType: 'image/jpeg',
  });

  assert.strictEqual(result.audioAvailable, false);
  assert.strictEqual(result.audioBuffer, null);
  assert.strictEqual(result.textResponse, 'Doorway on your left.');
  assert.strictEqual(result.status, 'environment_described');
});

test('BackendClient - SearchObject Sends Correct Multipart Fields, Propagates HTTP Errors & Handles Timeouts', async () => {
  // 1. Timeout simulation via AbortSignal
  const slowClient = new BackendClient({
    baseUrl: 'http://localhost:3000',
    timeoutMs: 40,
    fetchImpl: async (url, init) => {
      return new Promise((_, reject) => {
        init.signal.addEventListener('abort', () => {
          const err = new Error('The operation was aborted');
          err.name = 'AbortError';
          reject(err);
        });
      });
    },
  });

  await assert.rejects(
    () =>
      slowClient.describeEnvironment({
        buffer: Buffer.from([0xff, 0xd8, 0xff]),
        mimeType: 'image/jpeg',
      }),
    (err) => err instanceof BackendConnectionError && err.statusCode === 504
  );

  // 2. SearchObject FormData + HTTP 413 propagation
  let capturedFormData = null;
  const searchClient = new BackendClient({
    baseUrl: 'http://localhost:3000',
    timeoutMs: 2000,
    fetchImpl: async (url, init) => {
      capturedFormData = init.body;
      return {
        ok: false,
        status: 413,
        headers: createHeaders({ 'content-type': 'application/json' }),
        json: async () => ({ success: false, message: 'File too large' }),
      };
    },
  });

  await assert.rejects(
    () =>
      searchClient.searchObject(
        'sess-123',
        Buffer.from('fake-audio'),
        'audio/mp4',
        { buffer: Buffer.from([0xff, 0xd8, 0xff]), mimeType: 'image/jpeg' }
      ),
    (err) => err instanceof BackendConnectionError && err.statusCode === 413 && err.message.includes('File too large')
  );

  assert.strictEqual(capturedFormData.get('sessionId'), 'sess-123');
  assert.strictEqual(capturedFormData.get('audio').type, 'audio/mp4');
  assert.strictEqual(capturedFormData.get('image').type, 'image/jpeg');
});
