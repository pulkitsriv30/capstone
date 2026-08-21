const express = require('express');
const router = express.Router();
const multer = require('multer');
const visionController = require('../controllers/vision.controller');

const upload = multer({ dest: 'uploads/' });

router.post('/analyze', upload.single('image'), visionController.analyze);

module.exports = router;
