import assert from 'node:assert/strict';
import test from 'node:test';
process.env.LIBRECHAT_URL = 'http://librechat.test';
process.env.CHAT_MODEL_MAP_JSON = '{"test":{"agentId":"agent"}}';
process.env.CHAT_DEFAULT_MODEL_ID = 'test';
process.env.MCP_SERVERS_JSON = '{}';
process.env.MCP_INTERNAL_TOKEN = 'internal-test-token';
const { ToolRegistry } = await import('../src/toolRegistry.js');
const { PlaneWorkManagementProvider, WorkManagementService } = await import('../src/workManagement.js');

test('HRM MCP tools are selected dynamically and receive backend-authenticated context', async () => {
  const records = [];
  const client = {
    async listTools() { return [{ name: 'get_employee', description: 'profile', inputSchema: { type: 'object', properties: { employeeId: { type: 'string' } } } }]; },
    async callTool(...args) { records.push(args); return { content: [{ type: 'text', text: '{"data":{"id":"employee-a"}}' }] }; },
  };
  const registry = new ToolRegistry(new Map([['hrm', client]]), async (userId) => ({ userId, companyId: 'company-a' }));
  await registry.refresh(['hrm'], undefined, { userId: 'authenticated', requestId: 'request-1' });
  assert.equal(registry.definitions().some((tool) => tool.name === 'hrm__get_employee'), true);
  const result = await registry.execute('hrm__get_employee', { employeeId: 'employee-a', userId: 'spoofed', companyId: 'spoofed-company' }, 'Get HRM employee', undefined, { userId: 'authenticated', requestId: 'request-1' });
  assert.equal(result.success, true);
  assert.deepEqual(records[0][3], { 'x-mcp-user-id': 'authenticated', 'x-mcp-request-id': 'request-1' });
  assert.equal(records[0][1].userId, 'spoofed');
  await registry.refresh(['plane']);
  assert.equal(registry.definitions().some((tool) => tool.name === 'hrm__get_employee'), false);
});

test('HRM leave preview creates a server-bound confirmation and strips model identity fields', async () => {
  const calls = [];
  const confirmationCalls = [];
  const client = {
    async listTools() { return [{ name: 'preview_my_leave_request', description: 'preview only', inputSchema: { type: 'object' } }]; },
    async callTool(name, args, _signal, headers) {
      calls.push({ name, args, headers });
      return { content: [{ type: 'text', text: JSON.stringify({ data: {
        companyId: 'company-a',
        leaveTypeCode: 'ANNUAL', leaveTypeName: 'Annual leave', requiresBalance: true,
        startDate: '2026-10-01', endDate: '2026-10-02', requestedDays: 2, reason: null,
        remainingDaysBefore: 12, remainingDaysAfter: 10, hasConflict: false,
      } }) }] };
    },
  };
  const registry = new ToolRegistry(new Map([['hrm', client]]), async (userId) => ({ userId, companyId: 'company-a' }));
  registry.setMutationConfirmationService({
    async createPreview(input) {
      confirmationCalls.push(input);
      return { confirmationId: 'c3878fd3-d230-4eb2-b2c3-2b39e90f948e', expiresAt: '2026-10-01T00:05:00.000Z' };
    },
  });
  const executionContext = {
    userId: '6b97bfe5-0b37-4ee7-a9f6-3f6a4bead26a', requestId: 'request-1', conversationId: '28d3e813-d363-4f79-977a-73e449cd2da0',
  };
  await registry.refresh(['hrm'], undefined, executionContext);
  const result = await registry.execute('hrm__preview_my_leave_request', {
    leaveTypeCode: 'ANNUAL', startDate: '2026-10-01', endDate: '2026-10-02', requestedDays: 2,
    employeeId: 'spoofed-employee', companyId: 'spoofed-company', leaveTypeId: 'native-id', confirmationId: 'model-id', confirm: true,
  }, 'Preview my leave request', undefined, executionContext);
  assert.equal(result.success, true);
  assert.equal(result.result.confirmationRequired, true);
  assert.match(result.result.confirmation.instruction, /^To confirm this leave request, reply exactly: CONFIRM c3878fd3/u);
  assert.deepEqual(calls[0], {
    name: 'preview_my_leave_request',
    args: { leaveTypeCode: 'ANNUAL', startDate: '2026-10-01', endDate: '2026-10-02', requestedDays: 2 },
    headers: { 'x-mcp-user-id': executionContext.userId, 'x-mcp-request-id': 'request-1' },
  });
  assert.deepEqual(confirmationCalls, [{
    executionContext: { userId: executionContext.userId, companyId: 'company-a', conversationId: executionContext.conversationId },
    mutationKind: 'leave.request', targetIds: { leaveTypeCode: 'ANNUAL' },
    resolvedPayload: { leaveTypeCode: 'ANNUAL', startDate: '2026-10-01', endDate: '2026-10-02', requestedDays: 2, reason: null },
  }]);
});
test('HRM MCP errors are normalized before reaching the agent', async () => {
  const client = { async listTools() { return [{ name: 'get_employee', inputSchema: { type: 'object' } }]; }, async callTool() { throw Object.assign(new Error('filesystem / secret leaked'), { code: 'ECONNREFUSED' }); } };
  const registry = new ToolRegistry(new Map([['hrm', client]]), async (userId) => ({ userId, companyId: 'company-a' }));
  await registry.refresh(['hrm'], undefined, { userId: 'authenticated', requestId: 'request-1' });
  assert.deepEqual(await registry.execute('hrm__get_employee', {}, 'Get HRM employee', undefined, { userId: 'authenticated', requestId: 'request-1' }), { success: false, error: { code: 'HRM_UNAVAILABLE', message: 'The HRM provider is unavailable.' } });
});
test('structured HRM tool errors preserve safe domain codes', async () => {
  const client = { async listTools() { return [{ name: 'get_employee', inputSchema: { type: 'object' } }]; }, async callTool() { return { content: [{ type: 'text', text: '{"error":{"code":"EMPLOYEE_NOT_FOUND"}}' }] }; } };
  const registry = new ToolRegistry(new Map([['hrm', client]]), async (userId) => ({ userId, companyId: 'company-a' }));
  await registry.refresh(['hrm'], undefined, { userId: 'authenticated', requestId: 'request-1' });
  assert.deepEqual(await registry.execute('hrm__get_employee', {}, 'Get HRM employee', undefined, { userId: 'authenticated', requestId: 'request-1' }), { success: false, error: { code: 'EMPLOYEE_NOT_FOUND', message: 'Employee was not found.' } });
});

