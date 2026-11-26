const test = require('node:test');
const assert = require('node:assert');
const healthRoutes = require('../src/routes/health.routes');

test('Health Route - Diagnostics & Response Envelope', () => {
  // Mock request and response
  const req = {};
  let resStatus = null;
  let resJson = null;

  const res = {
    status(code) {
      resStatus = code;
      return this;
    },
    json(data) {
      resJson = data;
      return this;
    },
  };

  // Extract the GET / handler from the router stack
  const routeLayer = healthRoutes.stack.find((s) => s.route && s.route.path === '/');
  assert.ok(routeLayer, 'GET / route layer should exist');

  const handler = routeLayer.route.stack[0].handle;
  handler(req, res);

  assert.strictEqual(resStatus, 200);
  assert.strictEqual(resJson.success, true);
  assert.strictEqual(resJson.message, 'Backend is running');
  assert.strictEqual(typeof resJson.uptimeSeconds, 'number');
  assert.ok(resJson.uptimeSeconds >= 0);
  assert.strictEqual(typeof resJson.memory.heapUsedMB, 'number');
  assert.strictEqual(typeof resJson.services.geminiConfigured, 'boolean');
  assert.strictEqual(typeof resJson.services.elevenlabsConfigured, 'boolean');
});

