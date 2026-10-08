import { createDatabase } from './database.js';

const companies = [
  ['dev-company-a', 'Công ty Công nghệ Sao Việt', 'SAO-VIET'],
  ['dev-company-b', 'Công ty Logistics Minh An', 'MINH-AN'],
];
const departments = [
  ['dept-product', 'dev-company-a', 'Sản phẩm', 'PRODUCT'], ['dept-operations', 'dev-company-a', 'Vận hành', 'OPERATIONS'],
  ['dept-engineering', 'dev-company-a', 'Kỹ thuật', 'ENGINEERING'], ['dept-people', 'dev-company-a', 'Nhân sự', 'PEOPLE'], ['dept-finance', 'dev-company-a', 'Tài chính - Kế toán', 'FINANCE'],
  ['dept-sales', 'dev-company-a', 'Kinh doanh', 'SALES'], ['dept-logistics', 'dev-company-b', 'Điều phối vận tải', 'LOGISTICS'],
  ['dept-warehouse', 'dev-company-b', 'Kho vận', 'WAREHOUSE'], ['dept-customer-success', 'dev-company-b', 'Chăm sóc khách hàng', 'CUSTOMER-SUCCESS'],
];
const positions = [
  ['position-product-builder', 'dev-company-a', 'Product Manager', 'PRODUCT-MANAGER'], ['position-operations-builder', 'dev-company-a', 'Operations Manager', 'OPERATIONS-MANAGER'],
  ['position-backend-engineer', 'dev-company-a', 'Backend Engineer', 'BACKEND-ENGINEER'], ['position-frontend-engineer', 'dev-company-a', 'Frontend Engineer', 'FRONTEND-ENGINEER'],
  ['position-qa-engineer', 'dev-company-a', 'QA Engineer', 'QA-ENGINEER'], ['position-hr-specialist', 'dev-company-a', 'HR Specialist', 'HR-SPECIALIST'],
  ['position-accountant', 'dev-company-a', 'Senior Accountant', 'SENIOR-ACCOUNTANT'], ['position-sales-executive', 'dev-company-a', 'Sales Executive', 'SALES-EXECUTIVE'],
  ['position-logistics-manager', 'dev-company-b', 'Logistics Manager', 'LOGISTICS-MANAGER'], ['position-dispatcher', 'dev-company-b', 'Transport Dispatcher', 'TRANSPORT-DISPATCHER'],
  ['position-warehouse-supervisor', 'dev-company-b', 'Warehouse Supervisor', 'WAREHOUSE-SUPERVISOR'], ['position-customer-specialist', 'dev-company-b', 'Customer Success Specialist', 'CUSTOMER-SUCCESS-SPECIALIST'],
];
const employees = [
  ['employee-a1', 'dev-company-a', 'dept-product', 'position-product-builder', 'minh.anh@sao-viet.test', 'Nguyễn Minh Anh', 'Product Manager', 'active'],
  ['employee-a3', 'dev-company-a', 'dept-product', 'position-product-builder', 'gia.huy@sao-viet.test', 'Trần Gia Huy', 'Product Analyst', 'active'],
  ['employee-a4', 'dev-company-a', 'dept-product', 'position-product-builder', 'thanh.ha@sao-viet.test', 'Lê Thanh Hà', 'Product Designer', 'inactive'],
  ['employee-a2', 'dev-company-a', 'dept-engineering', 'position-qa-engineer', 'khanh.linh@sao-viet.test', 'Trần Khánh Linh', 'QA Engineer', 'active'],
  ['employee-b1', 'dev-company-a', 'dept-operations', 'position-operations-builder', 'quoc.bao@sao-viet.test', 'Lê Quốc Bảo', 'Operations Manager', 'active'],
  ['emp-svt-backend-huy', 'dev-company-a', 'dept-engineering', 'position-backend-engineer', 'duc.huy@sao-viet.test', 'Phạm Đức Huy', 'Backend Engineer', 'active'],
  ['emp-svt-frontend-thao', 'dev-company-a', 'dept-engineering', 'position-frontend-engineer', 'thu.thao@sao-viet.test', 'Vũ Thu Thảo', 'Frontend Engineer', 'active'],
  ['emp-svt-hr-quynh', 'dev-company-a', 'dept-people', 'position-hr-specialist', 'mai.quynh@sao-viet.test', 'Đỗ Mai Quỳnh', 'HR Specialist', 'active'],
  ['emp-svt-finance-tuan', 'dev-company-a', 'dept-finance', 'position-accountant', 'anh.tuan@sao-viet.test', 'Bùi Anh Tuấn', 'Senior Accountant', 'active'],
  ['emp-svt-sales-nam', 'dev-company-a', 'dept-sales', 'position-sales-executive', 'gia.nam@sao-viet.test', 'Hoàng Gia Nam', 'Sales Executive', 'active'],
  ['emp-svt-sales-nhi', 'dev-company-a', 'dept-sales', 'position-sales-executive', 'thao.nhi@sao-viet.test', 'Ngô Thảo Nhi', 'Sales Executive', 'inactive'],
  ['emp-man-logistics-lam', 'dev-company-b', 'dept-logistics', 'position-logistics-manager', 'tuan.lam@minh-an.test', 'Nguyễn Tuấn Lâm', 'Logistics Manager', 'active'],
  ['emp-man-dispatch-trang', 'dev-company-b', 'dept-logistics', 'position-dispatcher', 'ha.trang@minh-an.test', 'Trương Hà Trang', 'Transport Dispatcher', 'active'],
  ['emp-man-dispatch-kiet', 'dev-company-b', 'dept-logistics', 'position-dispatcher', 'minh.kiet@minh-an.test', 'Lý Minh Kiệt', 'Transport Dispatcher', 'active'],
  ['emp-man-warehouse-yen', 'dev-company-b', 'dept-warehouse', 'position-warehouse-supervisor', 'bao.yen@minh-an.test', 'Đặng Bảo Yến', 'Warehouse Supervisor', 'active'],
  ['emp-man-cs-vy', 'dev-company-b', 'dept-customer-success', 'position-customer-specialist', 'ngoc.vy@minh-an.test', 'Phan Ngọc Vy', 'Customer Success Specialist', 'active'],
];
const roles = [['role-employee', 'EMPLOYEE', 'Employee'], ['role-manager', 'MANAGER', 'Manager'], ['role-hr', 'HR', 'Human Resources'], ['role-admin', 'ADMIN', 'Administrator']];
const permissions = [
  ['permission-profile-self', 'employee.profile.read.self', 'Read own employee profile'], ['permission-profile-team', 'employee.profile.read.team', 'Read team employee profiles'],
  ['permission-profile-any', 'employee.profile.read.any', 'Read employee profiles across the company'],
  ['permission-leave-read-self', 'leave.read.self', 'Read personal leave balances'], ['permission-leave-self', 'leave.request.self', 'Request personal leave'], ['permission-leave-approve', 'leave.approve.team', 'Approve team leave'],
  ['permission-attendance-self', 'attendance.read.self', 'Read own attendance'], ['permission-attendance-team', 'attendance.read.team', 'Read team attendance'],
  ['permission-task-read-self', 'task.read.self', 'Read own tasks'], ['permission-task-read-team', 'task.read.team', 'Read team tasks'],
  ['permission-task-update-self', 'task.update.self', 'Update own assigned task status'], ['permission-task-manage-team', 'task.manage.team', 'Create and manage team tasks'],
  ['permission-organization-manage', 'organization.manage', 'Manage organization data'],
];
const rolePermissions = [
  ['role-employee', 'permission-profile-self'], ['role-employee', 'permission-leave-read-self'], ['role-employee', 'permission-leave-self'], ['role-employee', 'permission-attendance-self'], ['role-employee', 'permission-task-read-self'], ['role-employee', 'permission-task-update-self'],
  ['role-manager', 'permission-profile-self'], ['role-manager', 'permission-profile-team'], ['role-manager', 'permission-leave-read-self'], ['role-manager', 'permission-leave-self'], ['role-manager', 'permission-leave-approve'], ['role-manager', 'permission-attendance-self'], ['role-manager', 'permission-attendance-team'], ['role-manager', 'permission-task-read-self'], ['role-manager', 'permission-task-read-team'], ['role-manager', 'permission-task-update-self'], ['role-manager', 'permission-task-manage-team'],
  ['role-hr', 'permission-profile-self'], ['role-hr', 'permission-profile-team'], ['role-hr', 'permission-profile-any'], ['role-hr', 'permission-organization-manage'],
  ['role-admin', 'permission-profile-self'], ['role-admin', 'permission-profile-team'], ['role-admin', 'permission-profile-any'], ['role-admin', 'permission-organization-manage'],
];
const employeeRoles = [
  ['dev-company-a', 'employee-a1', 'role-manager'], ['dev-company-a', 'employee-a2', 'role-employee'], ['dev-company-a', 'employee-b1', 'role-manager'],
  ['dev-company-a', 'emp-svt-hr-quynh', 'role-hr'], ['dev-company-a', 'emp-svt-backend-huy', 'role-employee'], ['dev-company-a', 'emp-svt-frontend-thao', 'role-employee'],
  ['dev-company-a', 'emp-svt-finance-tuan', 'role-employee'], ['dev-company-a', 'emp-svt-sales-nam', 'role-employee'], ['dev-company-a', 'emp-svt-sales-nhi', 'role-employee'],
  ['dev-company-b', 'emp-man-logistics-lam', 'role-manager'], ['dev-company-b', 'emp-man-dispatch-trang', 'role-employee'], ['dev-company-b', 'emp-man-dispatch-kiet', 'role-employee'],
  ['dev-company-b', 'emp-man-warehouse-yen', 'role-manager'], ['dev-company-b', 'emp-man-cs-vy', 'role-employee'],
];
const identityLinks = [
  ['dev-company-a', '30000000-0000-4000-8000-000000000001', 'employee-a1'], ['dev-company-a', '30000000-0000-4000-8000-000000000002', 'employee-a2'], ['dev-company-a', '30000000-0000-4000-8000-000000000003', 'emp-svt-hr-quynh'],
  ['dev-company-b', '30000000-0000-4000-8000-000000000004', 'emp-man-logistics-lam'], ['dev-company-b', '30000000-0000-4000-8000-000000000005', 'emp-man-dispatch-trang'],
];
const leaveTypes = [
  ['leave-annual-sao-viet', 'dev-company-a', 'ANNUAL', 'Nghỉ phép năm', true], ['leave-sick-sao-viet', 'dev-company-a', 'SICK', 'Nghỉ ốm', false], ['leave-personal-sao-viet', 'dev-company-a', 'PERSONAL', 'Nghỉ việc riêng', true],
  ['leave-annual-minh-an', 'dev-company-b', 'ANNUAL', 'Nghỉ phép năm', true], ['leave-sick-minh-an', 'dev-company-b', 'SICK', 'Nghỉ ốm', false], ['leave-personal-minh-an', 'dev-company-b', 'PERSONAL', 'Nghỉ việc riêng', true],
];
const leaveBalances = [
  ['dev-company-a', 'employee-a1', 'leave-annual-sao-viet', 2026, 15], ['dev-company-a', 'employee-a2', 'leave-annual-sao-viet', 2026, 12], ['dev-company-a', 'employee-b1', 'leave-annual-sao-viet', 2026, 15],
  ['dev-company-a', 'emp-svt-backend-huy', 'leave-annual-sao-viet', 2026, 12], ['dev-company-a', 'emp-svt-frontend-thao', 'leave-annual-sao-viet', 2026, 12], ['dev-company-a', 'emp-svt-hr-quynh', 'leave-annual-sao-viet', 2026, 15],
  ['dev-company-b', 'emp-man-logistics-lam', 'leave-annual-minh-an', 2026, 15], ['dev-company-b', 'emp-man-dispatch-trang', 'leave-annual-minh-an', 2026, 12], ['dev-company-b', 'emp-man-dispatch-kiet', 'leave-annual-minh-an', 2026, 12], ['dev-company-b', 'emp-man-warehouse-yen', 'leave-annual-minh-an', 2026, 15],
];
const attendanceRecords = [
  ['dev-company-a', 'employee-a1', '2026-09-21', '2026-09-21T01:00:00.000Z', '2026-09-21T09:00:00.000Z', 'present', 480, 'import'],
  ['dev-company-a', 'employee-a2', '2026-09-21', '2026-09-21T01:10:00.000Z', '2026-09-21T09:10:00.000Z', 'late', 480, 'import'],
  ['dev-company-a', 'emp-svt-backend-huy', '2026-09-21', '2026-09-21T01:00:00.000Z', '2026-09-21T09:00:00.000Z', 'remote', 480, 'import'],
  ['dev-company-a', 'emp-svt-frontend-thao', '2026-09-21', null, null, 'absent', null, 'import'],
  ['dev-company-a', 'employee-a1', '2026-09-22', '2026-09-22T01:00:00.000Z', '2026-09-22T09:00:00.000Z', 'present', 480, 'import'],
  ['dev-company-b', 'emp-man-logistics-lam', '2026-09-21', '2026-09-21T01:00:00.000Z', '2026-09-21T09:00:00.000Z', 'present', 480, 'import'],
  ['dev-company-b', 'emp-man-dispatch-trang', '2026-09-21', '2026-09-21T01:15:00.000Z', '2026-09-21T09:15:00.000Z', 'late', 480, 'import'],
];