test('contract-v1 HRM authorization errors fail the tool without exposing adapter details', async () => {
  const client = { async listTools() { return [{ name: 'get_employee', inputSchema: { type: 'object' } }]; }, async callTool() { return { content: [{ type: 'text', text: '{"error":{"code":"HRM_FORBIDDEN","message":"internal provider detail"}}' }] }; } };
  const registry = new ToolRegistry(new Map([['hrm', client]]), async (userId) => ({ userId, companyId: 'company-a' }));
  await registry.refresh(['hrm'], undefined, { userId: 'authenticated', requestId: 'request-1' });
  const result = await registry.execute('hrm__get_employee', {}, 'Get HRM employee', undefined, { userId: 'authenticated', requestId: 'request-1' });
  assert.deepEqual(result, {
    success: false,
    error: { code: 'HRM_FORBIDDEN', message: 'You do not have permission to perform this action.' },
  });
});

test('get_my_tasks injects credentials and resolves identity independently for two application users', async () => {
  const calls = [];
  const client = {
    async listTools() {
      return [
        { name: 'get_authenticated_user', inputSchema: { type: 'object' } },
        { name: 'list_project_members', inputSchema: { type: 'object' } },
        { name: 'find_work_items', inputSchema: { type: 'object' } },
      ];
    },
    async callTool(name, args, _signal, headers) {
      calls.push({ name, args, headers });
      const accountId = headers['x-mcp-user-id'] === 'application-user-a' ? 'plane-user-a' : 'plane-user-b';
      const payload = name === 'list_project_members' ? [{ id: accountId }]
        : name === 'find_work_items' ? []
          : { id: accountId };
      return { content: [{ type: 'text', text: JSON.stringify(payload) }] };
    },
  };
  const registry = new ToolRegistry(new Map([['plane', client]]), async (userId) => ({
    userId,
    externalUserId: userId === 'application-user-a' ? 'plane-user-a' : 'plane-user-b',
    credential: userId === 'application-user-a' ? 'credential-a' : 'credential-b',
    authType: 'pat', workspaceSlug: 'workspace-a', projectId: 'project-a',
  }));
  const service = new WorkManagementService(new PlaneWorkManagementProvider(registry));
  registry.setWorkManagementService(service);
  await registry.refresh(['plane']);
  const [a, b] = await Promise.all([
    registry.execute('get_my_tasks', {}, 'Get my Plane tasks', undefined, { userId: 'application-user-a', requestId: 'request-a' }),
    registry.execute('get_my_tasks', {}, 'Get my Plane tasks', undefined, { userId: 'application-user-b', requestId: 'request-b' }),
  ]);
  assert.equal(a.success, true); assert.equal(b.success, true);
  const findCalls = calls.filter((call) => call.name === 'find_work_items');
  assert.deepEqual(findCalls.map((call) => ({ userId: call.headers['x-mcp-user-id'], credential: call.headers['x-plane-credential'], assigneeId: call.args.assigneeId })).sort((x, y) => x.userId.localeCompare(y.userId)), [
    { userId: 'application-user-a', credential: 'credential-a', assigneeId: 'plane-user-a' },
    { userId: 'application-user-b', credential: 'credential-b', assigneeId: 'plane-user-b' },
  ]);
  assert.equal(findCalls.some((call) => call.headers['x-plane-api-key'] !== undefined), false);
});

