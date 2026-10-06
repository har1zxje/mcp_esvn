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
