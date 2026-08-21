const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const app = require('../src/server');

test('Voice Speak Endpoint returns audio', async (t) => {
  const server = app.listen(0);
  const port = server.address().port;
  
  try {
    const response = await fetch(`http://localhost:${port}/api/voice/speak`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ text: "Hello, this is a test." })
    });
    
    assert.strictEqual(response.status, 200);
    const contentType = response.headers.get('content-type');
    assert.ok(contentType.includes('audio/mpeg'));
    
    const buffer = await response.arrayBuffer();
    assert.ok(buffer.byteLength > 1000); // verify audio data is present
    
  } finally {
    server.close();
  }
});
