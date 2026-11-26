const env = require('../config/env');
const logger = require('../utils/logger');
const { BackendConnectionError } = require('../utils/errors');

const safeDecodeHeader = (value) => {
  if (!value) return '';
  try {
    return decodeURIComponent(value);
  } catch (_) {
    return value;
  }
};

class BackendClient {
  constructor(options = {}) {
    this.baseUrl = (options.baseUrl || env.BACKEND_URL).replace(/\/+$/, '');
    this.timeoutMs = options.timeoutMs || env.REQUEST_TIMEOUT_MS;
    this.fetchImpl = options.fetchImpl || fetch;
  }

  async _fetchWithTimeout(url, options = {}, timeoutOverrideMs = null) {
    const timeout = timeoutOverrideMs || this.timeoutMs;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);

    try {
      return await this.fetchImpl(url, {
        ...options,
        signal: controller.signal,
      });
    } catch (error) {
      if (error.name === 'AbortError') {
        throw new BackendConnectionError(`Backend request timed out after ${timeout}ms`, 504, error);
      }
      throw new BackendConnectionError(
        `Failed to reach backend at ${this.baseUrl}: ${error.message}`,
        null,
        error
      );
    } finally {
      clearTimeout(timer);
    }
  }

  async checkHealth() {
    const response = await this._fetchWithTimeout(`${this.baseUrl}/api/health`, { method: 'GET' }, 5000);
    if (!response.ok) {
      throw new BackendConnectionError(`Health check failed with HTTP ${response.status}`, response.status);
    }
    return response.json();
  }

  /**
   * Uploads a captured JPEG frame to POST /api/navigation/environment.
   * Handles both binary audio/mpeg responses and JSON fallback responses.
   */
  async describeEnvironment(imageResult) {
    if (!imageResult || !Buffer.isBuffer(imageResult.buffer)) {
      throw new BackendConnectionError('Valid processed image buffer is required');
    }

    const formData = new FormData();
    const mimeType = imageResult.mimeType || 'image/jpeg';
    const imageBlob = new Blob([imageResult.buffer], { type: mimeType });
    formData.append('image', imageBlob, 'frame.jpg');

    const response = await this._fetchWithTimeout(`${this.baseUrl}/api/navigation/environment`, {
      method: 'POST',
      body: formData,
    });

    return this._parseNavigationResponse(response);
  }

  /**
   * Uploads sessionId + voice recording + camera frame to POST /api/navigation/search.
   * Ready for integration with Nipun's voice activation module.
   */
  async searchObject(sessionId, audioBuffer, audioMime, imageResult) {
    if (!sessionId || typeof sessionId !== 'string' || !sessionId.trim()) {
      throw new BackendConnectionError('sessionId is required for object search');
    }
    if (!Buffer.isBuffer(audioBuffer) || audioBuffer.length === 0) {
      throw new BackendConnectionError('Valid audio buffer is required for object search');
    }
    if (!imageResult || !Buffer.isBuffer(imageResult.buffer)) {
      throw new BackendConnectionError('Valid processed image buffer is required');
    }

    const formData = new FormData();
    formData.append('sessionId', sessionId.trim());
    formData.append('audio', new Blob([audioBuffer], { type: audioMime || 'audio/mp4' }), 'query.m4a');
    formData.append(
      'image',
      new Blob([imageResult.buffer], { type: imageResult.mimeType || 'image/jpeg' }),
      'frame.jpg'
    );

    const response = await this._fetchWithTimeout(`${this.baseUrl}/api/navigation/search`, {
      method: 'POST',
      body: formData,
    });

    return this._parseNavigationResponse(response);
  }

  async _parseNavigationResponse(response) {
    if (!response.ok) {
      let errMsg = `HTTP ${response.status}`;
      try {
        const errBody = await response.json();
        if (errBody && errBody.message) {
          errMsg = `HTTP ${response.status}: ${errBody.message}`;
        }
      } catch (_) {
        const text = await response.text().catch(() => '');
        if (text) errMsg = `HTTP ${response.status}: ${text}`;
      }
      throw new BackendConnectionError(errMsg, response.status);
    }

    const contentType = (response.headers.get('content-type') || '').toLowerCase();

    if (contentType.includes('audio')) {
      const arrayBuffer = await response.arrayBuffer();
      const audioBuffer = Buffer.from(arrayBuffer);
      const textResponse = safeDecodeHeader(response.headers.get('x-response-text'));
      const userQuery = safeDecodeHeader(response.headers.get('x-user-query'));
      const status = response.headers.get('x-navigation-status') || 'unknown';

      logger.info('Received audio response from backend', {
        status,
        audioBytes: audioBuffer.length,
        hasTextHeader: Boolean(textResponse),
      });

      return {
        audioAvailable: true,
        audioBuffer,
        textResponse,
        userQuery: userQuery || null,
        status,
      };
    }

    // Fallback: ElevenLabs failed/rate-limited on backend, returned JSON textResponse
    const json = await response.json();
    logger.info('Received text-only JSON fallback from backend', {
      status: json.status,
      audioAvailable: json.audioAvailable,
    });

    return {
      audioAvailable: false,
      audioBuffer: null,
      textResponse: json.textResponse || '',
      userQuery: json.userQuery || null,
      status: json.status || 'unknown',
    };
  }
}

module.exports = BackendClient;
module.exports.safeDecodeHeader = safeDecodeHeader;
