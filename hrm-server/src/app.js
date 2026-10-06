import http from 'node:http';
import { randomUUID, timingSafeEqual } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createDatabase } from './database.js';
import { AttendanceRepository, AuditRepository, AuthorizationRepository, CompanyRepository, DepartmentRepository, EmployeeRepository, IdentityLinkRepository, LeaveRepository, TaskRepository } from './repositories.js';
import { HrmDomainError, HrmService } from './services.js';

export const createHrmService = (db = createDatabase()) => new HrmService({
  db, companies: new CompanyRepository(db), employees: new EmployeeRepository(db), departments: new DepartmentRepository(db), audit: new AuditRepository(db), authorization: new AuthorizationRepository(db), identityLinks: new IdentityLinkRepository(db), leave: new LeaveRepository(db), attendance: new AttendanceRepository(db), tasks: new TaskRepository(db),
});

const send = (res, status, payload) => {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(payload));
};
const safeError = (res, status, code, message, requestId) => send(res, status, { error: { code, message, requestId } });
const matchingToken = (expected, supplied) => {
  if (!expected || typeof supplied !== 'string') return false;
  const expectedBytes = Buffer.from(expected); const suppliedBytes = Buffer.from(supplied);
  return expectedBytes.length === suppliedBytes.length && timingSafeEqual(expectedBytes, suppliedBytes);
};
const header = (req, name) => typeof req.headers[name] === 'string' ? req.headers[name] : undefined;
const requestId = (req) => {
  const value = header(req, 'x-request-id');
  return value && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(value) ? value : randomUUID();
};
const employeeView = (employee, context) => {
  if (employee.id === context.employeeId || context.permissions.includes('employee.profile.read.any')) return employee;
  const { email: _email, ...teamView } = employee;
  return teamView;
};
const parseJson = async (req) => {
  let body = '';
  for await (const chunk of req) {
    body += chunk;
    if (body.length > 64 * 1024) throw new HrmDomainError('HRM_VALIDATION_FAILED', 'Request body is too large.');
  }
  if (!body) return {};
  try {
    const value = JSON.parse(body);
    if (!value || Array.isArray(value) || typeof value !== 'object') throw new Error('not an object');
    return value;
  } catch { throw new HrmDomainError('HRM_VALIDATION_FAILED', 'Request body must be a JSON object.'); }
};

async function internalContext(req, internalToken, service) {
  if (!matchingToken(internalToken, header(req, 'x-hrm-internal-token'))) throw new HrmDomainError('HRM_UNAUTHENTICATED', 'HRM request is not authorized.', 401);
  if (header(req, 'x-hrm-contract-version') !== '1') throw new HrmDomainError('HRM_UNAVAILABLE', 'The requested HRM contract version is not available.', 503);
  if (!header(req, 'x-request-id')) throw new HrmDomainError('HRM_UNAUTHENTICATED', 'HRM request context is required.', 401);
  const actorUserId = header(req, 'x-actor-user-id');
  if (!actorUserId || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,99}$/.test(actorUserId)) throw new HrmDomainError('HRM_UNAUTHENTICATED', 'HRM actor context is required.', 401);
  return service.resolveExecutionContext(actorUserId, requestId(req));
}