test('Plane MCP structured API errors preserve OAuth scope, auth, and project codes', async () => {
  const client = {
    async listTools() { return [{ name: 'list_project_members', inputSchema: { type: 'object' } }]; },
    async callTool(_name, _args, _signal, headers) {
      const code = headers['x-request-id'] === '401' ? 'PLANE_AUTH_REQUIRED'
        : headers['x-request-id'] === '404' ? 'PLANE_PROJECT_NOT_FOUND'
          : 'PLANE_OAUTH_SCOPE_REQUIRED';
      return { content: [{ type: 'text', text: JSON.stringify({ error: { code, message: 'provider detail must not reach the user' } }) }] };
    },
  };
  const registry = new ToolRegistry(new Map([['plane', client]]), async (userId) => ({ userId, credential: 'oauth-token', authType: 'oauth', workspaceSlug: 'workspace-a', projectId: 'project-a' }));
  await registry.refresh(['plane']);
  for (const [requestId, code] of [['403', 'PLANE_OAUTH_SCOPE_REQUIRED'], ['401', 'PLANE_AUTH_REQUIRED'], ['404', 'PLANE_PROJECT_NOT_FOUND']]) {
    const result = await registry.execute('plane__list_project_members', {}, 'list members', undefined, { userId: 'user-a', requestId });
    assert.equal(result.success, false);
    assert.equal(result.error.code, code);
    assert.equal(result.error.message.includes('provider detail'), false);
  }
});

test('Plane state-list OAuth scope errors preserve projects.states:read instead of becoming unavailable', async () => {
  const client = {
    async listTools() { return [{ name: 'list_project_states', inputSchema: { type: 'object' } }]; },
    async callTool() {
      return { content: [{ type: 'text', text: JSON.stringify({ error: { code: 'PLANE_SCOPE_REQUIRED', requiredScope: 'projects.states:read' } }) }] };
    },
  };
  const registry = new ToolRegistry(new Map([['plane', client]]), async (userId) => ({ userId, credential: 'oauth-token', authType: 'oauth', workspaceSlug: 'maybaymcp', projectId: 'project-a' }));
  await registry.refresh(['plane']);
  const result = await registry.execute('plane__list_project_states', { projectId: 'project-a' }, 'list project states', undefined, { userId: 'user-a' });
  assert.deepEqual(result.error, { code: 'PLANE_SCOPE_REQUIRED', message: 'Plane OAuth needs projects.states:read. Reconnect Plane to grant the updated scope.', requiredScope: 'projects.states:read' });
});

test('get_project_statuses resolves the current user credential with plane.list_project_states', async () => {
  const resolveCalls = [];
  const registry = new ToolRegistry(new Map([['plane', { async listTools() { return []; } }]]), async (userId, tool) => {
    resolveCalls.push({ userId, tool });
    return { userId, externalUserId: 'plane-user-a', credential: 'oauth-token', authType: 'oauth', workspaceSlug: 'maybaymcp', projectId: 'project-a' };
  });
  registry.setWorkManagementService({ async getProjectStatuses() { return []; } });
  const result = await registry.execute('get_project_statuses', { projectId: 'project-a' }, 'get project statuses', undefined, { userId: 'user-a' });
  assert.equal(result.success, true);
  assert.deepEqual(resolveCalls, [{ userId: 'user-a', tool: { server: 'plane', remoteName: 'list_project_states' } }]);
});

