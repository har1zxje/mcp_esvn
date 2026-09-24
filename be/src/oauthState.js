import crypto from 'node:crypto';

export class OAuthStateStore {
  constructor({ ttlMs = 10 * 60 * 1000 } = {}) {
    this.ttlMs = ttlMs;
    this.states = new Map();
  }

  create({ userId, provider, returnTo }) {
    const state = crypto.randomBytes(32).toString('base64url');
    this.states.set(state, { userId: String(userId), provider, returnTo, expiresAt: Date.now() + this.ttlMs });
    return state;
  }

  consume(state, provider) {
    const pending = this.states.get(state);
    this.states.delete(state);
    if (!pending || pending.provider !== provider || pending.expiresAt <= Date.now()) return null;
    return pending;
  }
}

