import assert from 'node:assert/strict';
import test from 'node:test';

const { AgentService } = await import('../src/agentService.js');

test('HRM employee-name lookup searches first and then fetches the resolved profile ID', async () => {
  const calls = [];
  let generation = 0;
  const registry = {
    async refresh() {},
    definitions() { return [{ name: 'hrm__search_employees' }, { name: 'hrm__get_employee_profile' }]; },
    async execute(name, args) {
      calls.push({ name, args });
      if (name === 'hrm__search_employees') return { success: true, result: { content: [{ type: 'text', text: JSON.stringify({ data: [{ id: 'employee-a1', displayName: 'Nguyễn Minh Anh' }] }) }] } };
      if (name === 'hrm__get_employee_profile') return { success: true, result: { content: [{ type: 'text', text: JSON.stringify({ data: { id: 'employee-a1', displayName: 'Nguyễn Minh Anh' } }) }] } };
      throw new Error(`Unexpected tool ${name}`);
    },
  };
  const gemini = {
    async generate() {
      generation += 1;
      if (generation === 1) return { content: { parts: [] }, text: '', toolCalls: [{ name: 'hrm__search_employees', args: { query: 'Nguyễn Minh Anh' } }] };
      if (generation === 2) return { content: { parts: [] }, text: '', toolCalls: [{ name: 'hrm__get_employee_profile', args: { employeeId: 'employee-a1' } }] };
      return { content: { parts: [] }, text: 'Nguyễn Minh Anh is the matching employee.', toolCalls: [] };
    },
  };
  const agent = new AgentService(registry, gemini);
  const result = await agent.run({ id: 'conversation-search', messages: [{ role: 'user', text: 'Cho tôi thông tin Nguyễn Minh Anh' }] }, { model: 'test', mcpServers: ['hrm'] });
  assert.equal(result.text, 'Nguyễn Minh Anh is the matching employee.');
  assert.deepEqual(calls, [
    { name: 'hrm__search_employees', args: { query: 'Nguyễn Minh Anh' } },
    { name: 'hrm__get_employee_profile', args: { employeeId: 'employee-a1' } },
  ]);
});

test('HRM leave preview ends the turn with server-issued safe preview and exact confirmation phrase', async () => {
  const calls = [];
  const generateCalls = [];
  const confirmationId = 'c3878fd3-d230-4eb2-b2c3-2b39e90f948e';
  const registry = {
    async refresh() {},
    definitions() { return [{ name: 'hrm__preview_my_leave_request' }]; },
    async execute(name, args, _text, _signal, executionContext) {
      calls.push({ name, args, executionContext });
      return {
        success: true,
        result: {
          confirmationRequired: true,
          preview: {
            leaveTypeCode: 'ANNUAL', leaveTypeName: 'Annual leave', startDate: '2026-10-01', endDate: '2026-10-02',
            requestedDays: 2, reason: null, remainingDaysBefore: 12, remainingDaysAfter: 10, hasConflict: false,
            employeeId: 'must-not-be-shown', companyId: 'must-not-be-shown', internalToken: 'must-not-be-shown',
          },
          confirmation: { id: confirmationId, instruction: 'model-must-not-rewrite-this' },
        },
      };
    },
  };
  const gemini = {
    async generate(input) {
      generateCalls.push(input);
      return {
        content: { parts: [] }, text: 'This must not be used after the preview.',
        toolCalls: [{ name: 'hrm__preview_my_leave_request', args: { leaveTypeCode: 'ANNUAL', startDate: '2026-10-01', endDate: '2026-10-02', requestedDays: 2 } }],
      };
    },
  };
  const agent = new AgentService(registry, gemini);
  const executionContext = { userId: 'user-a', companyId: 'spoofed-company', conversationId: 'conversation-a', requestId: 'request-a' };
  const result = await agent.run({
    id: 'conversation-a', messages: [{ role: 'user', text: 'Preview annual leave.' }],
  }, { model: 'test', mcpServers: ['hrm'] }, undefined, undefined, executionContext);

  assert.equal(generateCalls.length, 1);
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].executionContext, executionContext);
  assert.match(result.text, /"leaveTypeCode":"ANNUAL"/u);
  assert.match(result.text, new RegExp(`CONFIRM ${confirmationId}$`, 'u'));
  assert.doesNotMatch(result.text, /must-not-be-shown/u);
  assert.doesNotMatch(result.text, /This must not be used/u);
});

test('status-change completion guard resolves a Vietnamese active state and calls update_task exactly once', async () => {
  const calls = [];
  const registry = {
    async refresh() {},
    definitions() { return []; },
    async execute(name, args) {
      calls.push({ name, args });
      if (name === 'get_projects') return { success: true, result: [{ externalId: 'project-a', name: 'Kitchen' }] };
      if (name === 'get_project_tasks') return {
        success: true,
        result: [{ externalId: 'work-nau-com', externalProjectId: 'project-a', title: 'nau com' }],
      };
      if (name === 'get_project_statuses') return {
        success: true,
        result: [
          { externalId: 'state-todo', name: 'Todo', category: 'backlog' },
          { externalId: 'state-progress', name: 'In Progress', category: 'started' },
        ],
      };
      if (name === 'update_task') return { success: true, result: { externalId: 'work-nau-com', status: { externalId: 'state-progress' } } };
      throw new Error(`Unexpected tool ${name}`);
    },
  };
  let generation = 0;
  const gemini = {
    async generate() {
      generation += 1;
      if (generation === 1) return { content: { parts: [] }, text: '', toolCalls: [{ name: 'get_projects', args: {} }] };
      if (generation === 2) return { content: { parts: [] }, text: '', toolCalls: [{ name: 'get_project_tasks', args: { name: 'nau com' } }] };
      if (generation === 3) return { content: { parts: [] }, text: '', toolCalls: [{ name: 'get_project_statuses', args: { projectId: 'project-a' } }] };
      return { content: { parts: [] }, text: 'The state was found.', toolCalls: [] };
    },
  };
  const agent = new AgentService(registry, gemini);
  const result = await agent.run({
    id: 'conversation-a',
    messages: [{ role: 'user', text: 'đổi trạng thái nau com sang đang thực hiện' }],
  }, { model: 'test', mcpServers: ['plane'] }, undefined, undefined, { userId: 'user-a', requestId: 'request-a' });

  assert.match(result.text, /Đã đổi trạng thái/u);
  assert.deepEqual(calls.map((call) => call.name), ['get_projects', 'get_project_tasks', 'get_project_statuses', 'update_task']);
  const updates = calls.filter((call) => call.name === 'update_task');
  assert.equal(updates.length, 1);
  assert.deepEqual(updates[0].args, { taskId: 'work-nau-com', projectId: 'project-a', statusId: 'state-progress' });
});