const db = createDatabase();
try {
  await db.transaction(async (client) => {
    for (const [id, name, code] of companies) await client.query('INSERT INTO companies (id, name, code) VALUES ($1, $2, $3) ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, code = EXCLUDED.code, archived_at = NULL, updated_at = now()', [id, name, code]);
    for (const [id, companyId, name, code] of departments) await client.query('INSERT INTO departments (id, company_id, name, code) VALUES ($1, $2, $3, $4) ON CONFLICT (id) DO UPDATE SET company_id = EXCLUDED.company_id, name = EXCLUDED.name, code = EXCLUDED.code, updated_at = now()', [id, companyId, name, code]);
    for (const [id, companyId, name, code] of positions) await client.query('INSERT INTO positions (id, company_id, name, code) VALUES ($1, $2, $3, $4) ON CONFLICT (id) DO UPDATE SET company_id = EXCLUDED.company_id, name = EXCLUDED.name, code = EXCLUDED.code, updated_at = now()', [id, companyId, name, code]);
    for (const employee of employees) await client.query('INSERT INTO employees (id, company_id, department_id, position_id, email, display_name, title, employment_status) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) ON CONFLICT (id) DO UPDATE SET company_id = EXCLUDED.company_id, department_id = EXCLUDED.department_id, position_id = EXCLUDED.position_id, email = EXCLUDED.email, display_name = EXCLUDED.display_name, title = EXCLUDED.title, employment_status = EXCLUDED.employment_status, updated_at = now()', employee);
    for (const [id, code, name] of roles) await client.query('INSERT INTO roles (id, code, name) VALUES ($1, $2, $3) ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name', [id, code, name]);
    for (const [id, code, description] of permissions) await client.query('INSERT INTO permissions (id, code, description) VALUES ($1, $2, $3) ON CONFLICT (code) DO UPDATE SET description = EXCLUDED.description', [id, code, description]);
    const roleIdByCode = new Map((await client.query('SELECT id, code FROM roles WHERE code = ANY($1::text[])', [roles.map(([, code]) => code)])).rows.map((row) => [row.code, row.id]));
    const permissionIdByCode = new Map((await client.query('SELECT id, code FROM permissions WHERE code = ANY($1::text[])', [permissions.map(([, code]) => code)])).rows.map((row) => [row.code, row.id]));
    const roleCodeBySeedId = new Map(roles.map(([id, code]) => [id, code]));
    const permissionCodeBySeedId = new Map(permissions.map(([id, code]) => [id, code]));
    for (const [seedRoleId, seedPermissionId] of rolePermissions) await client.query('INSERT INTO role_permissions (role_id, permission_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [roleIdByCode.get(roleCodeBySeedId.get(seedRoleId)), permissionIdByCode.get(permissionCodeBySeedId.get(seedPermissionId))]);
    for (const [companyId, employeeId, seedRoleId] of employeeRoles) await client.query('INSERT INTO employee_roles (company_id, employee_id, role_id) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING', [companyId, employeeId, roleIdByCode.get(roleCodeBySeedId.get(seedRoleId))]);
    for (const [companyId, chatUserId, employeeId] of identityLinks) await client.query('INSERT INTO hrm_identity_links (company_id, chat_user_id, employee_id) VALUES ($1, $2, $3) ON CONFLICT (company_id, chat_user_id) DO UPDATE SET employee_id = EXCLUDED.employee_id, updated_at = now()', [companyId, chatUserId, employeeId]);
    for (const [id, companyId, code, name, requiresBalance] of leaveTypes) await client.query('INSERT INTO leave_types (id, company_id, code, name, requires_balance) VALUES ($1, $2, $3, $4, $5) ON CONFLICT (id) DO UPDATE SET code = EXCLUDED.code, name = EXCLUDED.name, requires_balance = EXCLUDED.requires_balance, updated_at = now()', [id, companyId, code, name, requiresBalance]);
    for (const [companyId, employeeId, leaveTypeId, leaveYear, allocatedDays] of leaveBalances) await client.query('INSERT INTO leave_balances (company_id, employee_id, leave_type_id, leave_year, allocated_days) VALUES ($1, $2, $3, $4, $5) ON CONFLICT (company_id, employee_id, leave_type_id, leave_year) DO UPDATE SET allocated_days = EXCLUDED.allocated_days, updated_at = now()', [companyId, employeeId, leaveTypeId, leaveYear, allocatedDays]);
    for (const [companyId, employeeId, workDate, checkInAt, checkOutAt, status, minutesWorked, source] of attendanceRecords) await client.query('INSERT INTO attendance_records (company_id, employee_id, work_date, check_in_at, check_out_at, status, minutes_worked, source) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT (company_id, employee_id, work_date) DO UPDATE SET check_in_at = EXCLUDED.check_in_at, check_out_at = EXCLUDED.check_out_at, status = EXCLUDED.status, minutes_worked = EXCLUDED.minutes_worked, source = EXCLUDED.source, updated_at = now()', [companyId, employeeId, workDate, checkInAt, checkOutAt, status, minutesWorked, source]);
  });
  console.log(JSON.stringify({ event: 'hrm.seed.completed', companies: companies.length, departments: departments.length, positions: positions.length, employees: employees.length, leaveTypes: leaveTypes.length, leaveBalances: leaveBalances.length, attendanceRecords: attendanceRecords.length }));
} finally { await db.close(); }
