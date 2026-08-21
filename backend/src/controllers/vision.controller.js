const visionService = require('../services/vision.service');
const logger = require('../utils/logger');

const analyze = async (req, res, next) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, message: 'Image file is required' });
    }

    const { question } = req.body;
    
    const analysis = await visionService.analyzeImage(req.file, question);
    
    res.json({
      success: true,
      data: analysis
    });
  } catch (error) {
    logger.error('Vision Analyze Error', { error: error.message });
    next(error);
  }
};

module.exports = {
  analyze
};
