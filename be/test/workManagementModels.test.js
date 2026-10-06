import assert from 'node:assert/strict';
import test from 'node:test';

const { WorkManagementModelError, assignmentFromPlaneAssignee, memberFromPlaneMember, membersFromPlaneMcpResult, projectFromPlaneProject, projectsFromPlaneMcpResult, statusesFromPlaneMcpResult, taskFromPlaneWorkItem, tasksFromPlaneMcpResult } = await import('../src/workManagementModels.js');

test('maps a Plane work item into the provider-neutral task model', () => {
  const task = taskFromPlaneWorkItem({
    id: 'work-1', project_id: 'project-1', name: 'Ship release',
    description_stripped: 'Release notes', priority: 'HIGH', start_date: '2026-09-25', target_date: '2026-10-01',
    state: { id: 'state-1', name: 'In progress', group: 'started' },
    assignees: [{ id: 'member-1', display_name: 'Ada', email: 'ada@example.test' }, 'member-2'],
  });

  assert.deepEqual(task, {
    id: 'plane:work-1', externalId: 'work-1', provider: 'plane',
    projectId: 'plane:project-1', externalProjectId: 'project-1',
    title: 'Ship release', description: 'Release notes', priority: 'high',
    startDate: '2026-09-25', dueDate: '2026-10-01', createdAt: null, updatedAt: null,
    status: { id: 'plane:state-1', externalId: 'state-1', name: 'In progress', category: 'started' },
    assignees: [
      { id: 'plane:member-1', externalId: 'member-1', name: 'Ada', email: 'ada@example.test' },
      { id: 'plane:member-2', externalId: 'member-2', name: null, email: null },
    ],
  });
});

test('normalizes standalone project, member, and assignment models', () => {
  assert.deepEqual(projectFromPlaneProject({ id: 'project-1', name: 'Platform' }), {
    id: 'plane:project-1', externalId: 'project-1', provider: 'plane', name: 'Platform',
    description: null, status: null, startDate: null, dueDate: null,
  });
  assert.deepEqual(memberFromPlaneMember({ id: 'member-1', username: 'Ada' }), {
    id: 'plane:member-1', externalId: 'member-1', name: 'Ada', email: null, provider: 'plane',
  });
  assert.deepEqual(assignmentFromPlaneAssignee('member-1', 'task-1'), {
    id: 'plane:task-1:member-1', provider: 'plane', taskId: 'plane:task-1', externalTaskId: 'task-1',
    memberId: 'plane:member-1', externalMemberId: 'member-1',
  });
});

test('maps an MCP text response without leaking the Plane response shape', () => {
  const tasks = tasksFromPlaneMcpResult({ content: [{ type: 'text', text: JSON.stringify([{ id: 'work-1', name: 'Task', priority: 'unsupported' }]) }] });
  assert.equal(tasks.length, 1);
  assert.equal(tasks[0].id, 'plane:work-1');
  assert.equal(tasks[0].priority, 'none');
  assert.equal(Object.hasOwn(tasks[0], 'description_html'), false);
});

test('maps Plane discovery responses to neutral projects, members, and statuses', () => {
  const response = (payload) => ({ content: [{ type: 'text', text: JSON.stringify(payload) }] });
  assert.equal(projectsFromPlaneMcpResult(response({ results: [{ id: 'project-1', name: 'Platform' }] }))[0].id, 'plane:project-1');
  assert.equal(membersFromPlaneMcpResult(response([{ id: 'member-1', display_name: 'Ada' }]))[0].provider, 'plane');
  assert.deepEqual(statusesFromPlaneMcpResult(response({ results: [{ id: 'state-1', name: 'Done', group: 'completed' }] }))[0], {
    id: 'plane:state-1', externalId: 'state-1', name: 'Done', category: 'completed', provider: 'plane',
  });
});

test('rejects malformed provider response data safely', () => {
  assert.throws(
    () => tasksFromPlaneMcpResult({ content: [{ type: 'text', text: '{not-json' }] }),
    (error) => error instanceof WorkManagementModelError && error.code === 'WORK_PROVIDER_INVALID_RESPONSE',
  );
});
