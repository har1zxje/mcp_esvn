import assert from 'node:assert/strict';
import test from 'node:test';

const { PlaneWorkManagementProvider, WorkManagementError, WorkManagementService } = await import('../src/workManagement.js');

function registryRecorder() {
  const calls = [];
  return {
    calls,
    registry: {
      async execute(name, args, userText, signal, executionContext) {
        calls.push({ name, args, userText, signal, executionContext });
        return { success: true, result: { content: [{ type: 'text', text: JSON.stringify({ id: 'work-1', name: 'provider result' }) }] } };
      },
    },
  };
}

test('Plane work-management adapter centralizes Plane MCP names and preserves trusted context', async () => {
  const { registry, calls } = registryRecorder();
  const service = new WorkManagementService(new PlaneWorkManagementProvider(registry));
  const context = { userId: 'authenticated-user', requestId: 'request-1' };

  await service.createTask({
    title: 'Prepare release', description: 'Acceptance criteria', dueDate: '2026-10-01',
    userId: 'model-controlled-user', projectId: 'model-controlled-project', accessToken: 'secret',
  }, { executionContext: context, userText: 'Create a task in Plane' });

  assert.deepEqual(calls, [{
    name: 'plane__create_work_item',
    args: {
      name: 'Prepare release', description: 'Acceptance criteria', stateId: undefined,
      priority: undefined, assigneeIds: undefined, labelIds: undefined,
      startDate: undefined, targetDate: '2026-10-01',
    },
    userText: 'Create a task in Plane', signal: undefined, executionContext: context,
  }]);
});

test('Plane work-management adapter resolves the task project before update and ignores model identity context', async () => {
  const calls = [];
  const registry = { async execute(name, args, userText, signal, executionContext) {
    calls.push({ name, args, userText, signal, executionContext });
    const payload = name === 'plane__list_projects'
      ? [{ id: 'project-a', name: 'A' }, { id: 'project-b', name: 'B' }]
      : name === 'plane__find_work_items'
        ? [{ id: 'task-1', project_id: 'project-b', name: 'Updated' }]
        : name === 'plane__list_project_states'
          ? [{ id: 'state-2', name: 'In Progress' }]
          : { id: 'task-1', project_id: 'project-b', name: 'Updated', state: { id: 'state-2', name: 'In Progress' } };
    return { success: true, result: { content: [{ type: 'text', text: JSON.stringify(payload) }] } };
  } };
  const service = new WorkManagementService(new PlaneWorkManagementProvider(registry));

  await service.updateTask('task-1', { projectId: 'plane:project-b', title: 'Updated', statusId: 'state-2', userId: 'spoofed-user' }, {
    executionContext: { userId: 'authenticated-user' },
  });

  const update = calls.at(-1);
  assert.deepEqual(calls.map((call) => call.name), ['plane__list_projects', 'plane__find_work_items', 'plane__list_project_states', 'plane__update_work_item']);
  assert.equal(update.executionContext.userId, 'authenticated-user');
  assert.equal(update.executionContext.planeEffectiveProjectId, 'project-b');
  assert.deepEqual(update.args, {
    workItemId: 'task-1', newName: 'Updated', newDescription: undefined,
    newStateId: 'state-2', newPriority: undefined, newAssigneeIds: undefined,
    newLabelIds: undefined, newStartDate: undefined, newTargetDate: undefined,
  });
});

test('task/project mismatch is rejected before mutation and task-only updates search accessible projects', async () => {
  const calls = [];
  const registry = { async execute(name, args, _text, _signal, context) {
    calls.push({ name, args, context });
    if (name === 'plane__list_projects') return { success: true, result: { content: [{ type: 'text', text: JSON.stringify([{ id: 'project-a' }, { id: 'project-b' }]) }] } };
    if (name === 'plane__find_work_items') {
      const match = context.planeEffectiveProjectId === 'project-b' ? [{ id: 'task-b', project_id: 'project-b', name: 'B' }] : [];
      return { success: true, result: { content: [{ type: 'text', text: JSON.stringify(match) }] } };
    }
    return { success: true, result: { content: [{ type: 'text', text: JSON.stringify({ id: 'task-b', project_id: 'project-b', name: 'B' }) }] } };
  } };
  const service = new WorkManagementService(new PlaneWorkManagementProvider(registry));
  await service.updateTask('task-b', { priority: 'urgent' }, { executionContext: { userId: 'user-b' } });
  assert.equal(calls.at(-1).name, 'plane__update_work_item');
  assert.equal(calls.at(-1).context.planeEffectiveProjectId, 'project-b');
  const beforeMismatch = calls.length;
  await assert.rejects(
    service.updateTask('task-b', { projectId: 'project-a', priority: 'urgent' }, { executionContext: { userId: 'user-b' } }),
    (error) => error.code === 'PLANE_WORK_ITEM_NOT_FOUND',
  );
  assert.equal(calls.slice(beforeMismatch).some((call) => call.name === 'plane__update_work_item'), false);
});

