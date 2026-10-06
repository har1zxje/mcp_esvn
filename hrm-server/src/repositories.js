const companyRecord = (row) => ({ id: row.id, name: row.name, code: row.code });
const departmentRecord = (row) => ({ id: row.id, companyId: row.company_id, name: row.name, code: row.code });
const employeeRecord = (row) => ({
  id: row.id,
  companyId: row.company_id,
  departmentId: row.department_id,
  positionId: row.position_id,
  email: row.email,
  displayName: row.display_name,
  title: row.title,
  employmentStatus: row.employment_status,
});
const dateValue = (value) => value instanceof Date
  ? `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`
  : value;
const timestampValue = (value) => value instanceof Date ? value.toISOString() : value;
const attendanceRecord = (row) => ({
  id: row.id,
  companyId: row.company_id,
  employeeId: row.employee_id,
  employeeDisplayName: row.display_name,
  workDate: dateValue(row.work_date),
  checkInAt: timestampValue(row.check_in_at),
  checkOutAt: timestampValue(row.check_out_at),
  status: row.status,
  minutesWorked: row.minutes_worked === null ? null : Number(row.minutes_worked),
  source: row.source,
});
const leaveRequestRecord = (row) => ({
  id: row.id,
  leaveTypeId: row.leave_type_id,
  leaveTypeCode: row.leave_type_code,
  leaveTypeName: row.leave_type_name,
  startDate: dateValue(row.start_date),
  endDate: dateValue(row.end_date),
  requestedDays: Number(row.requested_days),
  reason: row.reason,
  status: row.status,
  createdAt: timestampValue(row.created_at),
  updatedAt: timestampValue(row.updated_at),
});
const teamLeaveRequestRecord = (row) => ({
  ...leaveRequestRecord(row),
  employeeId: row.employee_id,
  employeeDisplayName: row.employee_display_name,
});

export class CompanyRepository {
  constructor(db) { this.db = db; }
  async getById(id) {
    const { rows } = await this.db.query('SELECT id, name, code FROM companies WHERE id = $1 AND archived_at IS NULL', [id]);
    return rows[0] ? companyRecord(rows[0]) : null;
  }
  async create({ id, name, code }) {
    const { rows } = await this.db.query('INSERT INTO companies (id, name, code) VALUES ($1, $2, $3) RETURNING id, name, code', [id, name, code]);
    return companyRecord(rows[0]);
  }
  async update(id, { name, code }) {
    const { rows } = await this.db.query('UPDATE companies SET name = $2, code = $3, updated_at = now() WHERE id = $1 AND archived_at IS NULL RETURNING id, name, code', [id, name, code]);
    return rows[0] ? companyRecord(rows[0]) : null;
  }
  async archive(id) { return (await this.db.query('UPDATE companies SET archived_at = now(), updated_at = now() WHERE id = $1 AND archived_at IS NULL', [id])).rowCount === 1; }
}

export class DepartmentRepository {
  constructor(db) { this.db = db; }
  async listLearningDepartments(companyId) {
    const { rows } = await this.db.query('SELECT id, name, code FROM departments WHERE company_id = $1 ORDER BY name, id', [companyId]);
    return rows.map((row) => ({ id: row.id, name: row.name, code: row.code }));
  }
  async getLearningById(companyId, id) {
    const { rows } = await this.db.query('SELECT id, name, code FROM departments WHERE company_id = $1 AND id = $2', [companyId, id]);
    return rows[0] ? { id: rows[0].id, name: rows[0].name, code: rows[0].code } : null;
  }
  async listLearningMembers(companyId, id) {
    const { rows } = await this.db.query(`SELECT id, email, display_name, title, employment_status
      FROM employees WHERE company_id = $1 AND department_id = $2 ORDER BY display_name, id`, [companyId, id]);
    return rows.map((row) => ({ id: row.id, displayName: row.display_name, email: row.email, title: row.title, employmentStatus: row.employment_status }));
  }
  async list(companyId, query = '') {
    const { rows } = await this.db.query(`SELECT id, company_id, name, code FROM departments WHERE company_id = $1 AND ($2 = '' OR name ILIKE '%' || $2 || '%' OR code ILIKE '%' || $2 || '%') ORDER BY name, id`, [companyId, query]);
    return rows.map(departmentRecord);
  }
  async getById(companyId, id) {
    const { rows } = await this.db.query('SELECT id, company_id, name, code FROM departments WHERE company_id = $1 AND id = $2', [companyId, id]);
    return rows[0] ? departmentRecord(rows[0]) : null;
  }
  async members(companyId, id) {
    const { rows } = await this.db.query('SELECT id, company_id, department_id, position_id, email, display_name, title, employment_status FROM employees WHERE company_id = $1 AND department_id = $2 ORDER BY display_name, id', [companyId, id]);
    return rows.map(employeeRecord);
  }
  async getDepartmentDetails(companyId, id) {
    const { rows } = await this.db.query(`SELECT d.id, d.name, d.code
      FROM departments d
      WHERE d.company_id = $1 AND d.id = $2`, [companyId, id]);
    if (!rows[0]) return null;
    const row = rows[0];
    return {
      id: row.id,
      name: row.name,
      code: row.code,
    };
  }
}

