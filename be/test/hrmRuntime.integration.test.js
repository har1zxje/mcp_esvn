import assert from 'node:assert/strict';
import test from 'node:test';

// This test is opt-in because it exercises the live local adapter chain rather
// than a mocked MCP client. HRM resolves employee and company from its own
// identity link; the Chat Backend supplies only the authenticated user id.
process.env.LIBRECHAT_URL = 'http://librechat.test';
process.env.CHAT_MODEL_MAP_JSON = '{"test":{"agentId":"agent"}}';
process.env.CHAT_DEFAULT_MODEL_ID = 'test';
process.env.MCP_SERVERS_JSON = '{}';
process.env.MCP_INTERNAL_TOKEN ??= 'hrm-e2e-mcp-token';

const endpoint = process.env.HRM_E2E_MCP_URL;
const userId = process.env.HRM_E2E_USER_ID;
const integration = endpoint && userId ? test : test.skip;
const { McpClient } = await import('../src/mcpClient.js');
const { ToolRegistry } = await import('../src/toolRegistry.js');
const { HrmContextService } = await import('../src/hrmContext.js');

integration('runtime HRM chain uses only Backend-owned context and preserves HRM scope denial', async () => {
  const contextService = new HrmContextService();
  const client = new McpClient('hrm', { url: endpoint, internalToken: process.env.MCP_INTERNAL_TOKEN });
  const registry = new ToolRegistry(new Map([['hrm', client]]), (authenticatedUserId) => contextService.resolve(authenticatedUserId));
  const executionContext = { userId, requestId: 'phase1-runtime-e2e' };

  await registry.refresh(['hrm'], undefined, executionContext);
    assert.ok(registry.resolve('hrm__get_my_profile'));

    const self = await registry.execute('hrm__get_my_profile', { companyId: 'dev-company-b', userId: 'spoofed-user' }, 'Show my HRM profile', undefined, executionContext);
    assert.equal(self.success, true);
    const selfPayload = JSON.parse(self.result.content.find((item) => item.type === 'text').text);
    assert.equal(selfPayload.data.id, 'emp-svt-backend-huy');
    assert.equal(selfPayload.data.companyId, 'dev-company-a');

    const sameCompanyForbidden = await registry.execute('hrm__get_employee', { employeeId: 'employee-a1', companyId: 'dev-company-b', userId: 'spoofed-user' }, 'Show HRM employee employee-a1', undefined, executionContext);
    assert.deepEqual(sameCompanyForbidden, { success: false, error: { code: 'HRM_FORBIDDEN', message: 'You do not have permission to perform this action.' } });

    const crossCompanyDenied = await registry.execute('hrm__get_employee', { employeeId: 'emp-man-logistics-lam', companyId: 'dev-company-b', userId: 'spoofed-user' }, 'Show HRM employee emp-man-logistics-lam', undefined, executionContext);
  assert.deepEqual(crossCompanyDenied, { success: false, error: { code: 'HRM_NOT_FOUND', message: 'The requested HRM resource was not found.' } });
});
