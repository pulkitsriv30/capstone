const express = require('express');
const router = express.Router();
const { upload } = require('../middleware/upload.middleware');
const visionController = require('../controllers/vision.controller');

router.post('/analyze', upload.single('image'), visionController.analyze);

module.exports = router;
