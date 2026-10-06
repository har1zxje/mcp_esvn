import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import test from 'node:test';
import { createDatabase, initializeDatabase } from '../src/database.js';
import { UserRepository, SessionRepository, IntegrationRepository, ConversationRepository, MutationConfirmationRepository } from '../src/repositories.js';
import { IntegrationService } from '../src/integrationService.js';

const connectionString = process.env.TEST_DATABASE_URL || process.env.DATABASE_URL;

test('PostgreSQL repositories preserve user, session, integration, and mutation-confirmation isolation', { skip: !connectionString ? 'Set TEST_DATABASE_URL to run PostgreSQL persistence tests' : false }, async () => {
  const database = createDatabase({ connectionString });
  const userA = crypto.randomUUID(); const userB = crypto.randomUUID(); const key = crypto.randomBytes(32).toString('hex');
  try {
    await initializeDatabase(database, await fs.readFile(new URL('../schema.sql', import.meta.url), 'utf8'));
    const users = new UserRepository(database); const sessions = new SessionRepository(database); const integrations = new IntegrationRepository(database); const conversations = new ConversationRepository(database); const confirmations = new MutationConfirmationRepository(database);
    await users.createUser({ id: userA, googleSub: `postgres-a-${userA}`, email: 'a@example.test', name: 'A', avatar: null });
    await users.createUser({ id: userB, googleSub: `postgres-b-${userB}`, email: 'b@example.test', name: 'B', avatar: null });
    const service = new IntegrationService({ integrationRepository: integrations, encryptionKey: key });
    await service.saveIntegration(userA, 'plane', { accessToken: 'plane-secret-a', externalUserId: 'plane-a' });
    await service.saveIntegration(userB, 'plane', { accessToken: 'plane-secret-b', externalUserId: 'plane-b' });
    await service.saveIntegration(userA, 'discord', { guildId: 'guild-a', channelId: 'channel-a' }, { allowCredentialless: true });
    assert.equal((await service.getIntegration(userA, 'plane')).accessToken, 'plane-secret-a');
    assert.equal(await service.getIntegration(userB, 'discord'), null);
    assert.equal((await service.getSafeIntegration(userA, 'plane')).accessToken, undefined);
    const stored = await database.query('SELECT encrypted_credentials::text AS value FROM integrations WHERE user_id = $1', [userA]);
    assert.equal(stored.rows.some((row) => row.value.includes('plane-secret-a')), false);
    await service.disconnectIntegration(userA, 'discord');
    assert.equal(await service.getIntegration(userB, 'plane') !== null, true);
    const sessionHash = crypto.createHash('sha256').update('session-a').digest('hex');
    await sessions.createSession({ id: crypto.randomUUID(), userId: userA, tokenHash: sessionHash, expiresAt: new Date(Date.now() + 60_000) });
    assert.equal((await sessions.findSessionByHash(sessionHash)).user.id, userA);
    await sessions.revokeSession(sessionHash);
    assert.equal(await sessions.findSessionByHash(sessionHash), null);
    const conversationId = crypto.randomUUID();
    await conversations.upsert({ id: conversationId, ownerId: userA, title: 'Confirmation test', messages: [], updatedAt: Date.now() });
    const digest = crypto.createHash('sha256').update('leave.approve:request-a').digest('hex');
    const confirmation = await confirmations.create({ userId: userA, companyId: 'company-a', conversationId, mutationKind: 'leave.approve', targetIds: { leaveRequestId: 'request-a' }, payloadDigest: digest, resolvedPayload: { leaveRequestId: 'request-a', decision: 'approved' }, expiresAt: new Date(Date.now() + 60_000) });
    assert.equal(await confirmations.consume({ id: confirmation.id, userId: userB, companyId: 'company-a', conversationId, mutationKind: 'leave.approve', payloadDigest: digest }), null);
    assert.equal(await confirmations.consume({ id: confirmation.id, userId: userA, companyId: 'company-b', conversationId, mutationKind: 'leave.approve', payloadDigest: digest }), null);
    assert.equal(await confirmations.consume({ id: confirmation.id, userId: userA, companyId: 'company-a', conversationId: crypto.randomUUID(), mutationKind: 'leave.approve', payloadDigest: digest }), null);
    assert.equal((await confirmations.consume({ id: confirmation.id, userId: userA, companyId: 'company-a', conversationId, mutationKind: 'leave.approve', payloadDigest: digest })).resolvedPayload.decision, 'approved');
    assert.equal(await confirmations.consume({ id: confirmation.id, userId: userA, companyId: 'company-a', conversationId, mutationKind: 'leave.approve', payloadDigest: digest }), null);
    const expired = await confirmations.create({ userId: userA, companyId: 'company-a', conversationId, mutationKind: 'leave.reject', targetIds: { leaveRequestId: 'request-b' }, payloadDigest: crypto.createHash('sha256').update('leave.reject:request-b').digest('hex'), resolvedPayload: { leaveRequestId: 'request-b', decision: 'rejected' }, expiresAt: new Date(Date.now() - 1_000) });
    assert.equal(await confirmations.consume({ id: expired.id, userId: userA, companyId: 'company-a', conversationId, mutationKind: 'leave.reject', payloadDigest: expired.payloadDigest }), null);
    const explicit = await confirmations.create({ userId: userA, companyId: 'company-a', conversationId, mutationKind: 'leave.request', targetIds: { leaveTypeId: 'annual' }, payloadDigest: crypto.createHash('sha256').update('leave.request:annual').digest('hex'), resolvedPayload: { leaveTypeId: 'annual', startDate: '2026-10-01' }, expiresAt: new Date(Date.now() + 60_000) });
    assert.equal(await confirmations.consumeBound({ id: explicit.id, userId: userB, companyId: 'company-a', conversationId, mutationKind: 'leave.request' }), null);
    assert.equal(await confirmations.consumeBound({ id: explicit.id, userId: userA, companyId: 'company-a', conversationId, mutationKind: 'leave.approve' }), null);
    assert.equal((await confirmations.consumeBound({ id: explicit.id, userId: userA, companyId: 'company-a', conversationId, mutationKind: 'leave.request' })).resolvedPayload.leaveTypeId, 'annual');
    assert.equal(await confirmations.consumeBound({ id: explicit.id, userId: userA, companyId: 'company-a', conversationId, mutationKind: 'leave.request' }), null);
  } finally {
    await database.query('DELETE FROM users WHERE id IN ($1, $2)', [userA, userB]);
    await database.close();
  }
});
