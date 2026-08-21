require('dotenv').config();

module.exports = {
  PORT: process.env.PORT || 3000,
  ELEVENLABS_API_KEY: process.env.ELEVENLABS_API_KEY,
  ELEVENLABS_VOICE_ID: process.env.ELEVENLABS_VOICE_ID,
  GEMINI_API_KEY: process.env.GEMINI_API_KEY,
};
