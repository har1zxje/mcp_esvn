import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer } from '../src/app.js';
import { HrmDomainError } from '../src/services.js';

const company = { id: 'company-a', name: 'Company A', code: 'COMPANY-A' };
const employee = { id: 'employee-a', companyId: 'company-a', displayName: 'Employee A', email: 'employee.a@example.test', title: 'Builder', employmentStatus: 'active', departmentId: null, positionId: null };
const service = {
  async resolveExecutionContext() { return { userId: 'chat-user-a', chatUserId: 'chat-user-a', employeeId: 'employee-a', companyId: 'company-a', departmentId: 'department-a', roles: ['ADMIN'], permissions: ['organization.manage', 'employee.profile.read.self', 'employee.profile.read.team', 'employee.profile.read.any', 'attendance.read.self', 'attendance.read.team', 'leave.request.self'], requestId: 'request-123' }; },
  requirePermission(actor, permission) { if (!actor.permissions.includes(permission)) { const error = new Error('forbidden'); error.code = 'HRM_FORBIDDEN'; error.statusCode = 403; throw error; } },
  async getCompany() { return company; }, async createCompany(input) { return input; }, async updateCompany(_id, input) { return { ...company, ...input }; }, async deleteCompany() {},
  async listEmployees() { return [employee]; }, async getEmployee() { return employee; }, async getEmployeeProfile() { return { id: employee.id, displayName: employee.displayName, email: employee.email, title: employee.title, employmentStatus: employee.employmentStatus, department: null }; }, async listLearningEmployees() { return [{ id: employee.id, displayName: employee.displayName, email: employee.email, title: employee.title, employmentStatus: employee.employmentStatus, department: null }]; }, async searchLearningEmployees(_context, query) { if (!query) { const error = new Error('invalid query'); error.code = 'HRM_VALIDATION_FAILED'; error.statusCode = 400; throw error; } return query === 'Employee A' ? [{ id: employee.id, displayName: employee.displayName, email: employee.email, title: employee.title, employmentStatus: employee.employmentStatus, department: null }] : []; }, async createEmployee(_companyId, input) { return { ...employee, ...input }; }, async updateEmployee(_companyId, _id, input) { return { ...employee, ...input }; }, async deleteEmployee() {},
  async listDepartments() { return [{ id: 'department-a', companyId: 'company-a', name: 'Engineering', code: 'ENG' }]; }, async listLearningDepartments() { return [{ id: 'department-a', name: 'Engineering', code: 'ENG' }]; }, async getLearningDepartmentMembers(_context, id) { if (id !== 'department-a') { const error = new Error('not found'); error.code = 'HRM_NOT_FOUND'; error.statusCode = 404; throw error; } return [employee]; }, async getDepartment() { return { id: 'department-a', companyId: 'company-a', name: 'Engineering', code: 'ENG' }; }, async getDepartmentMembers() { return [employee]; },
  async getLearningEmployeeAttendance(_context, id) { if (id !== 'employee-a') { const error = new Error('not found'); error.code = 'HRM_NOT_FOUND'; error.statusCode = 404; throw error; } return [{ id: 'attendance-a', employeeId: 'employee-a', employeeDisplayName: 'Employee A', workDate: '2026-09-21', status: 'present', minutesWorked: 480 }]; }, async getLearningEmployeeLeaveRequests(_context, id) { if (id !== 'employee-a') { const error = new Error('not found'); error.code = 'HRM_NOT_FOUND'; error.statusCode = 404; throw error; } return [{ id: 'leave-a', leaveTypeCode: 'ANNUAL', status: 'pending' }]; },
  async listLearningProjects() { return [{ id: 'project-a', name: 'Learning Project', code: 'LEARN', status: 'active' }]; },
  async linkIdentity(context, userId, input) { this.requirePermission(context, 'organization.manage'); return { companyId: context.companyId, userId, employeeId: input.employeeId }; },
  async unlinkIdentity(context) { this.requirePermission(context, 'organization.manage'); },
  async listIdentityLinkEmployees(context) { this.requirePermission(context, 'organization.manage'); return { employees: [employee], links: [] }; },
  async listLearningProjectTasks(_context, id) { if (id !== 'project-a') throw new HrmDomainError('HRM_NOT_FOUND', 'Project was not found.', 404); return [{ id: 'task-a', projectId: 'project-a', title: 'Learning Task', status: 'todo' }]; },
  async updateLearningTaskStatus(_context, id, input) { if (id !== 'task-a') throw new HrmDomainError('HRM_NOT_FOUND', 'Task was not found.', 404); if (input?.status !== 'in_progress') throw new HrmDomainError('HRM_CONFLICT', 'Task status transition is not allowed.', 409); return { id, status: input.status }; },
  async getMyAttendance(_context, range) { return [{ id: 'attendance-a', employeeId: 'employee-a', workDate: range.from, status: 'present', minutesWorked: 480 }]; },
  async getMyAttendanceSummary(_context, range) { return { ...range, totalRecords: 1, totalMinutesWorked: 480, byStatus: { present: 1 } }; },
  async getTeamAttendance(_context, range) { return [{ id: 'attendance-a', employeeId: 'employee-a', employeeDisplayName: 'Employee A', workDate: range.from, status: 'present', minutesWorked: 480 }]; },
  async getTeamAttendanceSummary(_context, range) { return { ...range, totalRecords: 1, totalMinutesWorked: 480, byStatus: { present: 1 } }; },
  async previewMyLeaveRequest(context, input) { return { ...input, actorEmployeeId: context.employeeId, actorCompanyId: context.companyId, hasConflict: false }; },
};
const headers = { 'x-hrm-internal-token': 'test-token', 'x-hrm-contract-version': '1', 'x-actor-user-id': 'chat-user-a', 'x-request-id': 'request-123' };
async function request(server, path, options = {}) {
  const response = await fetch(`http://127.0.0.1:${server.address().port}${path}`, options);
  return { status: response.status, body: response.status === 204 ? null : await response.json() };
}
async function withServer(run) {
  const server = createServer(service, { internalToken: 'test-token' });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try { await run(server); } finally { await new Promise((resolve) => server.close(resolve)); }
}

