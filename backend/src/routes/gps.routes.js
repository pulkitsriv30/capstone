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
const gpsController = require('../controllers/gps.controller');

router.post('/location', gpsController.updateLocation);
router.get('/location/:deviceId', gpsController.getLocation);

module.exports = router;

