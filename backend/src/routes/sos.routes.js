let express;
try {
  express = require('express');
} catch (_) {
  express = {
    Router: () => {
      const routes = [];
      return {
        post: (path, handler) => routes.push({ route: { path, stack: [{ handle: handler }] } }),
        get: (path, handler) => routes.push({ route: { path, stack: [{ handle: handler }] } }),
        stack: routes,
      };
    },
  };
}

const router = express.Router();
const sosController = require('../controllers/sos.controller');

router.post('/activate', sosController.activate);
router.get('/status/:sosId', sosController.getStatus);
router.post('/deactivate', sosController.deactivate);

module.exports = router;

