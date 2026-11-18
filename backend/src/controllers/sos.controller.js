const sosService = require('../services/sos.service');
const response = require('../utils/response');
const logger = require('../utils/logger');

const activate = async (req, res, next) => {
  try {
    const { deviceId, latitude, longitude, accuracy, trigger, message, timestamp } = req.body;
    const result = sosService.activateSOS({
      deviceId,
      latitude,
      longitude,
      accuracy,
      trigger,
      message,
      timestamp,
    });

    return response.success(res, result, 201);
  } catch (error) {
    logger.error('SOS Activation Controller Error', { error: error.message });
    next(error);
  }
};

const getStatus = async (req, res, next) => {
  try {
    const { sosId } = req.params;
    const alert = sosService.getSOSStatus(sosId);

    return response.success(res, {
      data: alert,
    });
  } catch (error) {
    logger.error('SOS getStatus Controller Error', { error: error.message });
    next(error);
  }
};

const deactivate = async (req, res, next) => {
  try {
    const { sosId, deviceId } = req.body;
    const result = sosService.deactivateSOS(sosId, deviceId);

    return response.success(res, result);
  } catch (error) {
    logger.error('SOS deactivate Controller Error', { error: error.message });
    next(error);
  }
};

module.exports = {
  activate,
  getStatus,
  deactivate,
};