test('v1 routes require internal token, version, actor and request context', () => withServer(async (server) => {
  for (const invalid of [{}, { 'x-hrm-internal-token': 'wrong' }, { 'x-hrm-internal-token': 'test-token', 'x-hrm-contract-version': '1' }]) {
    const response = await request(server, '/internal/v1/employees', { headers: invalid });
    assert.ok([401, 403].includes(response.status));
    assert.equal(response.body.error.code, 'HRM_UNAUTHENTICATED');
    assert.ok(response.body.error.requestId);
  }
  const unsupported = await request(server, '/internal/v1/employees', { headers: { ...headers, 'x-hrm-contract-version': '2' } });
  assert.equal(unsupported.status, 503);
  assert.equal(unsupported.body.error.code, 'HRM_UNAVAILABLE');
}));

test('v1 employee and organization routes return safe PostgreSQL-domain shapes', () => withServer(async (server) => {
  const listed = await request(server, '/internal/v1/employees?query=Employee', { headers });
  assert.deepEqual(listed, { status: 200, body: { data: [employee] } });
  assert.equal((await request(server, '/internal/v1/employees/employee-a', { headers })).body.data.email, 'employee.a@example.test');
  assert.equal((await request(server, '/internal/v1/departments/department-a/employees', { headers })).body.data[0].id, 'employee-a');
  assert.equal((await request(server, '/internal/v1/companies/company-a', { headers })).body.data.code, 'COMPANY-A');
}));

test('only organization managers can provision an HRM identity link in their resolved company', () => withServer(async (server) => {
  assert.deepEqual(await request(server, '/internal/v1/identity-links/employees', { headers }), { status: 200, body: { data: { employees: [employee], links: [] } } });
  const response = await request(server, '/internal/v1/identity-links/chat-user-b', {
    method: 'PUT', headers: { ...headers, 'content-type': 'application/json' }, body: JSON.stringify({ employeeId: 'employee-a' }),
  });
  assert.deepEqual(response, { status: 200, body: { data: { companyId: 'company-a', userId: 'chat-user-b', employeeId: 'employee-a' } } });
  assert.equal((await request(server, '/internal/v1/identity-links/chat-user-b', { method: 'DELETE', headers })).status, 204);
}));

