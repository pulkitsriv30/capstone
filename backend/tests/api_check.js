const env = require('../src/config/env');

async function testElevenLabs() {
  console.log('Testing ElevenLabs...');
  const res = await fetch(`https://api.elevenlabs.io/v1/voices`, {
    headers: { 'xi-api-key': env.ELEVENLABS_API_KEY }
  });
  if (res.ok) {
    console.log('ElevenLabs API Key is VALID.');
  } else {
    console.error(`ElevenLabs check failed: ${res.status} ${await res.text()}`);
  }
}

async function testGemini() {
  console.log('Testing Gemini...');
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${env.GEMINI_API_KEY}`);
  if (res.ok) {
    console.log('Gemini API Key is VALID.');
  } else {
    console.error(`Gemini check failed: ${res.status} ${await res.text()}`);
  }
}

async function run() {
  await testElevenLabs();
  await testGemini();
}

run();
