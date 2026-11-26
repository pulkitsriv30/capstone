const express = require('express');
const router = express.Router();
const { upload } = require('../middleware/upload.middleware');
const navigationController = require('../controllers/navigation.controller');

// Object search workflow requires both audio (voice query) and image (camera frame)
router.post('/search', upload.fields([
  { name: 'audio', maxCount: 1 },
  { name: 'image', maxCount: 1 }
]), navigationController.processNavigation);

// Environment description only requires an image
router.post('/environment', upload.single('image'), navigationController.processEnvironment);

module.exports = router;