test('delete resolves and retains the work-item project context', async () => {
  const calls = [];
  const registry = { async execute(name, args, _text, _signal, context) {
    calls.push({ name, args, context });
    const payload = name === 'plane__list_projects' ? [{ id: 'project-b' }]
      : name === 'plane__find_work_items' ? [{ id: 'task-b', project_id: 'project-b', name: 'B' }]
        : { success: true, workItemId: 'task-b' };
    return { success: true, result: { content: [{ type: 'text', text: JSON.stringify(payload) }] } };
  } };
  const service = new WorkManagementService(new PlaneWorkManagementProvider(registry));
  await service.deleteTask('task-b', { projectId: 'project-b' }, { executionContext: { userId: 'user-b' } });
  assert.equal(calls.at(-1).name, 'plane__delete_work_item');
  assert.equal(calls.at(-1).context.planeEffectiveProjectId, 'project-b');
  assert.deepEqual(calls.at(-1).args, { workItemId: 'task-b', confirm: true, confirmationPhrase: 'DELETE' });
});

test('state lookup fails fast on missing OAuth scope and never calls update', async () => {
  const calls = [];
  const registry = { async execute(name, args, _text, _signal, context) {
    calls.push({ name, args, context });
    if (name === 'plane__list_projects') return { success: true, result: { content: [{ type: 'text', text: '[{"id":"project-b"}]' }] } };
    if (name === 'plane__find_work_items') return { success: true, result: { content: [{ type: 'text', text: '[{"id":"task-b","project_id":"project-b","name":"B"}]' }] } };
    if (name === 'plane__list_project_states') return { success: false, error: { code: 'PLANE_SCOPE_REQUIRED', message: 'Plane OAuth needs projects.states:read.', requiredScope: 'projects.states:read' } };
    throw new Error(`Unexpected ${name}`);
  } };
  const service = new WorkManagementService(new PlaneWorkManagementProvider(registry));
  await assert.rejects(
    service.updateTask('task-b', { projectId: 'project-b', statusId: 'In Progress' }, { executionContext: { userId: 'user-b' } }),
    (error) => error.code === 'PLANE_SCOPE_REQUIRED' && error.requiredScope === 'projects.states:read',
  );
  assert.equal(calls.some((call) => call.name === 'plane__update_work_item'), false);
});

test('status labels resolve to the exact Plane state ID and updated state is verified', async () => {
  const calls = [];
  let verificationRead = false;
  const registry = { async execute(name, args, _text, _signal, context) {
    calls.push({ name, args, context });
    if (name === 'plane__list_projects') return { success: true, result: { content: [{ type: 'text', text: '[{"id":"project-b"}]' }] } };
    if (name === 'plane__list_project_states') return { success: true, result: { content: [{ type: 'text', text: '[{"id":"state-progress","name":"Đang thực hiện"},{"id":"state-done","name":"Done"}]' }] } };
    if (name === 'plane__find_work_items') {
      const state = verificationRead ? { id: 'state-progress', name: 'Đang thực hiện' } : { id: 'state-todo', name: 'Todo' };
      verificationRead = true;
      return { success: true, result: { content: [{ type: 'text', text: JSON.stringify([{ id: 'task-b', project_id: 'project-b', name: 'B', state }]) }] } };
    }
    if (name === 'plane__update_work_item') return { success: true, result: { content: [{ type: 'text', text: JSON.stringify({ id: 'task-b', project_id: 'project-b', name: 'B', state: { id: 'state-todo', name: 'Todo' } }) }] } };
    throw new Error(`Unexpected ${name}`);
  } };
  const service = new WorkManagementService(new PlaneWorkManagementProvider(registry));
  await service.updateTask('task-b', { projectId: 'project-b', statusId: 'In Progress' }, { executionContext: { userId: 'user-b' } });
  await service.updateTask('task-b', { projectId: 'project-b', statusId: 'đang thực hiện' }, { executionContext: { userId: 'user-b' } });
  const updates = calls.filter((call) => call.name === 'plane__update_work_item');
  assert.deepEqual(updates.map((call) => call.args.newStateId), ['state-progress', 'state-progress']);
  assert.equal(calls.filter((call) => call.name === 'plane__find_work_items').length, 4);
});