export class EmployeeRepository {
  constructor(db) { this.db = db; }
  async listLearningProfiles(companyId) {
    const { rows } = await this.db.query(`SELECT e.id, e.department_id, e.email, e.display_name, e.title, e.employment_status,
      d.name AS department_name, d.code AS department_code
      FROM employees e
      LEFT JOIN departments d ON d.company_id = e.company_id AND d.id = e.department_id
      WHERE e.company_id = $1 ORDER BY e.display_name, e.id`, [companyId]);
    return rows.map((row) => ({
      id: row.id,
      displayName: row.display_name,
      email: row.email,
      title: row.title,
      employmentStatus: row.employment_status,
      department: row.department_id ? { id: row.department_id, name: row.department_name, code: row.department_code } : null,
    }));
  }
  async searchLearningProfiles(companyId, query) {
    const { rows } = await this.db.query(`SELECT e.id, e.department_id, e.email, e.display_name, e.title, e.employment_status,
      d.name AS department_name, d.code AS department_code
      FROM employees e
      LEFT JOIN departments d ON d.company_id = e.company_id AND d.id = e.department_id
      WHERE e.company_id = $1 AND e.display_name ILIKE '%' || $2 || '%'
      ORDER BY e.display_name, e.id`, [companyId, query]);
    return rows.map((row) => ({
      id: row.id,
      displayName: row.display_name,
      email: row.email,
      title: row.title,
      employmentStatus: row.employment_status,
      department: row.department_id ? { id: row.department_id, name: row.department_name, code: row.department_code } : null,
    }));
  }
  async getProfileById(companyId, id) {
    const { rows } = await this.db.query(`SELECT e.id, e.department_id, e.email, e.display_name, e.title, e.employment_status,
      d.name AS department_name, d.code AS department_code
      FROM employees e
      LEFT JOIN departments d ON d.company_id = e.company_id AND d.id = e.department_id
      WHERE e.company_id = $1 AND e.id = $2`, [companyId, id]);
    if (!rows[0]) return null;
    const row = rows[0];
    return {
      id: row.id,
      displayName: row.display_name,
      email: row.email,
      title: row.title,
      employmentStatus: row.employment_status,
      department: row.department_id ? { id: row.department_id, name: row.department_name, code: row.department_code } : null,
    };
  }
  async list(companyId, query = '') {
    const { rows } = await this.db.query(`SELECT id, company_id, department_id, position_id, email, display_name, title, employment_status FROM employees WHERE company_id = $1 AND ($2 = '' OR display_name ILIKE '%' || $2 || '%') ORDER BY display_name, id`, [companyId, query]);
    return rows.map(employeeRecord);
  }
  async getById(companyId, id) {
    const { rows } = await this.db.query('SELECT id, company_id, department_id, position_id, email, display_name, title, employment_status FROM employees WHERE company_id = $1 AND id = $2', [companyId, id]);
    return rows[0] ? employeeRecord(rows[0]) : null;
  }
  async create(companyId, employee) {
    const { rows } = await this.db.query('INSERT INTO employees (id, company_id, department_id, position_id, email, display_name, title, employment_status) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id, company_id, department_id, position_id, email, display_name, title, employment_status', [employee.id, companyId, employee.departmentId, employee.positionId, employee.email, employee.displayName, employee.title, employee.employmentStatus]);
    return employeeRecord(rows[0]);
  }
  async update(companyId, id, employee) {
    const { rows } = await this.db.query('UPDATE employees SET department_id = $3, position_id = $4, email = $5, display_name = $6, title = $7, employment_status = $8, updated_at = now() WHERE company_id = $1 AND id = $2 RETURNING id, company_id, department_id, position_id, email, display_name, title, employment_status', [companyId, id, employee.departmentId, employee.positionId, employee.email, employee.displayName, employee.title, employee.employmentStatus]);
    return rows[0] ? employeeRecord(rows[0]) : null;
  }
  async delete(companyId, id) { return (await this.db.query('DELETE FROM employees WHERE company_id = $1 AND id = $2', [companyId, id])).rowCount === 1; }
}

