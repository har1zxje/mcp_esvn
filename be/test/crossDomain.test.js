import assert from 'node:assert/strict';
import test from 'node:test';

const { CrossDomainService } = await import('../src/crossDomain.js');

test('cross-domain overview composes trusted provider results without joining identities', async () => {
  const calls = [];
  const options = { executionContext: { userId: 'authenticated-user' } };
  const service = new CrossDomainService({
    async getProjectProgress(_criteria, received) { calls.push(received); return { totalTasks: 4, completedTasks: 2, progressPercent: 50 }; },
    async getTeamWorkload(_criteria, received) { calls.push(received); return [{ member: { id: 'plane:member-1' } }]; },
  }, {
    async listEmployees(received) { calls.push(received); return [{ id: 'mock-hrm:employee-1' }, { id: 'mock-hrm:employee-2' }]; },
    async getLeaveBalance(_employeeId, received) { calls.push(received); return { remainingDays: 5 }; },
    async getAttendance(_employeeId, received) { calls.push(received); return [{ id: 'attendance-1' }]; },
  });

  assert.deepEqual(await service.getWorkforceOverview(options), {
    work: { progress: { totalTasks: 4, completedTasks: 2, progressPercent: 50 }, assignedMemberCount: 1 },
    hrm: { employeeCount: 2, employeeWithLeaveDataCount: 2, attendanceRecordCount: 2 },
    identityMapping: 'not_available',
  });
  assert.equal(calls.every((received) => received === options), true);
});