test('Vietnamese active-work aliases resolve from a live Plane name or group without UUID hard-coding', async () => {
  const calls = [];
  const registry = { async execute(name, args, _text, _signal, context) {
    calls.push({ name, args, context });
    const payload = name === 'plane__list_projects' ? [{ id: 'project-a' }]
      : name === 'plane__find_work_items' ? [{ id: 'work-nau-com', project_id: 'project-a', name: 'nau com', state: { id: 'state-todo', name: 'Todo' } }]
        : name === 'plane__list_project_states' ? [
          { id: 'state-todo', name: 'Todo', group: 'backlog' },
          { id: 'state-active', name: 'Custom active', group: 'started' },
        ]
          : { id: 'work-nau-com', project_id: 'project-a', name: 'nau com', state: { id: 'state-active', name: 'Custom active' } };
    return { success: true, result: { content: [{ type: 'text', text: JSON.stringify(payload) }] } };
  } };
  const service = new WorkManagementService(new PlaneWorkManagementProvider(registry));
  await service.updateTask('work-nau-com', { projectId: 'project-a', statusId: 'đang làm' }, { executionContext: { userId: 'user-a' } });
  const updates = calls.filter((call) => call.name === 'plane__update_work_item');
  assert.equal(updates.length, 1);
  assert.equal(updates[0].args.newStateId, 'state-active');
});

test('a state update is not reported successful when post-update verification disagrees', async () => {
  const calls = [];
  const registry = { async execute(name, _args, _text, _signal, context) {
    calls.push({ name, context });
    const payload = name === 'plane__list_projects' ? [{ id: 'project-b' }]
      : name === 'plane__list_project_states' ? [{ id: 'state-progress', name: 'In Progress' }]
        : name === 'plane__find_work_items' ? [{ id: 'task-b', project_id: 'project-b', name: 'B', state: { id: 'state-todo', name: 'Todo' } }]
          : { id: 'task-b', project_id: 'project-b', name: 'B', state: { id: 'state-todo', name: 'Todo' } };
    return { success: true, result: { content: [{ type: 'text', text: JSON.stringify(payload) }] } };
  } };
  const service = new WorkManagementService(new PlaneWorkManagementProvider(registry));
  await assert.rejects(
    service.updateTask('task-b', { projectId: 'project-b', statusId: 'In Progress' }, { executionContext: { userId: 'user-b' } }),
    (error) => error.code === 'WORK_STATUS_UPDATE_UNVERIFIED',
  );
  assert.equal(calls.some((call) => call.name === 'plane__update_work_item'), true);
});

test('work-management provider fails closed without authenticated execution context', async () => {
  const { registry, calls } = registryRecorder();
  const service = new WorkManagementService(new PlaneWorkManagementProvider(registry));

  await assert.rejects(
    service.getTasks({ name: 'task' }),
    (error) => error instanceof WorkManagementError && error.code === 'WORK_CONTEXT_INVALID',
  );
  assert.equal(calls.length, 0);
});

test('work-management provider retains safe provider errors', async () => {
  const registry = { async execute() { return { success: false, error: { code: 'PLANE_NOT_CONNECTED', message: 'Plane account is not connected for this user.' } }; } };
  const service = new WorkManagementService(new PlaneWorkManagementProvider(registry));
  await assert.rejects(
    service.getTasks({ name: 'task' }, { executionContext: { userId: 'authenticated-user' } }),
    (error) => error instanceof WorkManagementError && error.code === 'PLANE_NOT_CONNECTED' && error.message === 'Plane account is not connected for this user.',
  );
});

