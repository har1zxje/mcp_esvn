import assert from 'node:assert/strict';
import test from 'node:test';
import { HrmContextService } from '../src/hrmContext.js';

test('HRM transport context carries only the authenticated user', async () => {
  const requested = [];
  const service = new HrmContextService({
    async getActiveCompanyId(userId) { requested.push(userId); return userId === 'authenticated-user' ? 'company-a' : null; },
  });
  assert.deepEqual(await service.resolve('authenticated-user', 'request-1'), { userId: 'authenticated-user', requestId: 'request-1' });
  assert.deepEqual(requested, []);
  await assert.rejects(service.resolve('user supplied by browser'), { code: 'HRM_COMPANY_REQUIRED' });
  assert.deepEqual(await service.resolve('unknown-user'), { userId: 'unknown-user' });
});