export function createServer(service = createHrmService(), { internalToken = process.env.HRM_INTERNAL_TOKEN ?? '' } = {}) {
  return http.createServer(async (req, res) => {
    const id = requestId(req);
    if (req.method === 'GET' && req.url === '/health') return send(res, 200, { status: 'ok' });
    try {
      const url = new URL(req.url ?? '/', 'http://hrm.local');
      const path = url.pathname.split('/').filter(Boolean);
      // The learning slice deliberately exposes one read-only route without
      // the legacy multi-company/RBAC path, so its DB → API flow is traceable.
      if (path[0] === 'api') {
        const context = await internalContext(req, internalToken, service);
        if (req.method === 'GET' && path.length === 2 && path[1] === 'employees') {
          if (url.searchParams.has('search')) return send(res, 200, { data: await service.searchLearningEmployees(context, url.searchParams.get('search')) });
          return send(res, 200, { data: await service.listLearningEmployees(context) });
        }
        if (req.method === 'GET' && path.length === 3 && path[1] === 'employees') {
          return send(res, 200, { data: await service.getEmployeeProfile(context, path[2]) });
        }
        if (req.method === 'GET' && path.length === 4 && path[1] === 'employees' && path[3] === 'attendance') {
          return send(res, 200, { data: await service.getLearningEmployeeAttendance(context, path[2]) });
        }
        if (req.method === 'GET' && path.length === 4 && path[1] === 'employees' && path[3] === 'leave-requests') {
          return send(res, 200, { data: await service.getLearningEmployeeLeaveRequests(context, path[2]) });
        }
        if (req.method === 'POST' && path.length === 2 && path[1] === 'leave-requests') {
          return send(res, 201, { data: await service.createLearningLeaveRequest(context, await parseJson(req)) });
        }
        if (req.method === 'GET' && path.length === 2 && path[1] === 'projects') {
          return send(res, 200, { data: await service.listLearningProjects(context) });
        }
        if (req.method === 'GET' && path.length === 4 && path[1] === 'projects' && path[3] === 'tasks') {
          return send(res, 200, { data: await service.listLearningProjectTasks(context, path[2]) });
        }
        if (req.method === 'PATCH' && path.length === 3 && path[1] === 'tasks') {
          return send(res, 200, { data: await service.updateLearningTaskStatus(context, path[2], await parseJson(req)) });
        }
        if (req.method === 'GET' && path.length === 2 && path[1] === 'departments') {
          return send(res, 200, { data: await service.listLearningDepartments(context) });
        }
        if (req.method === 'GET' && path.length === 4 && path[1] === 'departments' && path[3] === 'employees') {
          return send(res, 200, { data: await service.getLearningDepartmentMembers(context, path[2]) });
        }
        if (req.method === 'GET' && path.length === 3 && path[1] === 'departments') {
          return send(res, 200, { data: await service.getDepartmentDetails(context, path[2]) });
        }
        if (req.method === 'GET' && path.length === 4 && path[1] === 'departments' && path[3] === 'overview') {
          return send(res, 200, { data: await service.getDepartmentOverview(context, path[2]) });
        }
        throw new HrmDomainError('HRM_NOT_FOUND', 'Route was not found.', 404);
      }
      if (path[0] !== 'internal' || path[1] !== 'v1') throw new HrmDomainError('HRM_NOT_FOUND', 'Route was not found.', 404);
      const context = await internalContext(req, internalToken, service);
      let data; let status = 200;
      if (path.length === 3 && path[2] === 'companies' && req.method === 'POST') {
        service.requirePermission(context, 'organization.manage');
        const input = await parseJson(req);
        if (input.id !== context.companyId) throw new HrmDomainError('HRM_VALIDATION_FAILED', 'Company id must match the trusted company context.');
        data = await service.createCompany(input, context); status = 201;
      } else if (path.length === 4 && path[2] === 'companies' && req.method === 'GET') { service.requirePermission(context, 'organization.manage'); data = await service.getCompany(context.companyId); }
      else if (path.length === 4 && path[2] === 'companies' && req.method === 'PATCH') { service.requirePermission(context, 'organization.manage'); data = await service.updateCompany(context.companyId, await parseJson(req), context); }
      else if (path.length === 4 && path[2] === 'companies' && req.method === 'DELETE') { service.requirePermission(context, 'organization.manage'); await service.deleteCompany(context.companyId, context); status = 204; }
      else if (path.length === 4 && path[2] === 'me' && path[3] === 'profile' && req.method === 'GET') { service.requirePermission(context, 'employee.profile.read.self'); data = employeeView(await service.getEmployee(context.companyId, context.employeeId), context); }
      else if (path.length === 4 && path[2] === 'me' && path[3] === 'team' && req.method === 'GET') { service.requirePermission(context, 'employee.profile.read.team'); if (!context.departmentId) throw new HrmDomainError('HRM_NOT_FOUND', 'Team was not found.', 404); data = (await service.getDepartmentMembers(context.companyId, context.departmentId)).map((employee) => employeeView(employee, context)); }
      else if (path.length === 4 && path[2] === 'me' && path[3] === 'attendance' && req.method === 'GET') data = await service.getMyAttendance(context, { from: url.searchParams.get('from'), to: url.searchParams.get('to') });
      else if (path.length === 5 && path[2] === 'me' && path[3] === 'attendance' && path[4] === 'summary' && req.method === 'GET') data = await service.getMyAttendanceSummary(context, { from: url.searchParams.get('from'), to: url.searchParams.get('to') });
      else if (path.length === 5 && path[2] === 'me' && path[3] === 'team' && path[4] === 'attendance' && req.method === 'GET') data = await service.getTeamAttendance(context, { from: url.searchParams.get('from'), to: url.searchParams.get('to') });
      else if (path.length === 6 && path[2] === 'me' && path[3] === 'team' && path[4] === 'attendance' && path[5] === 'summary' && req.method === 'GET') data = await service.getTeamAttendanceSummary(context, { from: url.searchParams.get('from'), to: url.searchParams.get('to') });
      else if (path.length === 3 && path[2] === 'projects' && req.method === 'POST') { data = await service.createProject(context, await parseJson(req)); status = 201; }
      else if (path.length === 5 && path[2] === 'projects' && path[4] === 'tasks' && req.method === 'POST') { data = await service.createTask(context, path[3], await parseJson(req)); status = 201; }
      else if (path.length === 4 && path[2] === 'me' && path[3] === 'tasks' && req.method === 'GET') data = await service.getMyTasks(context, url.searchParams.get('status'));
      else if (path.length === 5 && path[2] === 'me' && path[3] === 'team' && path[4] === 'tasks' && req.method === 'GET') data = await service.getTeamTasks(context, url.searchParams.get('status'));
      else if (path.length === 5 && path[2] === 'tasks' && path[4] === 'assignments' && req.method === 'POST') data = await service.assignTask(context, path[3], await parseJson(req));
      else if (path.length === 4 && path[2] === 'tasks' && req.method === 'PATCH') data = await service.updateTask(context, path[3], await parseJson(req));
      else if (path.length === 5 && path[2] === 'tasks' && path[4] === 'status' && req.method === 'POST') data = await service.updateTaskStatus(context, path[3], await parseJson(req));
      else if (path.length === 4 && path[2] === 'me' && path[3] === 'leave-balances' && req.method === 'GET') data = await service.getMyLeaveBalances(context, Number(url.searchParams.get('year')));
      else if (path.length === 4 && path[2] === 'me' && path[3] === 'leave-requests' && req.method === 'GET') data = await service.getMyLeaveRequests(context);
      else if (path.length === 5 && path[2] === 'me' && path[3] === 'team' && path[4] === 'pending-leave-requests' && req.method === 'GET') data = await service.getPendingTeamLeaveRequests(context);
      else if (path.length === 4 && path[2] === 'me' && path[3] === 'leave-request-preview' && req.method === 'POST') data = await service.previewMyLeaveRequest(context, await parseJson(req));
      else if (path.length === 4 && path[2] === 'me' && path[3] === 'leave-requests' && req.method === 'POST') { data = await service.requestLeave(context, await parseJson(req)); status = 201; }
      else if (path.length === 5 && path[2] === 'leave-requests' && path[4] === 'approve' && req.method === 'POST') data = await service.approveLeave(context, path[3]);
      else if (path.length === 5 && path[2] === 'leave-requests' && path[4] === 'cancel' && req.method === 'POST') data = await service.cancelLeave(context, path[3]);
      else if (path.length === 5 && path[2] === 'leave-requests' && path[4] === 'reject' && req.method === 'POST') data = await service.rejectLeave(context, path[3]);
      else if (path.length === 3 && path[2] === 'employees' && req.method === 'GET') { service.requirePermission(context, 'employee.profile.read.any'); data = (await service.listEmployees(context.companyId, url.searchParams.get('query') ?? '')).map((employee) => employeeView(employee, context)); }
      else if (path.length === 4 && path[2] === 'employees' && path[3] === 'search' && req.method === 'GET') { service.requirePermission(context, 'employee.profile.read.any'); data = (await service.listEmployees(context.companyId, url.searchParams.get('query') ?? '')).map((employee) => employeeView(employee, context)); }
      else if (path.length === 3 && path[2] === 'employees' && req.method === 'POST') { service.requirePermission(context, 'organization.manage'); data = await service.createEmployee(context.companyId, await parseJson(req), context); status = 201; }
      else if (path.length === 4 && path[2] === 'employees' && req.method === 'GET') { const employee = await service.getEmployee(context.companyId, path[3]); if (employee.id === context.employeeId) service.requirePermission(context, 'employee.profile.read.self'); else if (employee.departmentId === context.departmentId) service.requirePermission(context, 'employee.profile.read.team'); else service.requirePermission(context, 'employee.profile.read.any'); data = employeeView(employee, context); }
      else if (path.length === 4 && path[2] === 'employees' && req.method === 'PATCH') { service.requirePermission(context, 'organization.manage'); data = await service.updateEmployee(context.companyId, path[3], await parseJson(req), context); }
      else if (path.length === 4 && path[2] === 'employees' && req.method === 'DELETE') { service.requirePermission(context, 'organization.manage'); await service.deleteEmployee(context.companyId, path[3], context); status = 204; }
      else if (path.length === 4 && path[2] === 'identity-links' && path[3] === 'employees' && req.method === 'GET') { data = await service.listIdentityLinkEmployees(context); }
      else if (path.length === 4 && path[2] === 'identity-links' && req.method === 'DELETE') { await service.unlinkIdentity(context, path[3]); status = 204; }
      else if (path.length === 4 && path[2] === 'identity-links' && req.method === 'PUT') { data = await service.linkIdentity(context, path[3], await parseJson(req)); }
      else if (path.length === 3 && path[2] === 'departments' && req.method === 'GET') data = await service.listDepartments(context.companyId, url.searchParams.get('query') ?? '');
      else if (path.length === 4 && path[2] === 'departments' && req.method === 'GET') data = await service.getDepartment(context.companyId, path[3]);
      else if (path.length === 5 && path[2] === 'departments' && path[4] === 'employees' && req.method === 'GET') { if (path[3] === context.departmentId) service.requirePermission(context, 'employee.profile.read.team'); else service.requirePermission(context, 'employee.profile.read.any'); data = (await service.getDepartmentMembers(context.companyId, path[3])).map((employee) => employeeView(employee, context)); }
      else throw new HrmDomainError('HRM_NOT_FOUND', 'Route was not found.', 404);
      return status === 204 ? send(res, status, null) : send(res, status, { data });
    } catch (error) {
      const known = error instanceof HrmDomainError;
      return safeError(res, known ? error.statusCode : 500, known ? error.code : 'HRM_INTERNAL', known ? error.message : 'An internal HRM error occurred.', id);
    }
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.HRM_PORT ?? 3010);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('HRM_PORT must be a valid TCP port.');
  const db = createDatabase();
  const close = async () => { await db.close(); process.exit(0); };
  process.once('SIGINT', close); process.once('SIGTERM', close);
  createServer(createHrmService(db)).listen(port, '127.0.0.1', () => console.log(JSON.stringify({ event: 'hrm.server.started', port, storage: 'postgresql' })));
}