test('work-management service resolves my tasks through the trusted Plane member mapping', async () => {
  let criteria; let receivedOptions;
  const service = new WorkManagementService({
    async resolveMyMember(options) { receivedOptions = options; return 'plane-member-1'; },
    async findTasks(value) { criteria = value; return []; },
  });
  await service.getMyTasks({ userId: 'spoofed-user' }, { executionContext: { userId: 'app-user', planeAccountUserId: 'plane-account-1' } });
  assert.deepEqual(criteria, { userId: 'spoofed-user', assigneeId: 'plane-member-1' });
  assert.equal(receivedOptions.executionContext.planeAccountUserId, 'plane-account-1');
  const serviceWithoutIdentityResolver = new WorkManagementService({ async findTasks() { return []; } });
  await assert.rejects(
    serviceWithoutIdentityResolver.getMyTasks({}, { executionContext: { userId: 'app-user' } }),
    (error) => error.code === 'PLANE_IDENTITY_NOT_RESOLVED',
  );
});

test('Plane provider uses each authenticated account UUID directly before filtering tasks', async () => {
  const calls = [];
  const registry = {
    async execute(name, args, _userText, _signal, context) {
      calls.push({ name, args, context });
      if (name === 'plane__find_work_items') return { success: true, result: { content: [{ type: 'text', text: '[]' }] } };
      throw new Error(`Unexpected tool ${name}`);
    },
  };
  const service = new WorkManagementService(new PlaneWorkManagementProvider(registry));
  await Promise.all([
    service.getMyTasks({}, { executionContext: { userId: 'application-user-a', planeAccountUserId: 'plane-member-a' } }),
    service.getMyTasks({}, { executionContext: { userId: 'application-user-b', planeAccountUserId: 'plane-member-b' } }),
  ]);
  const findCalls = calls.filter((call) => call.name === 'plane__find_work_items');
  assert.deepEqual(findCalls.map((call) => ({ userId: call.context.userId, assigneeId: call.args.assigneeId })).sort((a, b) => a.userId.localeCompare(b.userId)), [
    { userId: 'application-user-a', assigneeId: 'plane-member-a' },
    { userId: 'application-user-b', assigneeId: 'plane-member-b' },
  ]);
  assert.equal(findCalls.some((call) => call.args.assigneeId === call.context.userId), false);
  assert.equal(calls.some((call) => call.name === 'plane__list_project_members'), false);
});

test('Plane provider resolves a missing stored account identity from Plane before filtering tasks', async () => {
  const calls = [];
  const registry = {
    async execute(name, args, _userText, _signal, context) {
      calls.push({ name, args, context });
      const payload = name === 'plane__get_authenticated_user' ? { id: 'plane-account-a' } : [];
      return { success: true, result: { content: [{ type: 'text', text: JSON.stringify(payload) }] } };
    },
  };
  const service = new WorkManagementService(new PlaneWorkManagementProvider(registry));
  await service.getMyTasks({}, { executionContext: { userId: 'application-user-a' } });
  assert.deepEqual(calls.map((call) => call.name), ['plane__get_authenticated_user', 'plane__find_work_items']);
  assert.equal(calls[1].args.assigneeId, 'plane-account-a');
});

test('work-management service derives overdue, progress, and workload without provider fields', async () => {
  const tasks = [
    { id: 'plane:1', dueDate: '2020-01-01', status: { category: 'started' }, assignees: [{ id: 'plane:ada', name: 'Ada' }] },
    { id: 'plane:2', dueDate: '2020-01-01', status: { category: 'completed' }, assignees: [{ id: 'plane:ada', name: 'Ada' }] },
  ];
  const service = new WorkManagementService({ async findTasks() { return tasks; } });
  const options = { executionContext: { userId: 'app-user' } };
  assert.equal((await service.getOverdueTasks({}, options)).length, 1);
  assert.deepEqual(await service.getProjectProgress({}, options), { totalTasks: 2, completedTasks: 1, progressPercent: 50 });
  assert.deepEqual(await service.getTeamWorkload({}, options), [{ member: { id: 'plane:ada', name: 'Ada' }, taskCount: 2, overdueTaskCount: 1 }]);
});
