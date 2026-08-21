const test = require('node:test');
const assert = require('node:assert');

test('Health endpoint returns success', async (t) => {
  const app = require('../src/server');
  
  // Since we are using native node tests, we'll start the server and test it over HTTP
  const server = app.listen(0);
  const port = server.address().port;
  
  try {
    const response = await fetch(`http://localhost:${port}/api/health`);
    const data = await response.json();
    
    assert.strictEqual(response.status, 200);
    assert.strictEqual(data.success, true);
    assert.strictEqual(data.message, 'Backend is running');
  } finally {
    server.close();
  }
});
