function safeUser(row) {
  return row ? { id: row.id, email: row.email, name: row.display_name, avatar: row.avatar_url } : null;
}

export class UserRepository {
  constructor(database) { this.database = database; }
  async findByGoogleSub(googleSub) {
    const { rows } = await this.database.query('SELECT id, email, display_name, avatar_url FROM users WHERE google_sub = $1', [String(googleSub)]);
    return safeUser(rows[0]);
  }
  async findByEmail(email) {
    const { rows } = await this.database.query('SELECT id, email, display_name, avatar_url, google_sub FROM users WHERE email = $1', [email]);
    return rows[0] ? { ...safeUser(rows[0]), googleSub: rows[0].google_sub } : null;
  }
  async findByEmailForAuth(email) {
    const { rows } = await this.database.query('SELECT id, email, display_name, avatar_url, password_hash FROM users WHERE email = $1', [email]);
    return rows[0] ? { ...safeUser(rows[0]), passwordHash: rows[0].password_hash } : null;
  }
  async findById(id) {
    const { rows } = await this.database.query('SELECT id, email, display_name, avatar_url FROM users WHERE id = $1', [id]);
    return safeUser(rows[0]);
  }
  async listDirectoryUsers() {
    const { rows } = await this.database.query('SELECT id, email, display_name FROM users ORDER BY display_name, id');
    return rows.map((row) => ({ id: row.id, email: row.email, name: row.display_name }));
  }
  async createUser({ id, googleSub = null, email, name, avatar = null, passwordHash = null }) {
    const { rows } = await this.database.query(`INSERT INTO users (id, google_sub, email, display_name, avatar_url, password_hash)
      VALUES ($1, $2, $3, $4, $5, $6) RETURNING id, email, display_name, avatar_url`, [id, googleSub, email, name, avatar, passwordHash]);
    return safeUser(rows[0]);
  }
  async updateUser(id, { email, name, avatar }) {
    const { rows } = await this.database.query(`UPDATE users SET email = $2, display_name = $3, avatar_url = $4, updated_at = now()
      WHERE id = $1 RETURNING id, email, display_name, avatar_url`, [id, email, name, avatar]);
    return safeUser(rows[0]);
  }
  async linkGoogleSub(id, googleSub) {
    const { rows } = await this.database.query(`UPDATE users SET google_sub = $2, updated_at = now()
      WHERE id = $1 RETURNING id, email, display_name, avatar_url`, [id, String(googleSub)]);
    return safeUser(rows[0]);
  }
  async setPasswordHash(id, passwordHash) {
    const { rows } = await this.database.query(`UPDATE users SET password_hash = $2, updated_at = now()
      WHERE id = $1 RETURNING id, email, display_name, avatar_url`, [id, passwordHash]);
    return safeUser(rows[0]);
  }
}

export class SessionRepository {
  constructor(database) { this.database = database; }
  async createSession({ id, userId, tokenHash, expiresAt }) {
    await this.database.query('INSERT INTO sessions (id, user_id, session_token_hash, expires_at) VALUES ($1, $2, $3, $4)', [id, userId, tokenHash, expiresAt]);
  }
  async findSessionByHash(tokenHash) {
    const { rows } = await this.database.query(`SELECT s.user_id, u.id, u.email, u.display_name, u.avatar_url
      FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.session_token_hash = $1 AND s.revoked_at IS NULL AND s.expires_at > now()`, [tokenHash]);
    return rows[0] ? { userId: rows[0].user_id, user: safeUser(rows[0]) } : null;
  }
  async revokeSession(tokenHash) { await this.database.query('UPDATE sessions SET revoked_at = now() WHERE session_token_hash = $1 AND revoked_at IS NULL', [tokenHash]); }
  async deleteExpiredSessions() { await this.database.query('DELETE FROM sessions WHERE expires_at <= now() OR revoked_at IS NOT NULL'); }
}

export class IntegrationRepository {
  constructor(database) { this.database = database; }
  map(row) { return row ? { id: row.id, userId: row.user_id, provider: row.provider, encryptedCredentials: row.encrypted_credentials, createdAt: row.created_at, updatedAt: row.updated_at } : null; }
  async getIntegration(userId, provider) {
    const { rows } = await this.database.query(`SELECT id, user_id, provider, encrypted_credentials, created_at, updated_at
      FROM integrations WHERE user_id = $1 AND provider = $2`, [userId, provider]);
    return this.map(rows[0]);
  }
  async upsertIntegration(userId, provider, encryptedCredentials) {
    const { rows } = await this.database.query(`INSERT INTO integrations (id, user_id, provider, encrypted_credentials)
      VALUES (gen_random_uuid(), $1, $2, $3::jsonb)
      ON CONFLICT (user_id, provider) DO UPDATE SET encrypted_credentials = EXCLUDED.encrypted_credentials, updated_at = now()
      RETURNING id, user_id, provider, encrypted_credentials, created_at, updated_at`, [userId, provider, JSON.stringify(encryptedCredentials)]);
    return this.map(rows[0]);
  }
  async deleteIntegration(userId, provider) { const result = await this.database.query('DELETE FROM integrations WHERE user_id = $1 AND provider = $2', [userId, provider]); return result.rowCount > 0; }
  async getIntegrationStatus(userId) {
    const { rows } = await this.database.query('SELECT provider, id, created_at, updated_at FROM integrations WHERE user_id = $1 ORDER BY provider', [userId]);
    return rows;
  }
}

