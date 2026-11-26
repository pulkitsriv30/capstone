const express = require('express');
const router = express.Router();
const { upload } = require('../middleware/upload.middleware');
const voiceController = require('../controllers/voice.controller');

router.post('/transcribe', upload.single('audio'), voiceController.transcribe);
router.post('/speak', voiceController.speak);

module.exports = router;
