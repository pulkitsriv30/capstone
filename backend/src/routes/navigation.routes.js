const express = require('express');
const router = express.Router();
const multer = require('multer');
const navigationController = require('../controllers/navigation.controller');

const upload = multer({ dest: 'uploads/' });

// Object search workflow (Phase 7) requires both audio (voice query) and image (camera frame)
router.post('/search', upload.fields([
  { name: 'audio', maxCount: 1 },
  { name: 'image', maxCount: 1 }
]), navigationController.processNavigation);

// Environment description (Phase 12) only requires an image
router.post('/environment', upload.single('image'), navigationController.processEnvironment);

module.exports = router;
