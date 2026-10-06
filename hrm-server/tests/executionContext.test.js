import assert from 'node:assert/strict';
import test from 'node:test';
import { toHrmExecutionContext } from '../src/services.js';

test('HrmExecutionContext contains only HRM-resolved actor data and a server request id', () => {
  const context = toHrmExecutionContext({
    chatUserId: 'application-user-a',
    employeeId: 'employee-a',
    companyId: 'company-a',
    departmentId: 'department-a',
    roles: ['MANAGER'],
    permissions: ['employee.profile.read.team'],
  }, 'request-a');

  assert.deepEqual(context, {
    userId: 'application-user-a',
    employeeId: 'employee-a',
    companyId: 'company-a',
    departmentId: 'department-a',
    roles: ['MANAGER'],
    permissions: ['employee.profile.read.team'],
    requestId: 'request-a',
  });
  assert.equal(Object.isFrozen(context), true);
  assert.equal(Object.isFrozen(context.roles), true);
  assert.equal(Object.isFrozen(context.permissions), true);
});
