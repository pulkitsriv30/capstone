const test = require('node:test');
const assert = require('node:assert');
const env = require('../src/config/env');

const isPlaceholderKey = (key) => {
  if (!key) return true;
  return key.includes('your_') || key.includes('placeholder') || key.trim() === '';
};

test('Voice Speak Endpoint returns audio', { 
  skip: (!env.ELEVENLABS_API_KEY || isPlaceholderKey(env.ELEVENLABS_API_KEY)) 
    ? 'ELEVENLABS_API_KEY not configured with live key, skipping live external call test' 
    : false 
}, async (t) => {
  const app = require('../src/server');
  
  // Since we are using native node tests, we'll start the server and test it over HTTP
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