test('v1 derives company from HRM identity and learning routes are read-only', () => withServer(async (server) => {
  const learningRequest = (path, options = {}) => request(server, path, { ...options, headers: { ...headers, ...(options.headers ?? {}) } });
  const unauthenticatedLearning = await request(server, '/api/employees');
  assert.equal(unauthenticatedLearning.status, 401);
  assert.equal(unauthenticatedLearning.body.error.code, 'HRM_UNAUTHENTICATED');
  const companyPath = await request(server, '/internal/v1/companies/company-b', { headers });
  assert.equal(companyPath.status, 200);
  const profile = await learningRequest('/api/employees/employee-a');
  assert.deepEqual(profile, { status: 200, body: { data: { id: 'employee-a', displayName: 'Employee A', email: 'employee.a@example.test', title: 'Builder', employmentStatus: 'active', department: null } } });
  assert.deepEqual(await learningRequest('/api/employees'), { status: 200, body: { data: [{ id: 'employee-a', displayName: 'Employee A', email: 'employee.a@example.test', title: 'Builder', employmentStatus: 'active', department: null }] } });
  assert.deepEqual(await learningRequest('/api/employees?search=Employee%20A'), { status: 200, body: { data: [{ id: 'employee-a', displayName: 'Employee A', email: 'employee.a@example.test', title: 'Builder', employmentStatus: 'active', department: null }] } });
  assert.deepEqual(await learningRequest('/api/departments'), { status: 200, body: { data: [{ id: 'department-a', name: 'Engineering', code: 'ENG' }] } });
  assert.deepEqual(await learningRequest('/api/departments/department-a/employees'), { status: 200, body: { data: [employee] } });
  assert.equal((await learningRequest('/api/employees/employee-a/attendance')).body.data[0].employeeId, 'employee-a');
  assert.equal((await learningRequest('/api/employees/employee-a/leave-requests')).body.data[0].id, 'leave-a');
  assert.equal((await learningRequest('/api/projects')).body.data[0].id, 'project-a');
  assert.equal((await learningRequest('/api/projects/project-a/tasks')).body.data[0].id, 'task-a');
  assert.equal((await learningRequest('/api/projects/missing/tasks')).status, 404);
  const updated = await learningRequest('/api/tasks/task-a', { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ status: 'in_progress' }) });
  assert.deepEqual(updated.body.data, { id: 'task-a', status: 'in_progress' });
  assert.equal((await learningRequest('/api/tasks/task-a', { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ status: 'done' }) })).status, 409);
  const unsupported = await learningRequest('/api/unsupported');
  assert.equal(unsupported.status, 404);
}));

test('v1 attendance routes use the authenticated self or team capability and require a bounded date range', () => withServer(async (server) => {
  const range = 'from=2026-09-01&to=2026-09-30';
  const self = await request(server, `/internal/v1/me/attendance?${range}&employeeId=spoofed`, { headers });
  assert.equal(self.status, 200);
  assert.equal(self.body.data[0].employeeId, 'employee-a');
  const summary = await request(server, `/internal/v1/me/attendance/summary?${range}`, { headers });
  assert.deepEqual(summary.body.data, { from: '2026-09-01', to: '2026-09-30', totalRecords: 1, totalMinutesWorked: 480, byStatus: { present: 1 } });
  assert.equal((await request(server, `/internal/v1/me/team/attendance?${range}`, { headers })).body.data[0].employeeDisplayName, 'Employee A');
}));

test('leave preview route receives only the resolved actor context and preserves safe errors', () => withServer(async (server) => {
  const body = { leaveTypeCode: 'ANNUAL', startDate: '2026-10-01', endDate: '2026-10-02', requestedDays: 2, employeeId: 'spoofed', companyId: 'spoofed-company' };
  const preview = await request(server, '/internal/v1/me/leave-request-preview', { method: 'POST', headers: { ...headers, 'content-type': 'application/json' }, body: JSON.stringify(body) });
  assert.deepEqual(preview, { status: 200, body: { data: { ...body, actorEmployeeId: 'employee-a', actorCompanyId: 'company-a', hasConflict: false } } });
  const missingTrust = await request(server, '/internal/v1/me/leave-request-preview', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  assert.equal(missingTrust.status, 401);
  assert.equal(missingTrust.body.error.code, 'HRM_UNAUTHENTICATED');
}));