test('get_project_statuses returns the states read requirement rather than PLANE_UNAVAILABLE', async () => {
  const client = {
    async listTools() { return [{ name: 'list_project_states', inputSchema: { type: 'object' } }]; },
    async callTool() { return { content: [{ type: 'text', text: JSON.stringify({ error: { code: 'PLANE_SCOPE_REQUIRED', requiredScope: 'projects.states:read' } }) }] }; },
  };
  const registry = new ToolRegistry(new Map([['plane', client]]), async (userId) => ({ userId, credential: 'oauth-token', authType: 'oauth', workspaceSlug: 'maybaymcp', projectId: 'project-a' }));
  registry.setWorkManagementService(new WorkManagementService(new PlaneWorkManagementProvider(registry)));
  await registry.refresh(['plane']);
  const result = await registry.execute('get_project_statuses', { projectId: 'project-a' }, 'get project statuses', undefined, { userId: 'user-a' });
  assert.deepEqual(result, { success: false, error: { code: 'PLANE_SCOPE_REQUIRED', message: 'Plane OAuth needs projects.states:read. Reconnect Plane to grant the updated scope.', requiredScope: 'projects.states:read' } });
});

test('OAuth execution context uses a generic credential header, never an API-key header', async () => {
  let headers;
  const client = { async listTools() { return [{ name: 'list_projects', inputSchema: { type: 'object' } }]; }, async callTool(_name, _args, _signal, value) { headers = value; return { content: [{ type: 'text', text: '[]' }] }; } };
  const registry = new ToolRegistry(new Map([['plane', client]]), async () => ({ userId: 'user-a', credential: 'oauth-token', authType: 'oauth', workspaceSlug: 'workspace-a', projectId: 'project-a' }));
  await registry.refresh(['plane']);
  assert.equal((await registry.execute('plane__list_projects', {}, 'list projects', undefined, { userId: 'user-a' })).success, true);
  assert.equal(headers['x-plane-credential'], 'oauth-token');
  assert.equal(headers['x-plane-api-key'], undefined);
  assert.equal(headers['x-plane-auth-type'], 'oauth');
});

test('resolved task project overrides only that user default project for a Plane mutation', async () => {
  const calls = [];
  const client = {
    async listTools() { return [{ name: 'update_work_item', inputSchema: { type: 'object' } }]; },
    async callTool(name, args, _signal, headers) { calls.push({ name, args, headers }); return { content: [{ type: 'text', text: '{"id":"task-b"}' }] }; },
  };
  const registry = new ToolRegistry(new Map([['plane', client]]), async (userId) => ({
    userId,
    credential: userId === 'user-a' ? 'credential-a' : 'credential-b',
    authType: 'oauth', workspaceSlug: userId === 'user-a' ? 'workspace-a' : 'workspace-b',
    projectId: userId === 'user-a' ? 'project-a' : 'project-b-default',
  }));
  await registry.refresh(['plane']);
  const result = await registry.execute('plane__update_work_item', { workItemId: 'task-b', newPriority: 'urgent' }, 'update task', undefined, {
    userId: 'user-b', requestId: 'request-b', planeEffectiveProjectId: 'project-b-actual',
  });
  assert.equal(result.success, true);
  assert.deepEqual(calls[0].headers['x-plane-project-id'], 'project-b-actual');
  assert.equal(calls[0].headers['x-plane-credential'], 'credential-b');
  assert.notEqual(calls[0].headers['x-plane-project-id'], 'project-a');
});

