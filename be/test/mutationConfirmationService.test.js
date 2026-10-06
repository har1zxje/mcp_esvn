import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import test from 'node:test';

import { MutationConfirmationError, MutationConfirmationService, parseExplicitConfirmation } from '../src/mutationConfirmationService.js';

const userId = '6b97bfe5-0b37-4ee7-a9f6-3f6a4bead26a';
const conversationId = '28d3e813-d363-4f79-977a-73e449cd2da0';
const confirmationId = 'c3878fd3-d230-4eb2-b2c3-2b39e90f948e';
const context = { userId, companyId: 'company-a', conversationId };

function fakeRepository() {
  const records = new Map();
  return {
    records,
    async create(record) {
      const stored = { ...record, id: confirmationId, expiresAt: record.expiresAt.toISOString(), consumedAt: null };
      records.set(stored.id, stored);
      return stored;
    },
    async consumeBound(input) {
      const record = records.get(input.id);
      if (!record || record.consumedAt || record.userId !== input.userId || record.companyId !== input.companyId || record.conversationId !== input.conversationId || record.mutationKind !== input.mutationKind) return null;
      record.consumedAt = new Date().toISOString();
      return record;
    },
  };
}

test('preview canonicalizes server-resolved payload and accepts an exact confirmation only once', async () => {
  const repository = fakeRepository();
  const service = new MutationConfirmationService({
    confirmationRepository: repository,
    ttlMs: 120_000,
    now: () => new Date('2026-09-29T00:00:00.000Z'),
  });
  const preview = await service.createPreview({
    executionContext: context,
    mutationKind: 'leave.request',
    targetIds: { leaveTypeId: 'annual', employeeId: 'server-resolved-employee' },
    resolvedPayload: { endDate: '2026-10-02', leaveTypeId: 'annual', startDate: '2026-10-01' },
  });
  assert.deepEqual(preview, {
    confirmationId,
    mutationKind: 'leave.request',
    targetIds: { employeeId: 'server-resolved-employee', leaveTypeId: 'annual' },
    expiresAt: '2026-09-29T00:02:00.000Z',
  });
  const stored = repository.records.get(confirmationId);
  assert.equal(stored.payloadDigest, crypto.createHash('sha256').update('{"endDate":"2026-10-02","leaveTypeId":"annual","startDate":"2026-10-01"}').digest('hex'));
  assert.equal(preview.resolvedPayload, undefined);
  const consumed = await service.consumeExplicitConfirmation({ userText: `xác nhận ${confirmationId}`, executionContext: context, mutationKind: 'leave.request' });
  assert.deepEqual(consumed.resolvedPayload, { endDate: '2026-10-02', leaveTypeId: 'annual', startDate: '2026-10-01' });
  assert.equal(await service.consumeExplicitConfirmation({ userText: `CONFIRM ${confirmationId}`, executionContext: context, mutationKind: 'leave.request' }), null);
});

test('confirmation parser rejects vague, model-style, and identifier-only replies before repository access', async () => {
  const repository = fakeRepository();
  const service = new MutationConfirmationService({ confirmationRepository: repository });
  for (const text of ['yes', 'confirm=true', confirmationId, `please confirm ${confirmationId}`, `CONFIRM ${confirmationId} extra`]) {
    assert.equal(parseExplicitConfirmation(text), null);
    assert.equal(await service.consumeExplicitConfirmation({ userText: text, executionContext: context, mutationKind: 'leave.request' }), null);
  }
  assert.equal(repository.records.size, 0);
});

test('consume fails closed across user, company, conversation, mutation, and payload-integrity boundaries', async () => {
  const repository = fakeRepository();
  const service = new MutationConfirmationService({ confirmationRepository: repository });
  await service.createPreview({ executionContext: context, mutationKind: 'leave.approve', targetIds: { leaveRequestId: 'request-a' }, resolvedPayload: { leaveRequestId: 'request-a', decision: 'approved' } });
  const userB = { ...context, userId: '47f6b5a1-a6f9-4a98-ae8e-2dca3050701a' };
  assert.equal(await service.consumeExplicitConfirmation({ userText: `CONFIRM ${confirmationId}`, executionContext: userB, mutationKind: 'leave.approve' }), null);
  assert.equal(await service.consumeExplicitConfirmation({ userText: `CONFIRM ${confirmationId}`, executionContext: { ...context, companyId: 'company-b' }, mutationKind: 'leave.approve' }), null);
  assert.equal(await service.consumeExplicitConfirmation({ userText: `CONFIRM ${confirmationId}`, executionContext: { ...context, conversationId: '038f1ce7-13e1-4b30-a8d5-70242ac5bb2b' }, mutationKind: 'leave.approve' }), null);
  assert.equal(await service.consumeExplicitConfirmation({ userText: `CONFIRM ${confirmationId}`, executionContext: context, mutationKind: 'leave.reject' }), null);
  repository.records.get(confirmationId).resolvedPayload.decision = 'rejected';
  await assert.rejects(
    service.consumeExplicitConfirmation({ userText: `CONFIRM ${confirmationId}`, executionContext: context, mutationKind: 'leave.approve' }),
    (error) => error instanceof MutationConfirmationError && error.code === 'CONFIRMATION_INTEGRITY_FAILED',
  );
});

test('preview rejects invalid context and non-canonical payload values', async () => {
  const service = new MutationConfirmationService({ confirmationRepository: fakeRepository() });
  await assert.rejects(
    service.createPreview({ executionContext: { ...context, companyId: 'not valid' }, mutationKind: 'leave.request', targetIds: {}, resolvedPayload: {} }),
    (error) => error.code === 'CONFIRMATION_CONTEXT_INVALID',
  );
  await assert.rejects(
    service.createPreview({ executionContext: context, mutationKind: 'leave.request', targetIds: {}, resolvedPayload: { total: Number.NaN } }),
    (error) => error.code === 'CONFIRMATION_INVALID',
  );
});