export class AuditRepository {
  constructor(db) { this.db = db; }
  async append({ companyId, actorUserId = null, actorEmployeeId = null, action, resourceType, resourceId, beforeState = null, afterState = null, requestId }) {
    await this.db.query(
      'INSERT INTO audit_logs (company_id, actor_user_id, actor_employee_id, action, resource_type, resource_id, before_state, after_state, request_id) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)',
      [companyId, actorUserId, actorEmployeeId, action, resourceType, resourceId, beforeState, afterState, requestId],
    );
  }
}

export class AuthorizationRepository {
  constructor(db) { this.db = db; }
  /**
   * The sole HRM identity resolver.  The caller supplies only the authenticated
   * Chat user id; employee and company always come from hrm_identity_links.
   */
  async resolveActor(chatUserId) {
    const { rows } = await this.db.query(`SELECT e.id AS employee_id, e.company_id, e.department_id,
      COALESCE(array_remove(array_agg(DISTINCT r.code), NULL), '{}') AS roles,
      COALESCE(array_remove(array_agg(DISTINCT p.code), NULL), '{}') AS permissions
      FROM hrm_identity_links l
      JOIN employees e ON e.company_id = l.company_id AND e.id = l.employee_id
      JOIN companies c ON c.id = e.company_id AND c.archived_at IS NULL
      LEFT JOIN employee_roles er ON er.company_id = e.company_id AND er.employee_id = e.id
      LEFT JOIN roles r ON r.id = er.role_id
      LEFT JOIN role_permissions rp ON rp.role_id = r.id
      LEFT JOIN permissions p ON p.id = rp.permission_id
      WHERE l.chat_user_id = $1 AND e.employment_status = 'active'
      GROUP BY e.id, e.company_id, e.department_id`, [chatUserId]);
    if (!rows[0]) return null;
    return { chatUserId, employeeId: rows[0].employee_id, companyId: rows[0].company_id, departmentId: rows[0].department_id, roles: rows[0].roles, permissions: rows[0].permissions };
  }
}

export class IdentityLinkRepository {
  constructor(db) { this.db = db; }
  async upsert(companyId, chatUserId, employeeId) {
    const { rows } = await this.db.query(`INSERT INTO hrm_identity_links (company_id, chat_user_id, employee_id)
      VALUES ($1, $2, $3)
      ON CONFLICT (chat_user_id) DO UPDATE SET company_id = EXCLUDED.company_id,
        employee_id = EXCLUDED.employee_id, updated_at = now()
      RETURNING company_id, chat_user_id, employee_id`, [companyId, chatUserId, employeeId]);
    return { companyId: rows[0].company_id, userId: rows[0].chat_user_id, employeeId: rows[0].employee_id };
  }
  async listForCompany(companyId) {
    const { rows } = await this.db.query('SELECT chat_user_id, employee_id FROM hrm_identity_links WHERE company_id = $1 ORDER BY chat_user_id', [companyId]);
    return rows.map((row) => ({ userId: row.chat_user_id, employeeId: row.employee_id }));
  }
  async remove(companyId, chatUserId) {
    return (await this.db.query('DELETE FROM hrm_identity_links WHERE company_id = $1 AND chat_user_id = $2', [companyId, chatUserId])).rowCount === 1;
  }
}

