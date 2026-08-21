const express = require('express');
const router = express.Router();
const multer = require('multer');
const voiceController = require('../controllers/voice.controller');

// Use multer for file uploads. Store temporarily in memory or temp dir.
// Storing in a temp folder 'uploads/'
const upload = multer({ dest: 'uploads/' });

router.post('/transcribe', upload.single('audio'), voiceController.transcribe);
router.post('/speak', voiceController.speak);

module.exports = router;
