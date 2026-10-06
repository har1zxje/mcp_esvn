import assert from 'node:assert/strict';
import test from 'node:test';

import { MutationConfirmationRepository } from '../src/repositories.js';

const id = 'c3878fd3-d230-4eb2-b2c3-2b39e90f948e';
const userId = '6b97bfe5-0b37-4ee7-a9f6-3f6a4bead26a';
const conversationId = '28d3e813-d363-4f79-977a-73e449cd2da0';

test('consumeBound atomically scopes the pending confirmation to trusted context', async () => {
  const calls = [];
  const repository = new MutationConfirmationRepository({
    async query(sql, values) {
      calls.push({ sql, values });
      return { rows: [{
        id, user_id: userId, company_id: 'company-a', conversation_id: conversationId,
        mutation_kind: 'leave.request', target_ids: { leaveTypeId: 'annual' },
        payload_digest: 'a'.repeat(64), resolved_payload: { leaveTypeId: 'annual' },
        expires_at: new Date('2026-09-29T00:05:00.000Z'), consumed_at: new Date('2026-09-29T00:01:00.000Z'),
      }] };
    },
  });
  const record = await repository.consumeBound({ id, userId, companyId: 'company-a', conversationId, mutationKind: 'leave.request' });
  assert.equal(record.id, id);
  assert.match(calls[0].sql, /consumed_at IS NULL AND expires_at > now\(\)/);
  assert.match(calls[0].sql, /user_id = \$2 AND company_id = \$3 AND conversation_id = \$4 AND mutation_kind = \$5/);
  assert.deepEqual(calls[0].values, [id, userId, 'company-a', conversationId, 'leave.request']);
});

test('consumeBound validates context before making a database query', async () => {
  let queried = false;
  const repository = new MutationConfirmationRepository({ async query() { queried = true; return { rows: [] }; } });
  await assert.rejects(
    repository.consumeBound({ id, userId, companyId: 'not valid', conversationId, mutationKind: 'leave.request' }),
    /companyId is invalid/,
  );
  await assert.rejects(
    repository.consumeBound({ id, userId, companyId: 'company-a', conversationId, mutationKind: 'leave request' }),
    /mutationKind is invalid/,
  );
  assert.equal(queried, false);
});