export class LeaveRepository {
  constructor(db) { this.db = db; }
  async requests(companyId, employeeId) {
    const { rows } = await this.db.query(`SELECT r.id, r.leave_type_id, t.code AS leave_type_code, t.name AS leave_type_name, r.start_date, r.end_date, r.requested_days, r.reason, r.status, r.created_at, r.updated_at
      FROM leave_requests r JOIN leave_types t ON t.company_id = r.company_id AND t.id = r.leave_type_id
      WHERE r.company_id = $1 AND r.employee_id = $2 ORDER BY r.start_date DESC, r.id`, [companyId, employeeId]);
    return rows.map(leaveRequestRecord);
  }
  async pendingForDepartment(companyId, departmentId, actorEmployeeId) {
    const { rows } = await this.db.query(`SELECT r.id, r.employee_id, e.display_name AS employee_display_name, r.leave_type_id, t.code AS leave_type_code, t.name AS leave_type_name,
      r.start_date, r.end_date, r.requested_days, r.reason, r.status, r.created_at, r.updated_at
      FROM leave_requests r
      JOIN employees e ON e.company_id = r.company_id AND e.id = r.employee_id
      JOIN leave_types t ON t.company_id = r.company_id AND t.id = r.leave_type_id
      WHERE r.company_id = $1 AND e.department_id = $2 AND r.status = 'pending' AND r.employee_id <> $3
      ORDER BY r.start_date, r.created_at, r.id`, [companyId, departmentId, actorEmployeeId]);
    return rows.map(teamLeaveRequestRecord);
  }
  async balances(companyId, employeeId, year) {
    const { rows } = await this.db.query(`SELECT t.id AS leave_type_id, t.code, t.name, t.requires_balance, b.allocated_days, b.used_days
      FROM leave_types t LEFT JOIN leave_balances b ON b.company_id = t.company_id AND b.employee_id = $2 AND b.leave_type_id = t.id AND b.leave_year = $3
      WHERE t.company_id = $1 AND t.active = TRUE ORDER BY t.name, t.id`, [companyId, employeeId, year]);
    return rows.map((row) => {
      const allocatedDays = row.allocated_days === null ? null : Number(row.allocated_days);
      const usedDays = row.used_days === null ? null : Number(row.used_days);
      return { leaveTypeId: row.leave_type_id, code: row.code, name: row.name, requiresBalance: row.requires_balance, allocatedDays, usedDays, remainingDays: allocatedDays === null || usedDays === null ? null : allocatedDays - usedDays };
    });
  }
  async balance(companyId, employeeId, leaveTypeId, year) {
    const { rows } = await this.db.query('SELECT allocated_days, used_days FROM leave_balances WHERE company_id = $1 AND employee_id = $2 AND leave_type_id = $3 AND leave_year = $4 FOR UPDATE', [companyId, employeeId, leaveTypeId, year]);
    return rows[0] ?? null;
  }
  async balanceSnapshot(companyId, employeeId, leaveTypeId, year) {
    const { rows } = await this.db.query('SELECT allocated_days, used_days FROM leave_balances WHERE company_id = $1 AND employee_id = $2 AND leave_type_id = $3 AND leave_year = $4', [companyId, employeeId, leaveTypeId, year]);
    return rows[0] ?? null;
  }
  async type(companyId, id) { const { rows } = await this.db.query('SELECT id, requires_balance FROM leave_types WHERE company_id = $1 AND id = $2 AND active = TRUE', [companyId, id]); return rows[0] ?? null; }
  async typeByCode(companyId, code) {
    const { rows } = await this.db.query('SELECT id, code, name, requires_balance FROM leave_types WHERE company_id = $1 AND code = $2 AND active = TRUE', [companyId, code]);
    return rows[0] ?? null;
  }
  async hasOverlap(companyId, employeeId, startDate, endDate) {
    const { rows } = await this.db.query(`SELECT EXISTS(
      SELECT 1 FROM leave_requests
      WHERE company_id = $1 AND employee_id = $2 AND status IN ('pending', 'approved')
        AND start_date <= $4 AND end_date >= $3
    ) AS has_overlap`, [companyId, employeeId, startDate, endDate]);
    return rows[0]?.has_overlap === true;
  }
  async create(companyId, employeeId, input) { const { rows } = await this.db.query('INSERT INTO leave_requests (company_id, employee_id, leave_type_id, start_date, end_date, requested_days, reason) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id, status', [companyId, employeeId, input.leaveTypeId, input.startDate, input.endDate, input.requestedDays, input.reason ?? null]); return rows[0]; }
  async pending(companyId, id) { const { rows } = await this.db.query('SELECT r.*, e.department_id FROM leave_requests r JOIN employees e ON e.company_id=r.company_id AND e.id=r.employee_id WHERE r.company_id=$1 AND r.id=$2 AND r.status=$3 FOR UPDATE', [companyId, id, 'pending']); return rows[0] ?? null; }
  async approve(request) { const year = request.start_date instanceof Date ? request.start_date.getUTCFullYear() : Number(String(request.start_date).slice(0,4)); await this.db.query('UPDATE leave_balances SET used_days=used_days+$5, updated_at=now() WHERE company_id=$1 AND employee_id=$2 AND leave_type_id=$3 AND leave_year=$4', [request.company_id, request.employee_id, request.leave_type_id, year, request.requested_days]); await this.db.query('UPDATE leave_requests SET status=$3, updated_at=now() WHERE company_id=$1 AND id=$2', [request.company_id, request.id, 'approved']); }
  async cancel(companyId, employeeId, id) { const { rows } = await this.db.query("UPDATE leave_requests SET status='cancelled', updated_at=now() WHERE company_id=$1 AND employee_id=$2 AND id=$3 AND status='pending' RETURNING id,status", [companyId, employeeId, id]); return rows[0] ?? null; }
  async reject(request) { await this.db.query("UPDATE leave_requests SET status='rejected', updated_at=now() WHERE company_id=$1 AND id=$2", [request.company_id, request.id]); }
}

