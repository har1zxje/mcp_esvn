import 'dotenv/config';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { createDatabase, initializeDatabase } from '../src/database.js';

const dataDir = path.resolve(process.cwd(), 'data');
const readJson = async (name, fallback) => { try { return JSON.parse(await fs.readFile(path.join(dataDir, name), 'utf8')); } catch (error) { if (error.code === 'ENOENT') return fallback; throw error; } };
const requireKey = () => { const value = process.env.INTEGRATION_ENCRYPTION_KEY; if (!/^[0-9a-f]{64}$/i.test(value || '')) throw new Error('INTEGRATION_ENCRYPTION_KEY is required when migrating plaintext integration credentials'); return Buffer.from(value, 'hex'); };
const encrypt = (value, key) => { if (!value) return null; const iv = crypto.randomBytes(12); const cipher = crypto.createCipheriv('aes-256-gcm', key, iv); const ciphertext = Buffer.concat([cipher.update(String(value), 'utf8'), cipher.final()]); return `v1:${iv.toString('base64url')}:${ciphertext.toString('base64url')}:${cipher.getAuthTag().toString('base64url')}`; };
const isUuid = (value) => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);

const database = createDatabase({ connectionString: process.env.DATABASE_URL || undefined, host: process.env.DB_HOST || '127.0.0.1', port: Number(process.env.DB_PORT || 5432), database: process.env.DB_NAME || 'mcpserver', user: process.env.DB_USER || 'postgres', password: process.env.DB_PASSWORD });
try {
  await initializeDatabase(database, await fs.readFile(new URL('../schema.sql', import.meta.url), 'utf8'));
  const auth = await readJson('auth.json', { users: [], sessions: [] });
  const integrations = await readJson('user_integrations.json', { integrations: [] });
  const conversations = await readJson('conversations.json', {});
  const userIds = new Map();
  let legacyConversationCount = 0;
  await database.transaction(async (client) => {
    for (const user of auth.users || []) {
      const result = await client.query(`INSERT INTO users (id, google_sub, email, display_name, avatar_url, password_hash, created_at, updated_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8) ON CONFLICT (google_sub) DO UPDATE SET email = EXCLUDED.email, display_name = EXCLUDED.display_name, avatar_url = EXCLUDED.avatar_url, password_hash = COALESCE(EXCLUDED.password_hash, users.password_hash), updated_at = EXCLUDED.updated_at
        RETURNING id`, [user.id, user.providerUserId || null, user.email?.trim().toLowerCase(), user.name || user.email, user.avatar || null, user.passwordHash || null, user.createdAt || new Date(), user.updatedAt || new Date()]);
      userIds.set(user.id, result.rows[0].id);
    }
    for (const session of auth.sessions || []) {
      const userId = userIds.get(session.userId);
      if (!userId || !session.tokenHash) continue;
      await client.query(`INSERT INTO sessions (id, user_id, session_token_hash, expires_at, created_at)
        VALUES (gen_random_uuid(), $1, $2, to_timestamp($3 / 1000.0), to_timestamp($4 / 1000.0)) ON CONFLICT (session_token_hash) DO NOTHING`, [userId, session.tokenHash, session.expiresAt, session.createdAt]);
    }
    for (const item of integrations.integrations || []) {
      const userId = userIds.get(item.userId) || item.userId;
      if (!userId || !['plane', 'discord'].includes(item.provider)) continue;
      const key = item.accessTokenEncrypted || item.refreshTokenEncrypted ? null : requireKey();
      const encryptedCredentials = { externalUserId: item.externalUserId ?? null, credentialType: item.credentialType ?? null, accessTokenEncrypted: item.accessTokenEncrypted || encrypt(item.accessToken, key), refreshTokenEncrypted: item.refreshTokenEncrypted || encrypt(item.refreshToken, key), expiresAt: item.expiresAt ?? null, workspaceId: item.workspaceId ?? null, workspaceSlug: item.workspaceSlug ?? null, guildId: item.guildId ?? null, channelId: item.channelId ?? null, metadata: item.metadata || {} };
      await client.query(`INSERT INTO integrations (id, user_id, provider, encrypted_credentials, created_at, updated_at)
        VALUES ($1, $2, $3, $4::jsonb, $5, $6) ON CONFLICT (user_id, provider) DO UPDATE SET encrypted_credentials = EXCLUDED.encrypted_credentials, updated_at = EXCLUDED.updated_at`, [item.id || crypto.randomUUID(), userId, item.provider, JSON.stringify(encryptedCredentials), item.createdAt || new Date(), item.updatedAt || new Date()]);
    }
    for (const conversation of Object.values(conversations || {})) {
      if (!conversation.id || !isUuid(conversation.id)) continue;
      const mappedOwnerId = userIds.get(conversation.ownerId);
      const ownerId = mappedOwnerId || null;
      const legacyOwnerId = ownerId ? null : (conversation.ownerId || null);
      if (legacyOwnerId) legacyConversationCount += 1;
      await client.query(`INSERT INTO conversations (id, owner_id, legacy_owner_id, data, updated_at)
        VALUES ($1, $2, $3, $4::jsonb, to_timestamp($5 / 1000.0)) ON CONFLICT (id) DO UPDATE SET owner_id = EXCLUDED.owner_id, legacy_owner_id = EXCLUDED.legacy_owner_id, data = EXCLUDED.data, updated_at = EXCLUDED.updated_at`, [conversation.id, ownerId, legacyOwnerId, JSON.stringify(conversation), conversation.updatedAt || conversation.createdAt || Date.now()]);
    }
  });
  console.log(JSON.stringify({ event: 'migration.complete', users: userIds.size, sessions: (auth.sessions || []).length, integrations: (integrations.integrations || []).length, conversations: Object.keys(conversations || {}).length, legacyConversations: legacyConversationCount }));
} finally { await database.close(); }
