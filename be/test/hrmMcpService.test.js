import assert from 'node:assert/strict';
import test from 'node:test';
import { HrmMcpService } from '../src/hrmMcpService.js';

test('HRM MCP adapter maps trusted context to current capability names and parses data', async () => {
  let call;
  const service = new HrmMcpService({ async callTool(...args) { call = args; return { content: [{ type: 'text', text: '{"data":[{"id":"employee-1"}]}' }] }; } });
  assert.deepEqual(await service.getMyProfile({ executionContext: { userId: 'authenticated-user', companyId: 'company-a', requestId: 'request-1' } }), [{ id: 'employee-1' }]);
  assert.equal(call[0], 'get_my_profile');
  assert.deepEqual(call[3], { 'x-mcp-user-id': 'authenticated-user', 'x-mcp-request-id': 'request-1' });
});
test('HRM MCP adapter fails closed for missing context and malformed responses', async () => {
  const service = new HrmMcpService({ async callTool() { return { content: [{ type: 'text', text: 'not json' }] }; } });
  await assert.rejects(service.getMyProfile({ executionContext: {} }), { code: 'HRM_COMPANY_REQUIRED' });
  await assert.rejects(service.getMyProfile({ executionContext: { userId: 'user', companyId: 'company-a', requestId: 'request-1' } }), { code: 'HRM_UNAVAILABLE' });
});
