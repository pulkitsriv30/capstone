const visionService = require('../services/vision.service');
const logger = require('../utils/logger');
const response = require('../utils/response');

const analyze = async (req, res, next) => {
  try {
    if (!req.file) {
      return response.error(res, 'Image file is required', 400);
    }

    const { question } = req.body;
    if (question !== undefined && typeof question !== 'string') {
      return response.error(res, 'question must be a string', 400);
    }
    if (question && question.length > 1000) {
      return response.error(res, 'question must not exceed 1000 characters', 400);
    }

    const analysis = await visionService.analyzeImage(req.file, question);

    return response.success(res, {
      data: analysis,
    });
  } catch (error) {
    logger.error('Vision Analyze Error', { error: error.message });
    next(error);
  }
};

module.exports = {
  analyze,
};