export class AttendanceRepository {
  constructor(db) { this.db = db; }
  async forLearningEmployee(companyId, employeeId) {
    const { rows } = await this.db.query(`SELECT a.id, a.company_id, a.employee_id, e.display_name, a.work_date, a.check_in_at, a.check_out_at, a.status, a.minutes_worked, a.source
      FROM attendance_records a JOIN employees e ON e.company_id = a.company_id AND e.id = a.employee_id
      WHERE a.company_id = $1 AND a.employee_id = $2
      ORDER BY a.work_date DESC, a.id`, [companyId, employeeId]);
    return rows.map(attendanceRecord);
  }
  async forEmployee(companyId, employeeId, { from, to }) {
    const { rows } = await this.db.query(`SELECT id, company_id, employee_id, work_date, check_in_at, check_out_at, status, minutes_worked, source
      FROM attendance_records WHERE company_id = $1 AND employee_id = $2 AND work_date BETWEEN $3 AND $4
      ORDER BY work_date DESC, id`, [companyId, employeeId, from, to]);
    return rows.map(attendanceRecord);
  }
  async forDepartment(companyId, departmentId, { from, to }) {
    const { rows } = await this.db.query(`SELECT a.id, a.company_id, a.employee_id, e.display_name, a.work_date, a.check_in_at, a.check_out_at, a.status, a.minutes_worked, a.source
      FROM attendance_records a JOIN employees e ON e.company_id = a.company_id AND e.id = a.employee_id
      WHERE a.company_id = $1 AND e.department_id = $2 AND a.work_date BETWEEN $3 AND $4
      ORDER BY a.work_date DESC, e.display_name, a.id`, [companyId, departmentId, from, to]);
    return rows.map(attendanceRecord);
  }
}

