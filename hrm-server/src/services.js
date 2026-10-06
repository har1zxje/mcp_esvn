export class HrmDomainError extends Error {
  constructor(code, message, statusCode = 400) { super(message); this.code = code; this.statusCode = statusCode; }
}

/**
 * The complete, trusted HRM execution context. It is deliberately created in
 * hrm-server, where identity links and role assignments are authoritative;
 * MCP remains an HTTP adapter and never reads HRM PostgreSQL directly.
 */
export const toHrmExecutionContext = (actor, requestId) => Object.freeze({
  userId: actor.chatUserId,
  employeeId: actor.employeeId,
  companyId: actor.companyId,
  departmentId: actor.departmentId,
  roles: Object.freeze([...actor.roles]),
  permissions: Object.freeze([...actor.permissions]),
  requestId,
});

const requiredId = (value, field = 'id') => {
  if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,99}$/.test(value)) throw new HrmDomainError('HRM_VALIDATION_FAILED', `A valid ${field} is required.`);
  return value;
};
const requiredText = (value, field, maxLength = 200) => {
  if (typeof value !== 'string' || !(value = value.trim()) || value.length > maxLength) throw new HrmDomainError('HRM_VALIDATION_FAILED', `A valid ${field} is required.`);
  return value;
};
const optionalId = (value, field) => value == null ? null : requiredId(value, field);
const queryText = (value) => {
  if (typeof value !== 'string' || value.length > 100) throw new HrmDomainError('HRM_VALIDATION_FAILED', 'A valid query is required.');
  return value.trim();
};
const email = (value) => {
  value = requiredText(value, 'email', 320).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) throw new HrmDomainError('HRM_VALIDATION_FAILED', 'A valid email is required.');
  return value;
};
const employmentStatus = (value) => {
  if (!['active', 'inactive', 'terminated'].includes(value)) throw new HrmDomainError('HRM_VALIDATION_FAILED', 'A valid employment status is required.');
  return value;
};
const leaveYear = (value) => value instanceof Date ? value.getUTCFullYear() : Number(String(value).slice(0, 4));
const leaveBalanceYear = (value) => {
  if (!Number.isInteger(value) || value < 2000 || value > 2100) throw new HrmDomainError('HRM_VALIDATION_FAILED', 'A valid leave year is required.');
  return value;
};
const isoDate = (value, field) => {
  value = requiredText(value, field, 10);
  const date = new Date(`${value}T00:00:00.000Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) throw new HrmDomainError('HRM_VALIDATION_FAILED', `A valid ${field} is required.`);
  return value;
};
const attendanceRange = ({ from, to }) => {
  const start = isoDate(from, 'from date'); const end = isoDate(to, 'to date');
  const duration = (Date.parse(`${end}T00:00:00.000Z`) - Date.parse(`${start}T00:00:00.000Z`)) / 86_400_000;
  if (duration < 0 || duration > 365) throw new HrmDomainError('HRM_VALIDATION_FAILED', 'Attendance date range must be between 1 and 366 days.');
  return { from: start, to: end };
};
const taskStatuses = ['todo', 'in_progress', 'blocked', 'done', 'cancelled'];
const taskPriorities = ['low', 'medium', 'high'];
const taskStatus = (value, field = 'task status') => {
  if (!taskStatuses.includes(value)) throw new HrmDomainError('HRM_VALIDATION_FAILED', `A valid ${field} is required.`);
  return value;
};
const taskQueryStatus = (value) => value == null || value === '' ? '' : taskStatus(value);
const taskDueDate = (value) => value == null || value === '' ? null : isoDate(value, 'due date');
const allowedStatusTransitions = {
  todo: ['in_progress', 'blocked', 'cancelled'],
  in_progress: ['blocked', 'done', 'cancelled'],
  blocked: ['in_progress', 'cancelled'],
  done: [],
  cancelled: [],
};
const normalizeDatabaseError = (error) => {
  if (error?.code === '23505') throw new HrmDomainError('HRM_CONFLICT', 'The HRM resource already exists.', 409);
  if (error?.code === '23503') throw new HrmDomainError('HRM_VALIDATION_FAILED', 'The supplied HRM relationship is not valid.');
  throw error;
};

export class HrmService {
  constructor({ db, companies, employees, departments, audit, authorization, identityLinks, leave, attendance, tasks }) { Object.assign(this, { db, companies, employees, departments, audit, authorization, identityLinks, leave, attendance, tasks }); }
  async getMyTasks(context, status) { this.requirePermission(context, 'task.read.self'); return this.tasks.mine(context.companyId, context.employeeId, taskQueryStatus(status)); }
  async getTeamTasks(context, status) { this.requirePermission(context, 'task.read.team'); if (!context.departmentId) throw new HrmDomainError('HRM_NOT_FOUND', 'Team was not found.', 404); return this.tasks.team(context.companyId, context.departmentId, taskQueryStatus(status)); }
  taskScope(context, task) {
    if (task.assignedEmployeeId) {
      if (task.assignedEmployeeDepartmentId !== context.departmentId) throw new HrmDomainError('HRM_FORBIDDEN', 'You do not have permission to perform this action.', 403);
    } else if (task.createdByEmployeeId !== context.employeeId) throw new HrmDomainError('HRM_FORBIDDEN', 'You do not have permission to perform this action.', 403);
  }
  async createProject(context, input) {
    this.requirePermission(context, 'task.manage.team');
    const project = { id: requiredId(input?.id, 'project id'), name: requiredText(input?.name, 'project name'), code: requiredText(input?.code, 'project code', 100).toUpperCase(), description: input?.description == null ? null : requiredText(input.description, 'project description', 4000) };
    try { return await this.db.transaction(async (client) => { const tasks = new this.tasks.constructor(client); const audit = new this.audit.constructor(client); const result = await tasks.createProject(context.companyId, project, context.employeeId); await tasks.addProjectMember(context.companyId, result.id, context.employeeId, 'manager'); await audit.append({ companyId: context.companyId, actorUserId: context.chatUserId, actorEmployeeId: context.employeeId, action: 'project.created', resourceType: 'project', resourceId: result.id, afterState: result, requestId: context.requestId }); return result; }); } catch (error) { return normalizeDatabaseError(error); }
  }
  async createTask(context, projectId, input) {
    this.requirePermission(context, 'task.manage.team');
    projectId = requiredId(projectId, 'project id');
    const task = { title: requiredText(input?.title, 'task title'), description: input?.description == null ? null : requiredText(input.description, 'task description', 4000), priority: input?.priority === undefined ? 'medium' : (taskPriorities.includes(input.priority) ? input.priority : null), dueDate: taskDueDate(input?.dueDate) };
    if (!task.priority) throw new HrmDomainError('HRM_VALIDATION_FAILED', 'A valid task priority is required.');
    return this.db.transaction(async (client) => { const tasks = new this.tasks.constructor(client); const audit = new this.audit.constructor(client); if (!await tasks.project(context.companyId, projectId)) throw new HrmDomainError('HRM_NOT_FOUND', 'Project was not found.', 404); const result = await tasks.createTask(context.companyId, projectId, task, context.employeeId); await audit.append({ companyId: context.companyId, actorUserId: context.chatUserId, actorEmployeeId: context.employeeId, action: 'task.created', resourceType: 'task', resourceId: result.id, afterState: result, requestId: context.requestId }); return result; });
  }
  async assignTask(context, taskId, input) {
    this.requirePermission(context, 'task.manage.team'); taskId = requiredText(taskId, 'task id', 100); const employeeId = requiredId(input?.employeeId, 'employee id');
    return this.db.transaction(async (client) => { const tasks = new this.tasks.constructor(client); const audit = new this.audit.constructor(client); const task = await tasks.task(context.companyId, taskId, true); if (!task) throw new HrmDomainError('HRM_NOT_FOUND', 'Task was not found.', 404); this.taskScope(context, task); const employee = await tasks.employee(context.companyId, employeeId); if (!employee) throw new HrmDomainError('HRM_NOT_FOUND', 'Employee was not found.', 404); if (employee.department_id !== context.departmentId) throw new HrmDomainError('HRM_FORBIDDEN', 'You do not have permission to perform this action.', 403); await tasks.assign(context.companyId, task.id, employeeId, context.employeeId); await tasks.addProjectMember(context.companyId, task.projectId, employeeId); const result = await tasks.task(context.companyId, task.id); await audit.append({ companyId: context.companyId, actorUserId: context.chatUserId, actorEmployeeId: context.employeeId, action: 'task.assigned', resourceType: 'task', resourceId: task.id, beforeState: task, afterState: result, requestId: context.requestId }); return result; });
  }
  async updateTask(context, taskId, input) {
    this.requirePermission(context, 'task.manage.team'); taskId = requiredText(taskId, 'task id', 100);
    return this.db.transaction(async (client) => { const tasks = new this.tasks.constructor(client); const audit = new this.audit.constructor(client); const existing = await tasks.task(context.companyId, taskId, true); if (!existing) throw new HrmDomainError('HRM_NOT_FOUND', 'Task was not found.', 404); this.taskScope(context, existing); const next = { title: input?.title === undefined ? existing.title : requiredText(input.title, 'task title'), description: input?.description === undefined ? existing.description : (input.description == null ? null : requiredText(input.description, 'task description', 4000)), priority: input?.priority === undefined ? existing.priority : (taskPriorities.includes(input.priority) ? input.priority : null), dueDate: input?.dueDate === undefined ? existing.dueDate : taskDueDate(input.dueDate) }; if (!next.priority) throw new HrmDomainError('HRM_VALIDATION_FAILED', 'A valid task priority is required.'); const result = await tasks.updateTask(context.companyId, existing.id, next); await audit.append({ companyId: context.companyId, actorUserId: context.chatUserId, actorEmployeeId: context.employeeId, action: 'task.updated', resourceType: 'task', resourceId: existing.id, beforeState: existing, afterState: result, requestId: context.requestId }); return result; });
  }
  async updateTaskStatus(context, taskId, input) {
    taskId = requiredText(taskId, 'task id', 100); const nextStatus = taskStatus(input?.status);
    return this.db.transaction(async (client) => { const tasks = new this.tasks.constructor(client); const audit = new this.audit.constructor(client); const existing = await tasks.task(context.companyId, taskId, true); if (!existing) throw new HrmDomainError('HRM_NOT_FOUND', 'Task was not found.', 404); const assignedToActor = existing.assignedEmployeeId === context.employeeId; if (!assignedToActor) { this.requirePermission(context, 'task.manage.team'); this.taskScope(context, existing); } else this.requirePermission(context, 'task.update.self'); if (!allowedStatusTransitions[existing.status].includes(nextStatus)) throw new HrmDomainError('HRM_CONFLICT', 'Task status transition is not allowed.', 409); const result = await tasks.updateStatus(context.companyId, existing.id, nextStatus); await audit.append({ companyId: context.companyId, actorUserId: context.chatUserId, actorEmployeeId: context.employeeId, action: 'task.status_updated', resourceType: 'task', resourceId: existing.id, beforeState: existing, afterState: result, requestId: context.requestId }); return result; });
  }
  attendanceSummary(records, range) {
    const byStatus = {};
    let totalMinutesWorked = 0;
    for (const record of records) { byStatus[record.status] = (byStatus[record.status] ?? 0) + 1; totalMinutesWorked += record.minutesWorked ?? 0; }
    return { ...range, totalRecords: records.length, totalMinutesWorked, byStatus };
  }
  async getMyAttendance(context, input) {
    this.requirePermission(context, 'attendance.read.self');
    return this.attendance.forEmployee(context.companyId, context.employeeId, attendanceRange(input));
  }
  async getMyAttendanceSummary(context, input) {
    const range = attendanceRange(input); const records = await this.getMyAttendance(context, range);
    return this.attendanceSummary(records, range);
  }
  async getTeamAttendance(context, input) {
    this.requirePermission(context, 'attendance.read.team');
    if (!context.departmentId) throw new HrmDomainError('HRM_NOT_FOUND', 'Team was not found.', 404);
    return this.attendance.forDepartment(context.companyId, context.departmentId, attendanceRange(input));
  }
  async getTeamAttendanceSummary(context, input) {
    const range = attendanceRange(input); const records = await this.getTeamAttendance(context, range);
    return this.attendanceSummary(records, range);
  }
  async getMyLeaveBalances(context, year) {
    this.requirePermission(context, 'leave.read.self');
    return this.leave.balances(context.companyId, context.employeeId, leaveBalanceYear(year));
  }
  async getMyLeaveRequests(context) {
    this.requirePermission(context, 'leave.read.self');
    return this.leave.requests(context.companyId, context.employeeId);
  }
  async getPendingTeamLeaveRequests(context) {
    this.requirePermission(context, 'leave.approve.team');
    if (!context.departmentId) throw new HrmDomainError('HRM_NOT_FOUND', 'Team was not found.', 404);
    return this.leave.pendingForDepartment(context.companyId, context.departmentId, context.employeeId);
  }
  async previewMyLeaveRequest(context, input) {
    this.requirePermission(context, 'leave.request.self');
    const leaveTypeCode = requiredId(input?.leaveTypeCode, 'leave type code');
    const startDate = isoDate(input?.startDate, 'start date');
    const endDate = isoDate(input?.endDate, 'end date');
    if (startDate > endDate) throw new HrmDomainError('HRM_VALIDATION_FAILED', 'Leave dates are not valid.');
    const requestedDays = Number(input?.requestedDays);
    if (!Number.isFinite(requestedDays) || requestedDays <= 0) throw new HrmDomainError('HRM_VALIDATION_FAILED', 'Requested leave days must be positive.');
    const reason = input?.reason == null ? null : requiredText(input.reason, 'reason', 1000);
    const type = await this.leave.typeByCode(context.companyId, leaveTypeCode);
    if (!type) throw new HrmDomainError('HRM_NOT_FOUND', 'Leave type was not found.', 404);
    if (await this.leave.hasOverlap(context.companyId, context.employeeId, startDate, endDate)) {
      throw new HrmDomainError('HRM_CONFLICT', 'The requested leave dates overlap an existing leave request.', 409);
    }
    let remainingDaysBefore = null;
    let remainingDaysAfter = null;
    if (type.requires_balance) {
      const balance = await this.leave.balanceSnapshot(context.companyId, context.employeeId, type.id, leaveYear(startDate));
      remainingDaysBefore = balance ? Number(balance.allocated_days) - Number(balance.used_days) : null;
      if (remainingDaysBefore === null || remainingDaysBefore < requestedDays) {
        throw new HrmDomainError('HRM_CONFLICT', 'Insufficient leave balance.', 409);
      }
      remainingDaysAfter = remainingDaysBefore - requestedDays;
    }
    return {
      companyId: context.companyId,
      leaveTypeCode: type.code,
      leaveTypeName: type.name,
      requiresBalance: type.requires_balance,
      startDate,
      endDate,
      requestedDays,
      reason,
      remainingDaysBefore,
      remainingDaysAfter,
      hasConflict: false,
    };
  }
  async requestLeave(context, input) {
    this.requirePermission(context, 'leave.request.self');
    const leaveTypeId = requiredId(input?.leaveTypeId, 'leave type id'); const startDate = requiredText(input?.startDate, 'start date', 10); const endDate = requiredText(input?.endDate, 'end date', 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate) || !/^\d{4}-\d{2}-\d{2}$/.test(endDate) || startDate > endDate) throw new HrmDomainError('HRM_VALIDATION_FAILED', 'Leave dates are not valid.');
    const requestedDays = Number(input?.requestedDays); if (!Number.isFinite(requestedDays) || requestedDays <= 0) throw new HrmDomainError('HRM_VALIDATION_FAILED', 'Requested leave days must be positive.');
    return this.db.transaction(async (client) => { const leave = new this.leave.constructor(client); const audit = new this.audit.constructor(client); const type = await leave.type(context.companyId, leaveTypeId); if (!type) throw new HrmDomainError('HRM_NOT_FOUND', 'Leave type was not found.', 404); if (type.requires_balance) { const balance = await leave.balance(context.companyId, context.employeeId, leaveTypeId, Number(startDate.slice(0, 4))); if (!balance || Number(balance.allocated_days) - Number(balance.used_days) < requestedDays) throw new HrmDomainError('HRM_CONFLICT', 'Insufficient leave balance.', 409); } const result = await leave.create(context.companyId, context.employeeId, { leaveTypeId, startDate, endDate, requestedDays, reason: input.reason }); await audit.append({ companyId: context.companyId, actorUserId: context.chatUserId, actorEmployeeId: context.employeeId, action: 'leave.requested', resourceType: 'leave_request', resourceId: result.id, afterState: result, requestId: context.requestId }); return result; });
  }
  async approveLeave(context, requestId) {
    this.requirePermission(context, 'leave.approve.team');
    return this.db.transaction(async (client) => {
      const leave = new this.leave.constructor(client); const audit = new this.audit.constructor(client);
      const request = await leave.pending(context.companyId, requiredText(requestId, 'leave request id', 100));
      if (!request) throw new HrmDomainError('HRM_NOT_FOUND', 'Leave request was not found.', 404);
      if (request.employee_id === context.employeeId || request.department_id !== context.departmentId) throw new HrmDomainError('HRM_FORBIDDEN', 'You do not have permission to perform this action.', 403);
      const balance = await leave.balance(context.companyId, request.employee_id, request.leave_type_id, leaveYear(request.start_date));
      if (!balance || Number(balance.allocated_days) - Number(balance.used_days) < Number(request.requested_days)) throw new HrmDomainError('HRM_CONFLICT', 'Insufficient leave balance.', 409);
      await leave.approve(request);
      await client.query('INSERT INTO leave_approvals (company_id,leave_request_id,approver_employee_id,decision) VALUES ($1,$2,$3,$4)', [context.companyId, request.id, context.employeeId, 'approved']);
      await audit.append({ companyId: context.companyId, actorUserId: context.chatUserId, actorEmployeeId: context.employeeId, action: 'leave.approved', resourceType: 'leave_request', resourceId: request.id, requestId: context.requestId });
      return { id: request.id, status: 'approved' };
    });
  }
  async cancelLeave(context, id) { this.requirePermission(context, 'leave.request.self'); return this.db.transaction(async (client) => { const leave=new this.leave.constructor(client); const audit=new this.audit.constructor(client); const result=await leave.cancel(context.companyId,context.employeeId,requiredText(id,'leave request id',100)); if (!result) throw new HrmDomainError('HRM_NOT_FOUND','Pending leave request was not found.',404); await audit.append({companyId:context.companyId,actorUserId:context.chatUserId,actorEmployeeId:context.employeeId,action:'leave.cancelled',resourceType:'leave_request',resourceId:result.id,requestId:context.requestId}); return result; }); }
  async rejectLeave(context, id) {
    this.requirePermission(context, 'leave.approve.team');
    return this.db.transaction(async (client) => {
      const leave = new this.leave.constructor(client); const audit = new this.audit.constructor(client);
      const request = await leave.pending(context.companyId, requiredText(id, 'leave request id', 100));
      if (!request) throw new HrmDomainError('HRM_NOT_FOUND', 'Leave request was not found.', 404);
      if (request.employee_id === context.employeeId || request.department_id !== context.departmentId) throw new HrmDomainError('HRM_FORBIDDEN', 'You do not have permission to perform this action.', 403);
      await leave.reject(request);
      await client.query('INSERT INTO leave_approvals (company_id,leave_request_id,approver_employee_id,decision) VALUES ($1,$2,$3,$4)', [context.companyId, request.id, context.employeeId, 'rejected']);
      await audit.append({ companyId: context.companyId, actorUserId: context.chatUserId, actorEmployeeId: context.employeeId, action: 'leave.rejected', resourceType: 'leave_request', resourceId: request.id, requestId: context.requestId });
      return { id: request.id, status: 'rejected' };
    });
  }
  async resolveExecutionContext(chatUserId, requestId) {
    const actor = await this.authorization.resolveActor(requiredId(chatUserId, 'actor user id'));
    if (!actor) throw new HrmDomainError('HRM_IDENTITY_NOT_LINKED', 'HRM identity mapping is required.', 401);
    return toHrmExecutionContext(actor, requiredText(requestId, 'request id', 200));
  }
  requirePermission(actor, permission) {
    if (!actor.permissions.includes(permission)) throw new HrmDomainError('HRM_FORBIDDEN', 'You do not have permission to perform this action.', 403);
  }
  requireEmployeeRead(context, employee) {
    if (employee.id === context.employeeId) return this.requirePermission(context, 'employee.profile.read.self');
    if (employee.departmentId && employee.departmentId === context.departmentId) return this.requirePermission(context, 'employee.profile.read.team');
    return this.requirePermission(context, 'employee.profile.read.any');
  }
  async linkIdentity(context, userId, input) {
    this.requirePermission(context, 'organization.manage');
    userId = requiredId(userId, 'user id');
    const employeeId = requiredId(input?.employeeId, 'employee id');
    const employee = await this.employees.getById(context.companyId, employeeId);
    if (!employee) throw new HrmDomainError('HRM_NOT_FOUND', 'Employee was not found.', 404);
    try {
      return await this.db.transaction(async (client) => {
        const links = new this.identityLinks.constructor(client);
        const audit = new this.audit.constructor(client);
        const result = await links.upsert(context.companyId, userId, employee.id);
        await audit.append({ companyId: context.companyId, actorUserId: context.userId, actorEmployeeId: context.employeeId, action: 'hrm_identity_link.upserted', resourceType: 'hrm_identity_link', resourceId: userId, afterState: result, requestId: context.requestId });
        return result;
      });
    } catch (error) { return normalizeDatabaseError(error); }
  }
  async listIdentityLinkEmployees(context) {
    this.requirePermission(context, 'organization.manage');
    return { employees: await this.employees.list(context.companyId), links: await this.identityLinks.listForCompany(context.companyId) };
  }
  async unlinkIdentity(context, userId) {
    this.requirePermission(context, 'organization.manage');
    userId = requiredId(userId, 'user id');
    try {
      return await this.db.transaction(async (client) => {
        const links = new this.identityLinks.constructor(client);
        const audit = new this.audit.constructor(client);
        if (!await links.remove(context.companyId, userId)) throw new HrmDomainError('HRM_NOT_FOUND', 'Identity link was not found.', 404);
        await audit.append({ companyId: context.companyId, actorUserId: context.userId, actorEmployeeId: context.employeeId, action: 'hrm_identity_link.removed', resourceType: 'hrm_identity_link', resourceId: userId, requestId: context.requestId });
      });
    } catch (error) { return normalizeDatabaseError(error); }
  }

  async getCompany(companyId) {
    const company = await this.companies.getById(requiredId(companyId, 'company id'));
    if (!company) throw new HrmDomainError('HRM_NOT_FOUND', 'Company was not found.', 404);
    return company;
  }
  async createCompany(input, context = {}) {
    const { requestId, userId: actorUserId = null, employeeId: actorEmployeeId = null } = context;
    const company = { id: requiredId(input?.id, 'company id'), name: requiredText(input?.name, 'company name'), code: requiredText(input?.code, 'company code', 100).toUpperCase() };
    try {
      return await this.db.transaction(async (client) => {
        const companies = new this.companies.constructor(client); const audit = new this.audit.constructor(client);
        const result = await companies.create(company);
        await audit.append({ companyId: result.id, actorUserId, actorEmployeeId, action: 'company.created', resourceType: 'company', resourceId: result.id, afterState: result, requestId });
        return result;
      });
    } catch (error) { return normalizeDatabaseError(error); }
  }
  async updateCompany(companyId, input, context = {}) {
    const { requestId, userId: actorUserId = null, employeeId: actorEmployeeId = null } = context;
    try {
      return await this.db.transaction(async (client) => {
        const companies = new this.companies.constructor(client); const audit = new this.audit.constructor(client);
        const existing = await companies.getById(requiredId(companyId, 'company id'));
        if (!existing) throw new HrmDomainError('HRM_NOT_FOUND', 'Company was not found.', 404);
        const company = { name: input?.name === undefined ? existing.name : requiredText(input.name, 'company name'), code: input?.code === undefined ? existing.code : requiredText(input.code, 'company code', 100).toUpperCase() };
        const result = await companies.update(existing.id, company);
        await audit.append({ companyId: result.id, actorUserId, actorEmployeeId, action: 'company.updated', resourceType: 'company', resourceId: result.id, beforeState: existing, afterState: result, requestId });
        return result;
      });
    } catch (error) { return normalizeDatabaseError(error); }
  }
  async deleteCompany(companyId, context = {}) {
    const { requestId, userId: actorUserId = null, employeeId: actorEmployeeId = null } = context;
    try {
      return await this.db.transaction(async (client) => {
        const companies = new this.companies.constructor(client); const audit = new this.audit.constructor(client);
        const existing = await companies.getById(requiredId(companyId, 'company id'));
        if (!existing) throw new HrmDomainError('HRM_NOT_FOUND', 'Company was not found.', 404);
        await companies.archive(existing.id);
        await audit.append({ companyId: existing.id, actorUserId, actorEmployeeId, action: 'company.archived', resourceType: 'company', resourceId: existing.id, beforeState: existing, requestId });
      });
    } catch (error) { return normalizeDatabaseError(error); }
  }

  async listEmployees(companyId, query = '') { return this.employees.list(requiredId(companyId, 'company id'), queryText(query)); }
  async getEmployee(companyId, id) {
    const employee = await this.employees.getById(requiredId(companyId, 'company id'), requiredId(id, 'employee id'));
    if (!employee) throw new HrmDomainError('HRM_NOT_FOUND', 'Employee was not found.', 404);
    return employee;
  }
  async getEmployeeProfile(context, id) {
    const companyId = requiredId(context.companyId, 'company id');
    const employee = await this.employees.getProfileById(requiredId(companyId, 'company id'), requiredId(id, 'employee id'));
    if (!employee) throw new HrmDomainError('HRM_RESOURCE_NOT_FOUND', 'The requested HRM resource was not found.', 404);
    this.requireEmployeeRead(context, { ...employee, departmentId: employee.department?.id ?? null });
    return employee;
  }
  async listLearningEmployees(context) { this.requirePermission(context, 'employee.profile.read.any'); return this.employees.listLearningProfiles(requiredId(context.companyId, 'company id')); }
  async searchLearningEmployees(context, query) { this.requirePermission(context, 'employee.profile.read.any'); return this.employees.searchLearningProfiles(requiredId(context.companyId, 'company id'), requiredText(query, 'search query', 100)); }
  async listLearningDepartments(context) {
    this.requirePermission(context, 'employee.profile.read.any');
    return this.departments.listLearningDepartments(requiredId(context.companyId, 'company id'));
  }
  async getLearningDepartmentMembers(context, id) {
    this.requirePermission(context, 'employee.profile.read.any');
    id = requiredId(id, 'department id');
    if (!await this.departments.getLearningById(context.companyId, id)) throw new HrmDomainError('HRM_RESOURCE_NOT_FOUND', 'The requested HRM resource was not found.', 404);
    return this.departments.listLearningMembers(context.companyId, id);
  }
  async getLearningEmployeeAttendance(context, id) {
    id = requiredId(id, 'employee id');
    const employee = await this.employees.getById(context.companyId, id);
    if (!employee) throw new HrmDomainError('HRM_RESOURCE_NOT_FOUND', 'The requested HRM resource was not found.', 404);
    if (employee.id === context.employeeId) this.requirePermission(context, 'attendance.read.self');
    else if (employee.departmentId === context.departmentId) this.requirePermission(context, 'attendance.read.team');
    else this.requirePermission(context, 'employee.profile.read.any');
    return this.attendance.forLearningEmployee(context.companyId, id);
  }
  async getLearningEmployeeLeaveRequests(context, id) {
    id = requiredId(id, 'employee id');
    if (id !== context.employeeId) throw new HrmDomainError('HRM_FORBIDDEN', 'You do not have permission to perform this action.', 403);
    this.requirePermission(context, 'leave.read.self');
    return this.leave.requests(context.companyId, id);
  }
  async createLearningLeaveRequest(context, input) {
    this.requirePermission(context, 'leave.request.self');
    const employeeId = context.employeeId;
    const leaveTypeId = requiredId(input?.leaveTypeId, 'leave type id');
    const startDate = isoDate(input?.startDate, 'start date'); const endDate = isoDate(input?.endDate, 'end date');
    if (startDate > endDate) throw new HrmDomainError('HRM_VALIDATION_FAILED', 'Leave dates are not valid.');
    const requestedDays = Number(input?.requestedDays);
    if (!Number.isFinite(requestedDays) || requestedDays <= 0) throw new HrmDomainError('HRM_VALIDATION_FAILED', 'Requested leave days must be positive.');
    const reason = input?.reason == null ? null : requiredText(input.reason, 'reason', 1000);
    const result = await this.leave.create(context.companyId, employeeId, { leaveTypeId, startDate, endDate, requestedDays, reason });
    if (!result) throw new HrmDomainError('HRM_RESOURCE_NOT_FOUND', 'The requested HRM resource was not found.', 404);
    return result;
  }
  async listLearningProjects(context) { return this.tasks.learningProjects(requiredId(context.companyId, 'company id')); }
  async listLearningProjectTasks(context, id) {
    id = requiredId(id, 'project id');
    if (!await this.tasks.learningProject(context.companyId, id)) throw new HrmDomainError('HRM_RESOURCE_NOT_FOUND', 'The requested HRM resource was not found.', 404);
    return this.tasks.learningProjectTasks(context.companyId, id);
  }
  async updateLearningTaskStatus(context, id, input) {
    return this.updateTaskStatus(context, requiredId(id, 'task id'), input);
  }
  normalizeEmployee(input, existing = {}) {
    return {
      id: existing.id ?? requiredId(input?.id, 'employee id'),
      departmentId: input?.departmentId === undefined ? (existing.departmentId ?? null) : optionalId(input.departmentId, 'department id'),
      positionId: input?.positionId === undefined ? (existing.positionId ?? null) : optionalId(input.positionId, 'position id'),
      email: input?.email === undefined ? existing.email : email(input.email),
      displayName: input?.displayName === undefined ? existing.displayName : requiredText(input.displayName, 'display name'),
      title: input?.title === undefined ? existing.title : requiredText(input.title, 'title'),
      employmentStatus: input?.employmentStatus === undefined ? (existing.employmentStatus ?? 'active') : employmentStatus(input.employmentStatus),
    };
  }
  async createEmployee(companyId, input, context = {}) {
    const { requestId, userId: actorUserId = null, employeeId: actorEmployeeId = null } = context;
    companyId = requiredId(companyId, 'company id');
    const employee = this.normalizeEmployee(input);
    try {
      return await this.db.transaction(async (client) => {
        const employees = new this.employees.constructor(client); const audit = new this.audit.constructor(client);
        const result = await employees.create(companyId, employee);
        await audit.append({ companyId, actorUserId, actorEmployeeId, action: 'employee.created', resourceType: 'employee', resourceId: result.id, afterState: result, requestId });
        return result;
      });
    } catch (error) { return normalizeDatabaseError(error); }
  }
  async updateEmployee(companyId, id, input, context = {}) {
    const { requestId, userId: actorUserId = null, employeeId: actorEmployeeId = null } = context;
    try {
      return await this.db.transaction(async (client) => {
        const employees = new this.employees.constructor(client); const audit = new this.audit.constructor(client);
        const existing = await employees.getById(requiredId(companyId, 'company id'), requiredId(id, 'employee id'));
        if (!existing) throw new HrmDomainError('HRM_NOT_FOUND', 'Employee was not found.', 404);
        const result = await employees.update(existing.companyId, existing.id, this.normalizeEmployee(input, existing));
        await audit.append({ companyId: existing.companyId, actorUserId, actorEmployeeId, action: 'employee.updated', resourceType: 'employee', resourceId: result.id, beforeState: existing, afterState: result, requestId });
        return result;
      });
    } catch (error) { return normalizeDatabaseError(error); }
  }
  async deleteEmployee(companyId, id, context = {}) {
    const { requestId, userId: actorUserId = null, employeeId: actorEmployeeId = null } = context;
    try {
      return await this.db.transaction(async (client) => {
        const employees = new this.employees.constructor(client); const audit = new this.audit.constructor(client);
        const existing = await employees.getById(requiredId(companyId, 'company id'), requiredId(id, 'employee id'));
        if (!existing) throw new HrmDomainError('HRM_NOT_FOUND', 'Employee was not found.', 404);
        await employees.delete(existing.companyId, existing.id);
        await audit.append({ companyId: existing.companyId, actorUserId, actorEmployeeId, action: 'employee.deleted', resourceType: 'employee', resourceId: existing.id, beforeState: existing, requestId });
      });
    } catch (error) { return normalizeDatabaseError(error); }
  }

  async listDepartments(companyId, query = '') { return this.departments.list(requiredId(companyId, 'company id'), queryText(query)); }
  async getDepartment(companyId, id) {
    const department = await this.departments.getById(requiredId(companyId, 'company id'), requiredId(id, 'department id'));
    if (!department) throw new HrmDomainError('HRM_NOT_FOUND', 'Department was not found.', 404);
    return department;
  }
  async getDepartmentMembers(companyId, id) { await this.getDepartment(companyId, id); return this.departments.members(companyId, id); }
  async getDepartmentDetails(context, id) {
    const department = await this.departments.getDepartmentDetails(requiredId(context.companyId, 'company id'), requiredId(id, 'department id'));
    if (!department) throw new HrmDomainError('HRM_RESOURCE_NOT_FOUND', 'The requested HRM resource was not found.', 404);
    return department;
  }
  async getDepartmentOverview(context, id) {
    const departmentId = requiredId(id, 'department id');
    const department = await this.departments.getLearningById(context.companyId, departmentId);
    if (!department) throw new HrmDomainError('HRM_RESOURCE_NOT_FOUND', 'The requested HRM resource was not found.', 404);
    const members = await this.departments.listLearningMembers(context.companyId, departmentId);
    const overviewMembers = members.map(({ id: memberId, displayName, title, employmentStatus }) => ({ id: memberId, displayName, title, employmentStatus }));
    return {
      ...department,
      memberCount: overviewMembers.length,
      activeMemberCount: overviewMembers.filter((member) => member.employmentStatus === 'active').length,
      members: overviewMembers,
    };
  }
}
