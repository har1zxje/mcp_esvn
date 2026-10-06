import assert from 'node:assert/strict';
import test from 'node:test';
import { HrmDomainError, HrmService } from '../src/services.js';

const actors = new Map([
  ['10000000-0000-4000-8000-0000000000a1', { chatUserId: '10000000-0000-4000-8000-0000000000a1', employeeId: 'hrm-test-employee-a1', companyId: 'hrm-test-company-a', departmentId: 'hrm-test-department-a', roles: ['HRM_TEST_MANAGER'], permissions: ['employee.profile.read.self', 'employee.profile.read.team', 'employee.profile.read.any'] }],
  ['10000000-0000-4000-8000-0000000000a2', { chatUserId: '10000000-0000-4000-8000-0000000000a2', employeeId: 'hrm-test-employee-a2', companyId: 'hrm-test-company-a', departmentId: 'hrm-test-department-a', roles: ['HRM_TEST_EMPLOYEE'], permissions: ['employee.profile.read.self'] }],
  ['20000000-0000-4000-8000-0000000000b1', { chatUserId: '20000000-0000-4000-8000-0000000000b1', employeeId: 'hrm-test-employee-b1', companyId: 'hrm-test-company-b', departmentId: 'hrm-test-department-b', roles: ['HRM_TEST_MANAGER'], permissions: ['employee.profile.read.self', 'employee.profile.read.team', 'employee.profile.read.any'] }],
  ['20000000-0000-4000-8000-0000000000b2', { chatUserId: '20000000-0000-4000-8000-0000000000b2', employeeId: 'hrm-test-employee-b2', companyId: 'hrm-test-company-b', departmentId: 'hrm-test-department-b', roles: ['HRM_TEST_EMPLOYEE'], permissions: ['employee.profile.read.self'] }],
]);

function service() {
  return Object.assign(Object.create(HrmService.prototype), {
    authorization: {
      async resolveActor(userId) { return actors.get(userId) ?? null; },
    },
    departments: {
      async listLearningDepartments() { return [{ id: 'hrm-test-department-a' }]; },
      async getLearningById(_companyId, id) { return id === 'hrm-test-department-a' ? { id } : null; },
      async listLearningMembers() { return [{ id: 'hrm-test-employee-a1' }]; },
    },
  });
}

test('four explicit fixture identities resolve only to their own employee, company, and role', async () => {
  const subject = service();
  for (const actor of actors.values()) {
    const context = await subject.resolveExecutionContext(actor.chatUserId, 'authorization-test');
    assert.equal(context.employeeId, actor.employeeId);
    assert.equal(context.companyId, actor.companyId);
    assert.deepEqual(context.roles, actor.roles);
  }
});

test('manager may read company employees, employees and cross-company callers are denied', async () => {
  const subject = service();
  const manager = await subject.resolveExecutionContext('10000000-0000-4000-8000-0000000000a1', 'authorization-test');
  const employee = await subject.resolveExecutionContext('10000000-0000-4000-8000-0000000000a2', 'authorization-test');
  assert.doesNotThrow(() => subject.requirePermission(manager, 'employee.profile.read.any'));
  assert.throws(() => subject.requirePermission(employee, 'employee.profile.read.any'), (error) => error instanceof HrmDomainError && error.code === 'HRM_FORBIDDEN');
  assert.equal(employee.companyId, 'hrm-test-company-a');
});

test('a chat user with no HRM identity mapping fails closed', async () => {
  await assert.rejects(service().resolveExecutionContext('30000000-0000-4000-8000-0000000000ff', 'authorization-test'), (error) => error.code === 'HRM_IDENTITY_NOT_LINKED');
});

test('an employee cannot enumerate company departments or department members through learning routes', async () => {
  const subject = service();
  const manager = await subject.resolveExecutionContext('10000000-0000-4000-8000-0000000000a1', 'authorization-test');
  const employee = await subject.resolveExecutionContext('10000000-0000-4000-8000-0000000000a2', 'authorization-test');
  await assert.rejects(subject.listLearningDepartments(employee), (error) => error instanceof HrmDomainError && error.code === 'HRM_FORBIDDEN');
  await assert.rejects(subject.getLearningDepartmentMembers(employee, 'hrm-test-department-a'), (error) => error instanceof HrmDomainError && error.code === 'HRM_FORBIDDEN');
  assert.deepEqual(await subject.listLearningDepartments(manager), [{ id: 'hrm-test-department-a' }]);
  assert.deepEqual(await subject.getLearningDepartmentMembers(manager, 'hrm-test-department-a'), [{ id: 'hrm-test-employee-a1' }]);
});

test('identity-link provisioning requires organization permission and writes only the actor company', async () => {
  const writes = [];
  const manager = actors.get('10000000-0000-4000-8000-0000000000a1');
  const subject = Object.assign(Object.create(HrmService.prototype), {
    db: { async transaction(work) { return work({}); } },
    employees: { async getById(companyId, employeeId) { return companyId === 'hrm-test-company-a' && employeeId === 'hrm-test-employee-a2' ? { id: employeeId } : null; } },
    identityLinks: { constructor: class { async upsert(companyId, userId, employeeId) { writes.push({ companyId, userId, employeeId }); return { companyId, userId, employeeId }; } } },
    audit: { constructor: class { async append() {} } },
  });
  const context = { ...manager, userId: manager.chatUserId, permissions: [...manager.permissions, 'organization.manage'], requestId: 'identity-link-test' };
  assert.deepEqual(await subject.linkIdentity(context, '30000000-0000-4000-8000-0000000000ff', { employeeId: 'hrm-test-employee-a2' }), { companyId: 'hrm-test-company-a', userId: '30000000-0000-4000-8000-0000000000ff', employeeId: 'hrm-test-employee-a2' });
  assert.deepEqual(writes, [{ companyId: 'hrm-test-company-a', userId: '30000000-0000-4000-8000-0000000000ff', employeeId: 'hrm-test-employee-a2' }]);
  await assert.rejects(subject.linkIdentity({ ...context, permissions: [] }, '30000000-0000-4000-8000-0000000000ff', { employeeId: 'hrm-test-employee-a2' }), (error) => error.code === 'HRM_FORBIDDEN');
  await assert.rejects(subject.linkIdentity(context, '30000000-0000-4000-8000-0000000000ff', { employeeId: 'foreign-employee' }), (error) => error.code === 'HRM_NOT_FOUND');
});