export class ConversationRepository {
  constructor(database) { this.database = database; }
  async listByOwner(userId) { const { rows } = await this.database.query('SELECT data FROM conversations WHERE owner_id = $1 ORDER BY updated_at DESC', [userId]); return rows.map((row) => row.data); }
  async findById(id) { const { rows } = await this.database.query('SELECT data FROM conversations WHERE id = $1', [id]); return rows[0]?.data || null; }
  async upsert(conversation) { await this.database.query(`INSERT INTO conversations (id, owner_id, legacy_owner_id, data, updated_at) VALUES ($1, $2, $3, $4::jsonb, to_timestamp($5 / 1000.0))
    ON CONFLICT (id) DO UPDATE SET owner_id = EXCLUDED.owner_id, legacy_owner_id = EXCLUDED.legacy_owner_id, data = EXCLUDED.data, updated_at = EXCLUDED.updated_at`, [conversation.id, conversation.ownerId || null, null, JSON.stringify(conversation), conversation.updatedAt ?? Date.now()]); }
  async delete(id, userId) { const result = await this.database.query('DELETE FROM conversations WHERE id = $1 AND owner_id = $2', [id, userId]); return result.rowCount > 0; }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const COMPANY_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,99}$/;
const MUTATION_KIND = /^[a-z][a-z0-9._-]{0,99}$/;
const DIGEST = /^[0-9a-f]{64}$/;
const requiredUuid = (value, name) => {
  if (!UUID.test(String(value ?? ''))) throw new TypeError(`${name} must be a UUID.`);
  return String(value);
};
const requiredObject = (value, name) => {
  if (!value || Array.isArray(value) || typeof value !== 'object') throw new TypeError(`${name} must be an object.`);
  return value;
};
const requiredCompanyId = (value) => {
  if (!COMPANY_ID.test(String(value ?? ''))) throw new TypeError('companyId is invalid.');
  return String(value);
};
const requiredMutationKind = (value) => {
  if (!MUTATION_KIND.test(String(value ?? ''))) throw new TypeError('mutationKind is invalid.');
  return String(value);
};
const requiredDigest = (value) => {
  if (!DIGEST.test(String(value ?? ''))) throw new TypeError('payloadDigest must be a SHA-256 digest.');
  return String(value);
};
const requiredConversationId = (value) => requiredUuid(value, 'conversationId');

/** Persists semantic-mutation authorization state; callers must supply only
 * server-resolved identities and canonical payloads. */
export class MutationConfirmationRepository {
  constructor(database) { this.database = database; }
  map(row) {
    return row ? {
      id: row.id,
      userId: row.user_id,
      companyId: row.company_id,
      conversationId: row.conversation_id,
      mutationKind: row.mutation_kind,
      targetIds: row.target_ids,
      payloadDigest: row.payload_digest,
      resolvedPayload: row.resolved_payload,
      expiresAt: row.expires_at instanceof Date ? row.expires_at.toISOString() : row.expires_at,
      consumedAt: row.consumed_at instanceof Date ? row.consumed_at.toISOString() : row.consumed_at,
    } : null;
  }
  async create({ userId, companyId, conversationId, mutationKind, targetIds, payloadDigest, resolvedPayload, expiresAt }) {
    const safeUserId = requiredUuid(userId, 'userId');
    const safeConversationId = requiredUuid(conversationId, 'conversationId');
    if (!(expiresAt instanceof Date) || Number.isNaN(expiresAt.getTime())) throw new TypeError('expiresAt must be a valid Date.');
    const { rows } = await this.database.query(`INSERT INTO mutation_confirmations
      (user_id, company_id, conversation_id, mutation_kind, target_ids, payload_digest, resolved_payload, expires_at)
      VALUES ($1,$2,$3,$4,$5::jsonb,$6,$7::jsonb,$8)
      RETURNING id, user_id, company_id, conversation_id, mutation_kind, target_ids, payload_digest, resolved_payload, expires_at, consumed_at`,
    [safeUserId, requiredCompanyId(companyId), safeConversationId, requiredMutationKind(mutationKind), JSON.stringify(requiredObject(targetIds, 'targetIds')), requiredDigest(payloadDigest), JSON.stringify(requiredObject(resolvedPayload, 'resolvedPayload')), expiresAt]);
    return this.map(rows[0]);
  }
  async consume({ id, userId, companyId, conversationId, mutationKind, payloadDigest }) {
    const { rows } = await this.database.query(`UPDATE mutation_confirmations SET consumed_at = now()
      WHERE id = $1 AND user_id = $2 AND company_id = $3 AND conversation_id = $4 AND mutation_kind = $5
        AND payload_digest = $6 AND consumed_at IS NULL AND expires_at > now()
      RETURNING id, user_id, company_id, conversation_id, mutation_kind, target_ids, payload_digest, resolved_payload, expires_at, consumed_at`,
    [requiredUuid(id, 'id'), requiredUuid(userId, 'userId'), requiredCompanyId(companyId), requiredConversationId(conversationId), requiredMutationKind(mutationKind), requiredDigest(payloadDigest)]);
    return this.map(rows[0]);
  }

  /**
   * Atomically consumes a record using only server-owned identity/context. The
   * canonical payload digest remains persisted with the record and is checked
   * by MutationConfirmationService before its payload is handed to an
   * executor; callers never supply a model-controlled digest.
   */
  async consumeBound({ id, userId, companyId, conversationId, mutationKind }) {
    const { rows } = await this.database.query(`UPDATE mutation_confirmations SET consumed_at = now()
      WHERE id = $1 AND user_id = $2 AND company_id = $3 AND conversation_id = $4 AND mutation_kind = $5
        AND consumed_at IS NULL AND expires_at > now()
      RETURNING id, user_id, company_id, conversation_id, mutation_kind, target_ids, payload_digest, resolved_payload, expires_at, consumed_at`,
    [requiredUuid(id, 'id'), requiredUuid(userId, 'userId'), requiredCompanyId(companyId), requiredConversationId(conversationId), requiredMutationKind(mutationKind)]);
    return this.map(rows[0]);
  }
}