test('Plane state scope results and OAuth credentials remain isolated per user', async () => {
  const calls = [];
  const client = {
    async listTools() { return [{ name: 'list_project_states', inputSchema: { type: 'object' } }]; },
    async callTool(_name, _args, _signal, headers) {
      calls.push(headers);
      const payload = headers['x-mcp-user-id'] === 'user-a'
        ? { error: { code: 'PLANE_SCOPE_REQUIRED', requiredScope: 'projects.states:read' } }
        : [{ id: 'state-b', name: 'In Progress' }];
      return { content: [{ type: 'text', text: JSON.stringify(payload) }] };
    },
  };
  const registry = new ToolRegistry(new Map([['plane', client]]), async (userId) => ({
    userId, credential: `credential-${userId}`, authType: 'oauth', workspaceSlug: `workspace-${userId}`, projectId: `project-${userId}`,
  }));
  await registry.refresh(['plane']);
  const [a, b] = await Promise.all([
    registry.execute('plane__list_project_states', {}, 'list states', undefined, { userId: 'user-a' }),
    registry.execute('plane__list_project_states', {}, 'list states', undefined, { userId: 'user-b' }),
  ]);
  assert.deepEqual(a.error, { code: 'PLANE_SCOPE_REQUIRED', message: 'Plane OAuth needs projects.states:read. Reconnect Plane to grant the updated scope.', requiredScope: 'projects.states:read' });
  assert.equal(b.success, true);
  assert.deepEqual(calls.map((headers) => ({ userId: headers['x-mcp-user-id'], credential: headers['x-plane-credential'] })).sort((left, right) => left.userId.localeCompare(right.userId)), [
    { userId: 'user-a', credential: 'credential-user-a' }, { userId: 'user-b', credential: 'credential-user-b' },
  ]);
});

test('get_my_tasks stops at the Plane execution-context boundary when that user has no Plane integration', async () => {
  let serviceCalled = false; let mcpCalled = false;
  const registry = new ToolRegistry(new Map([['plane', {
    async listTools() { return []; },
    async callTool() { mcpCalled = true; return { content: [] }; },
  }]]), async () => { throw Object.assign(new Error('not connected'), { code: 'PLANE_NOT_CONNECTED' }); });
  registry.setWorkManagementService({ async getMyTasks() { serviceCalled = true; return []; } });
  const result = await registry.execute('get_my_tasks', {}, 'Get my Plane tasks', undefined, { userId: 'application-user-a', requestId: 'request-a' });
  assert.deepEqual(result, { success: false, error: { code: 'PLANE_NOT_CONNECTED', message: 'Plane account is not connected for this user.' } });
  assert.equal(serviceCalled, false);
  assert.equal(mcpCalled, false);
});

test('get_my_tasks returns PLANE_SCOPE_REQUIRED before any Plane MCP call when the user has no saved workspace/project scope', async () => {
  let serviceCalled = false; let mcpCalled = false;
  const registry = new ToolRegistry(new Map([['plane', {
    async listTools() { return []; },
    async callTool() { mcpCalled = true; return { content: [] }; },
  }]]), async () => { throw Object.assign(new Error('scope missing'), { code: 'PLANE_SCOPE_REQUIRED' }); });
  registry.setWorkManagementService({ async getMyTasks() { serviceCalled = true; return []; } });
  const result = await registry.execute('get_my_tasks', {}, 'Get my Plane tasks', undefined, { userId: 'application-user-a', requestId: 'request-a' });
  assert.deepEqual(result, { success: false, error: { code: 'PLANE_SCOPE_REQUIRED', message: 'Select a Plane workspace and project in Integration settings before using Plane tools.' } });
  assert.equal(serviceCalled, false);
  assert.equal(mcpCalled, false);
});

test('get_my_tasks returns PLANE_SCOPE_REQUIRED when only a workspace is saved', async () => {
  let serviceCalled = false; let mcpCalled = false;
  const registry = new ToolRegistry(new Map([['plane', {
    async listTools() { return []; },
    async callTool() { mcpCalled = true; return { content: [] }; },
  }]]), async () => { throw Object.assign(new Error('project missing'), { code: 'PLANE_SCOPE_REQUIRED' }); });
  registry.setWorkManagementService({ async getMyTasks() { serviceCalled = true; return []; } });
  const result = await registry.execute('get_my_tasks', {}, 'Get my Plane tasks', undefined, { userId: 'application-user-a', requestId: 'request-a' });
  assert.deepEqual(result, { success: false, error: { code: 'PLANE_SCOPE_REQUIRED', message: 'Select a Plane workspace and project in Integration settings before using Plane tools.' } });
  assert.equal(serviceCalled, false);
  assert.equal(mcpCalled, false);
});
