const { PiClientError } = require('../../utils/errors');

class GpsUnavailableError extends PiClientError {
  constructor(message, cause = null) {
    super(message, 'GPS_UNAVAILABLE', cause);
  }
}

module.exports = {
  GpsUnavailableError,
};
