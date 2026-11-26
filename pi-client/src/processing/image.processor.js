const logger = require('../utils/logger');
const { ImageValidationError } = require('../utils/errors');

let sharp;
try {
  sharp = require('sharp');
} catch (_) {
  sharp = null;
}

const MAX_UPLOAD_BYTES = 5 * 1024 * 1024; // Must stay within backend 5MB upload limit
const MIN_RAW_BYTES = 100;
const LOW_LIGHT_LUMA_THRESHOLD = 8;

const isValidJpegBuffer = (buffer) => {
  return (
    Buffer.isBuffer(buffer) &&
    buffer.length >= 4 &&
    buffer[0] === 0xff &&
    buffer[1] === 0xd8 &&
    buffer[2] === 0xff
  );
};

class ImageProcessor {
  /**
   * Optimizes and validates a raw camera frame buffer into a backend-ready JPEG.
   * Performs EXIF auto-rotation, max-width downscaling, JPEG compression, and sanity checks.
   */
  async processFrame(rawBuffer, options = {}) {
    if (!sharp) {
      throw new ImageValidationError('sharp dependency is not installed. Run "npm install" inside pi-client.');
    }

    if (!Buffer.isBuffer(rawBuffer) || rawBuffer.length < MIN_RAW_BYTES) {
      throw new ImageValidationError(
        `Captured image buffer is empty or corrupt (${rawBuffer ? rawBuffer.length : 0} bytes)`
      );
    }

    const maxWidth = options.maxWidth || 800;
    const quality = options.quality || 75;

    try {
      let { data, info } = await sharp(rawBuffer)
        .rotate()
        .resize({ width: maxWidth, withoutEnlargement: true })
        .jpeg({ quality })
        .toBuffer({ resolveWithObject: true });

      // If image still exceeds backend 5MB cap, re-compress aggressively
      if (data.length > MAX_UPLOAD_BYTES) {
        logger.warn('Processed frame exceeded 5MB limit, re-compressing at quality 50', {
          sizeBytes: data.length,
        });
        ({ data, info } = await sharp(data).jpeg({ quality: 50 }).toBuffer({ resolveWithObject: true }));
      }

      if (data.length > MAX_UPLOAD_BYTES) {
        throw new ImageValidationError(
          `Image size (${data.length} bytes) still exceeds 5MB limit after compression`
        );
      }

      if (!isValidJpegBuffer(data)) {
        throw new ImageValidationError('Processed buffer failed JPEG magic-byte validation');
      }

      // Compute mean luma across RGB channels to flag severe underexposure / blocked lens
      const stats = await sharp(data).stats();
      const channelMeans = stats.channels.slice(0, 3).map((ch) => ch.mean);
      const meanLuma =
        channelMeans.length > 0
          ? Math.round(channelMeans.reduce((sum, val) => sum + val, 0) / channelMeans.length)
          : 0;

      if (meanLuma < LOW_LIGHT_LUMA_THRESHOLD) {
        logger.warn('Captured frame is extremely dark — check lighting or lens obstruction', {
          meanLuma,
          width: info.width,
          height: info.height,
        });
      }

      return {
        buffer: data,
        mimeType: 'image/jpeg',
        width: info.width,
        height: info.height,
        sizeBytes: data.length,
        meanLuma,
      };
    } catch (error) {
      if (error instanceof ImageValidationError) {
        throw error;
      }
      throw new ImageValidationError(`Failed to process captured image: ${error.message}`);
    }
  }
}

module.exports = new ImageProcessor();
module.exports.ImageProcessor = ImageProcessor;
module.exports.isValidJpegBuffer = isValidJpegBuffer;
module.exports.MAX_UPLOAD_BYTES = MAX_UPLOAD_BYTES;
module.exports.LOW_LIGHT_LUMA_THRESHOLD = LOW_LIGHT_LUMA_THRESHOLD;
