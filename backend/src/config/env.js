try {
  require('dotenv').config();
} catch (_) {
  // Gracefully fallback to process.env if dotenv package is not yet installed
}

const config = {
  PORT: process.env.PORT || 3000,
  ELEVENLABS_API_KEY: process.env.ELEVENLABS_API_KEY,
  ELEVENLABS_VOICE_ID: process.env.ELEVENLABS_VOICE_ID,
  GEMINI_API_KEY: process.env.GEMINI_API_KEY,
  // Comma-separated list of allowed CORS origins (optional, defaults to localhost only)
  CORS_ORIGINS: process.env.CORS_ORIGINS || 'http://localhost:3000',
};

// Validate required environment variables at startup
// Fail fast with a clear message instead of cryptic runtime errors
const REQUIRED_VARS = ['GEMINI_API_KEY', 'ELEVENLABS_API_KEY', 'ELEVENLABS_VOICE_ID'];

const isTestEnv =
  process.env.NODE_ENV === 'test' ||
  process.env.NODE_TEST_CONTEXT !== undefined ||
  process.execArgv.includes('--test') ||
  process.argv.some((arg) => arg.includes('test'));

const missing = REQUIRED_VARS.filter((key) => !config[key]);
if (missing.length > 0) {
  if (!isTestEnv) {
    console.error(`\n❌ Missing required environment variables: ${missing.join(', ')}`);
    console.error('   Copy .env.example to .env and fill in your API keys.\n');
    process.exit(1);
  } else {
    console.warn(`\n⚠️ Missing environment variables in test environment: ${missing.join(', ')}`);
  }
}

module.exports = config;
