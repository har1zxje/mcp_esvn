import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import bcrypt from 'bcryptjs';

const SCHEMA_VERSION = 1;
function hashToken(token) { return crypto.createHash('sha256').update(token).digest('hex'); }
function safeUser(user) { return user ? { id: user.id, email: user.email, name: user.name, avatar: user.avatar } : null; }
export const normalizeEmail = (email) => String(email ?? '').trim().toLowerCase();
export function validateCredentials(email, password) {
  const normalizedEmail = normalizeEmail(email);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail) || normalizedEmail.length > 254) throw Object.assign(new Error('Invalid credentials'), { code: 'AUTH_INPUT_INVALID', statusCode: 400 });
  if (typeof password !== 'string' || password.length < 8 || password.length > 128) throw Object.assign(new Error('Invalid credentials'), { code: 'AUTH_INPUT_INVALID', statusCode: 400 });
  return normalizedEmail;
}

export class ApplicationAuthService {
  constructor({ userRepository, sessionRepository, filePath, sessionTtlMs = 7 * 24 * 60 * 60 * 1000 } = {}) {
    this.userRepository = userRepository; this.sessionRepository = sessionRepository; this.filePath = filePath; this.sessionTtlMs = sessionTtlMs; this.writeQueue = Promise.resolve();
    if (!this.userRepository && !this.filePath) throw new Error('ApplicationAuthService requires PostgreSQL repositories');
  }
  async readStore() { const store = JSON.parse(await fs.readFile(this.filePath, 'utf8')); if (store?.schemaVersion !== SCHEMA_VERSION || !Array.isArray(store.users) || !Array.isArray(store.sessions)) throw new Error('Invalid application auth store'); return store; }
  async writeStore(store) { await fs.mkdir(path.dirname(this.filePath), { recursive: true }); const temporaryPath = `${this.filePath}.${process.pid}.tmp`; await fs.writeFile(temporaryPath, JSON.stringify(store, null, 2), { encoding: 'utf8', mode: 0o600 }); await fs.rename(temporaryPath, this.filePath); }
  async updateStore(mutator) { const operation = this.writeQueue.then(async () => { let store; try { store = await this.readStore(); } catch (error) { if (error.code === 'ENOENT') store = { schemaVersion: SCHEMA_VERSION, users: [], sessions: [] }; else throw error; } const result = await mutator(store); await this.writeStore(store); return result; }); this.writeQueue = operation.catch(() => {}); return operation; }
  async findOrCreateGoogleUser({ providerUserId, email, name, avatar }) {
    if (!providerUserId || !email) throw new Error('Verified Google identity is incomplete');
    const normalizedEmail = normalizeEmail(email);
    if (this.userRepository) {
      const existing = await this.userRepository.findByGoogleSub(providerUserId);
      if (existing) return this.userRepository.updateUser(existing.id, { email: normalizedEmail, name: name || existing.name, avatar: avatar || existing.avatar });
      const byEmail = await this.userRepository.findByEmail(normalizedEmail);
      if (byEmail) {
        if (byEmail.googleSub && byEmail.googleSub !== String(providerUserId)) throw Object.assign(new Error('Google account conflict'), { code: 'AUTH_PROVIDER_CONFLICT' });
        return this.userRepository.linkGoogleSub(byEmail.id, providerUserId);
      }
      return this.userRepository.createUser({ id: crypto.randomUUID(), googleSub: String(providerUserId), email: normalizedEmail, name: name || normalizedEmail, avatar: avatar || null });
    }
    return this.updateStore(async (store) => { let user = store.users.find((item) => (item.providerUserId === String(providerUserId)) || normalizeEmail(item.email) === normalizedEmail); const now = new Date().toISOString(); if (!user) { user = { id: crypto.randomUUID(), email: normalizedEmail, name: name || normalizedEmail, avatar: avatar || null, provider: 'google', providerUserId: String(providerUserId), createdAt: now, updatedAt: now }; store.users.push(user); } else { user.email = normalizedEmail; user.name = name || user.name; user.avatar = avatar || user.avatar; user.provider = user.provider || 'google'; user.providerUserId = user.providerUserId || String(providerUserId); user.updatedAt = now; } return safeUser(user); });
  }
  async registerLocalUser({ email, password, name }) {
    const normalizedEmail = validateCredentials(email, password);
    const passwordHash = await bcrypt.hash(password, 12);
    if (this.userRepository) {
      const existing = await this.userRepository.findByEmailForAuth(normalizedEmail);
      if (existing) {
        if (existing.passwordHash) throw Object.assign(new Error('Email already registered'), { code: 'AUTH_EMAIL_EXISTS', statusCode: 409 });
        return this.userRepository.setPasswordHash(existing.id, passwordHash);
      }
      return this.userRepository.createUser({ id: crypto.randomUUID(), email: normalizedEmail, name: name?.trim() || normalizedEmail, passwordHash });
    }
    return this.updateStore(async (store) => {
      const existing = store.users.find((user) => normalizeEmail(user.email) === normalizedEmail);
      if (existing) {
        if (existing.passwordHash) throw Object.assign(new Error('Email already registered'), { code: 'AUTH_EMAIL_EXISTS', statusCode: 409 });
        existing.passwordHash = passwordHash; existing.updatedAt = new Date().toISOString(); return safeUser(existing);
      }
      const now = new Date().toISOString(); const user = { id: crypto.randomUUID(), email: normalizedEmail, name: name?.trim() || normalizedEmail, avatar: null, passwordHash, createdAt: now, updatedAt: now };
      store.users.push(user); return safeUser(user);
    });
  }
  async authenticateLocalUser({ email, password }) {
    const normalizedEmail = validateCredentials(email, password);
    let user;
    if (this.userRepository) user = await this.userRepository.findByEmailForAuth(normalizedEmail);
    else { const store = await this.readStore(); user = store.users.find((item) => normalizeEmail(item.email) === normalizedEmail); }
    const valid = user?.passwordHash ? await bcrypt.compare(password, user.passwordHash) : false;
    if (!valid) throw Object.assign(new Error('Invalid email or password'), { code: 'AUTH_INVALID_CREDENTIALS', statusCode: 401 });
    return safeUser(user);
  }
  async createSession(userId) { const token = crypto.randomBytes(32).toString('base64url'); const expiresAt = new Date(Date.now() + this.sessionTtlMs); const tokenHash = hashToken(token); if (this.sessionRepository) { await this.sessionRepository.deleteExpiredSessions(); await this.sessionRepository.createSession({ id: crypto.randomUUID(), userId: String(userId), tokenHash, expiresAt }); } else await this.updateStore(async (store) => { const now = Date.now(); store.sessions = store.sessions.filter((session) => session.expiresAt > now); store.sessions.push({ tokenHash, userId: String(userId), createdAt: now, expiresAt: expiresAt.getTime() }); }); return token; }
  async getUserForSession(token) { if (!token) return null; const tokenHash = hashToken(token); if (this.sessionRepository) return (await this.sessionRepository.findSessionByHash(tokenHash))?.user || null; const store = await this.readStore(); const session = store.sessions.find((item) => item.tokenHash === tokenHash && item.expiresAt > Date.now()); return session ? safeUser(store.users.find((user) => user.id === session.userId)) : null; }
  async revokeSession(token) { if (!token) return; const tokenHash = hashToken(token); if (this.sessionRepository) await this.sessionRepository.revokeSession(tokenHash); else await this.updateStore(async (store) => { store.sessions = store.sessions.filter((session) => session.tokenHash !== tokenHash); }); }
  cookieOptions({ secure = false } = {}) { return { httpOnly: true, secure, sameSite: 'lax', path: '/', maxAge: this.sessionTtlMs }; }
}

export { hashToken, safeUser };
