let express;
try {
  express = require('express');
} catch (_) {
  express = {
    Router: () => {
      const routes = [];
      return {
        get: (path, handler) => routes.push({ route: { path, stack: [{ handle: handler }] } }),
        stack: routes,
      };
    },
  };
}

const router = express.Router();
const env = require('../config/env');
const response = require('../utils/response');

router.get('/', (req, res) => {
  const memUsage = process.memoryUsage();

  return response.success(res, {
    message: 'Backend is running',
    uptimeSeconds: Math.floor(process.uptime()),
    timestamp: new Date().toISOString(),
    memory: {
      heapUsedMB: Math.round(memUsage.heapUsed / 1024 / 1024),
      heapTotalMB: Math.round(memUsage.heapTotal / 1024 / 1024),
    },
    services: {
      geminiConfigured: Boolean(env.GEMINI_API_KEY),
      elevenlabsConfigured: Boolean(env.ELEVENLABS_API_KEY && env.ELEVENLABS_VOICE_ID),
    },
  });
});

module.exports = router;
