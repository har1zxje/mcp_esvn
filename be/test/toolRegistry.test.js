import assert from 'node:assert/strict';
import test from 'node:test';

const { ToolRegistry } = await import('../src/toolRegistry.js');

test('HRM learning mode preserves the runtime MCP catalog for the backend and Agent', async () => {
  const runtimeNames = [
    'create_leave_request', 'get_employee_leave_requests', 'get_department_members',
    'search_employees', 'list_project_tasks', 'get_employee_profile',
    'update_task_status', 'list_departments', 'get_employee_attendance',
    'list_projects', 'list_employees',
  ];
  const client = { listTools: async () => runtimeNames.map((name) => ({ name, description: name, inputSchema: { type: 'object', properties: {} } })) };
  const registry = new ToolRegistry(new Map([['hrm', client]]), async (userId) => {
    assert.equal(userId, 'authenticated-user');
    return { userId, companyId: 'company-a' };
  });

  await registry.refresh(null, undefined, { userId: 'authenticated-user', requestId: 'request-a' });

  assert.deepEqual([...registry.tools.values()].map((tool) => tool.remoteName), runtimeNames);
  assert.deepEqual(registry.definitions().map((tool) => tool.name), runtimeNames.map((name) => `hrm__${name}`));
});

test('DQE polymorphic filter value reaches Gemini as scalar or array', async () => {
  const inputSchema = { type: 'object', properties: { query: { type: 'object', properties: {
    dataset: { type: 'string', enum: ['employees', 'attendance_records', 'leave_requests'] },
    filters: { type: 'array', items: { type: 'object', properties: { value: { description: 'Filter value' } } } },
  }, required: ['dataset'] } }, required: ['query'] };
  const registry = new ToolRegistry(new Map([['hrm', { listTools: async () => [{ name: 'query_hrm_data', inputSchema }] }]]), async (userId) => ({ userId, companyId: 'fixture-company' }));
  await registry.refresh(['hrm'], undefined, { userId: 'fixture-user', requestId: 'fixture-request' });
  const parameters = registry.definitions()[0].parameters;
  assert.deepEqual(parameters.properties.query.properties.dataset.enum, ['employees', 'attendance_records', 'leave_requests']);
  assert.deepEqual(parameters.properties.query.properties.filters.items.properties.value.anyOf.map((item) => item.type), ['STRING', 'NUMBER', 'ARRAY', 'ARRAY']);
  assert.equal(parameters.properties.query.properties.filters.items.properties.value.type, undefined);
});