const projectRecord = (row) => ({ id: row.id, companyId: row.company_id, name: row.name, code: row.code, description: row.description, status: row.status, createdByEmployeeId: row.created_by_employee_id });
const taskRecord = (row) => ({
  id: row.id,
  companyId: row.company_id,
  projectId: row.project_id,
  projectName: row.project_name,
  title: row.title,
  description: row.description,
  status: row.status,
  priority: row.priority,
  dueDate: dateValue(row.due_date),
  createdByEmployeeId: row.created_by_employee_id,
  assignedEmployeeId: row.assigned_employee_id,
  assignedEmployeeDisplayName: row.assigned_employee_display_name,
  assignedEmployeeDepartmentId: row.assigned_employee_department_id,
});

export class TaskRepository {
  constructor(db) { this.db = db; }
  async learningProjects(companyId) {
    const { rows } = await this.db.query("SELECT id, company_id, name, code, description, status, created_by_employee_id FROM projects WHERE company_id = $1 AND status = 'active' ORDER BY name, id", [companyId]);
    return rows.map(projectRecord);
  }
  async learningProject(companyId, id) {
    const { rows } = await this.db.query("SELECT id, company_id, name, code, description, status, created_by_employee_id FROM projects WHERE company_id = $1 AND id = $2 AND status = 'active'", [companyId, id]);
    return rows[0] ? projectRecord(rows[0]) : null;
  }
  async learningProjectTasks(companyId, projectId) {
    const { rows } = await this.db.query(`SELECT t.id, t.company_id, t.project_id, p.name AS project_name, t.title, t.description, t.status, t.priority, t.due_date, t.created_by_employee_id,
      a.employee_id AS assigned_employee_id, e.display_name AS assigned_employee_display_name, e.department_id AS assigned_employee_department_id
      FROM tasks t JOIN projects p ON p.company_id = t.company_id AND p.id = t.project_id
      LEFT JOIN task_assignments a ON a.company_id = t.company_id AND a.task_id = t.id
      LEFT JOIN employees e ON e.company_id = a.company_id AND e.id = a.employee_id
      WHERE p.company_id = $1 AND p.id = $2 AND p.status = 'active' ORDER BY t.updated_at DESC, t.id`, [companyId, projectId]);
    return rows.map(taskRecord);
  }
  async learningTask(companyId, id, lock = false) {
    const { rows } = await this.db.query(`SELECT t.id, t.company_id, t.project_id, p.name AS project_name, t.title, t.description, t.status, t.priority, t.due_date, t.created_by_employee_id,
      a.employee_id AS assigned_employee_id, e.display_name AS assigned_employee_display_name, e.department_id AS assigned_employee_department_id
      FROM tasks t JOIN projects p ON p.company_id = t.company_id AND p.id = t.project_id
      LEFT JOIN task_assignments a ON a.company_id = t.company_id AND a.task_id = t.id
      LEFT JOIN employees e ON e.company_id = a.company_id AND e.id = a.employee_id
      WHERE t.company_id = $1 AND t.id = $2 AND p.status = 'active'${lock ? ' FOR UPDATE OF t' : ''}`, [companyId, id]);
    return rows[0] ? taskRecord(rows[0]) : null;
  }
  async project(companyId, id) {
    const { rows } = await this.db.query('SELECT id, company_id, name, code, description, status, created_by_employee_id FROM projects WHERE company_id = $1 AND id = $2 AND status = $3', [companyId, id, 'active']);
    return rows[0] ? projectRecord(rows[0]) : null;
  }
  async createProject(companyId, input, employeeId) {
    const { rows } = await this.db.query('INSERT INTO projects (id, company_id, name, code, description, created_by_employee_id) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id, company_id, name, code, description, status, created_by_employee_id', [input.id, companyId, input.name, input.code, input.description, employeeId]);
    return projectRecord(rows[0]);
  }
  async addProjectMember(companyId, projectId, employeeId, role = 'member') {
    await this.db.query('INSERT INTO project_members (company_id, project_id, employee_id, membership_role) VALUES ($1,$2,$3,$4) ON CONFLICT (company_id, project_id, employee_id) DO NOTHING', [companyId, projectId, employeeId, role]);
  }
  async employee(companyId, employeeId) {
    const { rows } = await this.db.query("SELECT id, department_id FROM employees WHERE company_id = $1 AND id = $2 AND employment_status = 'active'", [companyId, employeeId]);
    return rows[0] ?? null;
  }
  async createTask(companyId, projectId, input, employeeId) {
    const { rows } = await this.db.query('INSERT INTO tasks (company_id, project_id, title, description, priority, due_date, created_by_employee_id) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id', [companyId, projectId, input.title, input.description, input.priority, input.dueDate, employeeId]);
    return this.task(companyId, rows[0].id);
  }
  async task(companyId, id, lock = false) {
    const { rows } = await this.db.query(`SELECT t.id, t.company_id, t.project_id, p.name AS project_name, t.title, t.description, t.status, t.priority, t.due_date, t.created_by_employee_id,
      a.employee_id AS assigned_employee_id, e.display_name AS assigned_employee_display_name, e.department_id AS assigned_employee_department_id
      FROM tasks t JOIN projects p ON p.company_id = t.company_id AND p.id = t.project_id
      LEFT JOIN task_assignments a ON a.company_id = t.company_id AND a.task_id = t.id
      LEFT JOIN employees e ON e.company_id = a.company_id AND e.id = a.employee_id
      WHERE t.company_id = $1 AND t.id = $2${lock ? ' FOR UPDATE OF t' : ''}`, [companyId, id]);
    return rows[0] ? taskRecord(rows[0]) : null;
  }
  async assign(companyId, taskId, employeeId, assignedByEmployeeId) {
    await this.db.query('DELETE FROM task_assignments WHERE company_id = $1 AND task_id = $2', [companyId, taskId]);
    await this.db.query('INSERT INTO task_assignments (company_id, task_id, employee_id, assigned_by_employee_id) VALUES ($1,$2,$3,$4)', [companyId, taskId, employeeId, assignedByEmployeeId]);
  }
  async updateTask(companyId, taskId, input) {
    await this.db.query('UPDATE tasks SET title = $3, description = $4, priority = $5, due_date = $6, updated_at = now() WHERE company_id = $1 AND id = $2', [companyId, taskId, input.title, input.description, input.priority, input.dueDate]);
    return this.task(companyId, taskId);
  }
  async updateStatus(companyId, taskId, status) {
    await this.db.query('UPDATE tasks SET status = $3, updated_at = now() WHERE company_id = $1 AND id = $2', [companyId, taskId, status]);
    return this.task(companyId, taskId);
  }
  async mine(companyId, employeeId, status = '') {
    const { rows } = await this.db.query(`SELECT t.id, t.company_id, t.project_id, p.name AS project_name, t.title, t.description, t.status, t.priority, t.due_date, t.created_by_employee_id,
      a.employee_id AS assigned_employee_id, e.display_name AS assigned_employee_display_name, e.department_id AS assigned_employee_department_id
      FROM task_assignments a JOIN tasks t ON t.company_id = a.company_id AND t.id = a.task_id
      JOIN projects p ON p.company_id = t.company_id AND p.id = t.project_id
      JOIN employees e ON e.company_id = a.company_id AND e.id = a.employee_id
      WHERE a.company_id = $1 AND a.employee_id = $2 AND ($3 = '' OR t.status = $3) ORDER BY t.updated_at DESC, t.id`, [companyId, employeeId, status]);
    return rows.map(taskRecord);
  }
  async team(companyId, departmentId, status = '') {
    const { rows } = await this.db.query(`SELECT t.id, t.company_id, t.project_id, p.name AS project_name, t.title, t.description, t.status, t.priority, t.due_date, t.created_by_employee_id,
      a.employee_id AS assigned_employee_id, e.display_name AS assigned_employee_display_name, e.department_id AS assigned_employee_department_id
      FROM task_assignments a JOIN tasks t ON t.company_id = a.company_id AND t.id = a.task_id
      JOIN projects p ON p.company_id = t.company_id AND p.id = t.project_id
      JOIN employees e ON e.company_id = a.company_id AND e.id = a.employee_id
      WHERE a.company_id = $1 AND e.department_id = $2 AND ($3 = '' OR t.status = $3) ORDER BY t.updated_at DESC, t.id`, [companyId, departmentId, status]);
    return rows.map(taskRecord);
  }
}
