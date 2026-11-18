const { ValidationError, NotFoundError } = require('../utils/errors');
const logger = require('../utils/logger');

class GPSService {
  constructor() {
    // In-memory store: deviceId -> location object
    this.deviceLocations = new Map();
  }

  updateLocation(deviceId, { latitude, longitude, accuracy, timestamp }) {
    if (!deviceId || typeof deviceId !== 'string' || !deviceId.trim()) {
      throw new ValidationError('deviceId is required');
    }

    const lat = Number(latitude);
    const lon = Number(longitude);

    if (isNaN(lat) || lat < -90 || lat > 90) {
      throw new ValidationError('latitude must be a number between -90 and 90');
    }

    if (isNaN(lon) || lon < -180 || lon > 180) {
      throw new ValidationError('longitude must be a number between -180 and 180');
    }

    const locationRecord = {
      latitude: lat,
      longitude: lon,
      accuracy: accuracy !== undefined ? Number(accuracy) : null,
      timestamp: timestamp || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    this.deviceLocations.set(deviceId.trim(), locationRecord);
    logger.info('GPS Location Updated', { deviceId: deviceId.trim(), latitude: lat, longitude: lon });

    return locationRecord;
  }

  getLocation(deviceId) {
    if (!deviceId || typeof deviceId !== 'string' || !deviceId.trim()) {
      throw new ValidationError('deviceId is required');
    }

    const location = this.deviceLocations.get(deviceId.trim());
    if (!location) {
      return null;
    }

    return location;
  }

  clear() {
    this.deviceLocations.clear();
  }
}

module.exports = new GPSService();

