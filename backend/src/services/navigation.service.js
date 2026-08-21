const logger = require('../utils/logger');

const MAX_SEARCH_ATTEMPTS = 6;

class NavigationService {
  constructor() {
    // In a real application, we might store this in a database or in-memory store like Redis.
    // For this prototype, we'll use a simple in-memory map keyed by session/user ID.
    this.sessions = new Map();
  }

  getSession(sessionId) {
    if (!this.sessions.has(sessionId)) {
      this.sessions.set(sessionId, { attempts: 0 });
    }
    return this.sessions.get(sessionId);
  }

  resetSession(sessionId) {
    this.sessions.delete(sessionId);
  }

  decideNextAction(sessionId, visionResult) {
    const session = this.getSession(sessionId);
    session.attempts += 1;

    if (visionResult.found) {
      this.resetSession(sessionId);
      return {
        status: 'found',
        response: visionResult.description || `Your ${visionResult.target} is located ${visionResult.location}.`
      };
    }

    if (session.attempts >= MAX_SEARCH_ATTEMPTS) {
      this.resetSession(sessionId);
      return {
        status: 'limit_reached',
        response: `I couldn't locate your ${visionResult.target}. Please try moving to another position.`
      };
    }

    // Target not found but we have attempts remaining.
    // Determine movement instruction.
    let instruction = visionResult.suggested_direction;
    if (!instruction) {
      // Default sweeping search pattern if vision AI doesn't suggest one
      if (session.attempts % 2 === 1) {
        instruction = "Please turn slightly left.";
      } else {
        instruction = "Please turn slightly right.";
      }
    } else {
      instruction = `Please turn ${instruction}.`;
    }

    return {
      status: 'searching',
      response: `I can't see your ${visionResult.target}. ${instruction}`
    };
  }

  describeEnvironment(visionResult) {
    // Phase 12 logic - return the description from vision result
    return {
      status: 'environment_described',
      response: visionResult.description || 'There is nothing of note nearby.'
    };
  }
}

module.exports = new NavigationService();
