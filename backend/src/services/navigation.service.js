const logger = require('../utils/logger');

const MAX_SEARCH_ATTEMPTS = 6;
const SESSION_TTL_MS = 10 * 60 * 1000; // 10 minutes session TTL

class NavigationService {
  constructor() {
    this.sessions = new Map();
  }

  // Prune sessions older than SESSION_TTL_MS to prevent unbounded memory growth
  pruneExpiredSessions() {
    const now = Date.now();
    for (const [sessionId, session] of this.sessions.entries()) {
      if (now - session.lastAccessedAt > SESSION_TTL_MS) {
        this.sessions.delete(sessionId);
      }
    }
  }

  getSession(sessionId) {
    this.pruneExpiredSessions();

    if (!this.sessions.has(sessionId)) {
      this.sessions.set(sessionId, {
        attempts: 0,
        createdAt: Date.now(),
        lastAccessedAt: Date.now(),
      });
    } else {
      const session = this.sessions.get(sessionId);
      session.lastAccessedAt = Date.now();
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
      const target = visionResult.target || 'target';
      const isPlural = /s$/i.test(target);
      const verb = isPlural ? 'are' : 'is';
      const fallbackResponse = `Your ${target} ${verb} located ${visionResult.location || 'nearby'}.`;

      return {
        status: 'found',
        response: visionResult.description || fallbackResponse,
      };
    }

    if (session.attempts >= MAX_SEARCH_ATTEMPTS) {
      this.resetSession(sessionId);
      return {
        status: 'limit_reached',
        response: `I couldn't locate your ${visionResult.target || 'item'}. Please try moving to another position.`,
      };
    }

    // Target not found but we have attempts remaining.
    // Determine movement instruction.
    let instruction = visionResult.suggested_direction;
    if (!instruction) {
      // Default sweeping search pattern if vision AI doesn't suggest one
      if (session.attempts % 2 === 1) {
        instruction = 'Please turn slightly left.';
      } else {
        instruction = 'Please turn slightly right.';
      }
    } else {
      instruction = `Please turn ${instruction}.`;
    }

    return {
      status: 'searching',
      response: `I can't see your ${visionResult.target || 'item'}. ${instruction}`,
    };
  }

  describeEnvironment(visionResult) {
    return {
      status: 'environment_described',
      response: visionResult.description || 'There is nothing of note nearby.',
    };
  }
}

module.exports = new NavigationService();
