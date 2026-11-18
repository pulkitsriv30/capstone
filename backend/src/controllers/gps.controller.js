const gpsService = require('../services/gps.service');
const response = require('../utils/response');
const { NotFoundError } = require('../utils/errors');
const logger = require('../utils/logger');

const updateLocation = async (req, res, next) => {
  try {
    const { deviceId, latitude, longitude, accuracy, timestamp } = req.body;
    const location = gpsService.updateLocation(deviceId, {
      latitude,
      longitude,
      accuracy,
      timestamp,
    });

    return response.success(res, {
      message: 'Location updated',
      data: location,
    });
  } catch (error) {
    logger.error('GPS updateLocation Error', { error: error.message });
    next(error);
  }
};

const getLocation = async (req, res, next) => {
  try {
    const { deviceId } = req.params;
    const location = gpsService.getLocation(deviceId);

    if (!location) {
      throw new NotFoundError(`No location recorded for device: ${deviceId}`);
    }

    return response.success(res, {
      data: location,
    });
  } catch (error) {
    logger.error('GPS getLocation Error', { error: error.message });
    next(error);
  }
};

module.exports = {
  updateLocation,
  getLocation,
};

