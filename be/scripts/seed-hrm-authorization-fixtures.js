import bcrypt from 'bcryptjs';
import { readFile } from 'node:fs/promises';
import dotenv from 'dotenv';
import { config } from '../src/config.js';
import { createDatabase as createChatDatabase, initializeDatabase } from '../src/database.js';
import { createDatabase as createHrmDatabase } from '../../hrm-server/src/database.js';

// Fixed UUIDs make the Chat User -> HRM identity link easy to audit.
const accounts = [
  { id: '10000000-0000-4000-8000-0000000000a1', email: 'minh.anh@hrm.test', name: 'Nguyễn Minh Anh', companyId: 'hrm-test-company-a', employeeId: 'hrm-test-employee-a1', departmentId: 'hrm-test-department-a', roleId: 'hrm-test-role-manager', roleCode: 'HRM_TEST_MANAGER', title: 'Manager' },
  { id: '10000000-0000-4000-8000-0000000000a2', email: 'khanh.linh@hrm.test', name: 'Trần Khánh Linh', companyId: 'hrm-test-company-a', employeeId: 'hrm-test-employee-a2', departmentId: 'hrm-test-department-a', roleId: 'hrm-test-role-employee', roleCode: 'HRM_TEST_EMPLOYEE', title: 'Employee' },
  { id: '20000000-0000-4000-8000-0000000000b1', email: 'quoc.bao@hrm.test', name: 'Lê Quốc Bảo', companyId: 'hrm-test-company-b', employeeId: 'hrm-test-employee-b1', departmentId: 'hrm-test-department-b', roleId: 'hrm-test-role-manager', roleCode: 'HRM_TEST_MANAGER', title: 'Manager' },
  { id: '20000000-0000-4000-8000-0000000000b2', email: 'ha.trang@hrm.test', name: 'Trương Hà Trang', companyId: 'hrm-test-company-b', employeeId: 'hrm-test-employee-b2', departmentId: 'hrm-test-department-b', roleId: 'hrm-test-role-employee', roleCode: 'HRM_TEST_EMPLOYEE', title: 'Employee' },
];
const password = process.env.HRM_TEST_PASSWORD;
if (typeof password !== 'string' || password.length < 4) throw new Error('Set HRM_TEST_PASSWORD to a development-only password of at least 4 characters.');
const chat = createChatDatabase({ connectionString: config.databaseUrl || undefined, host: config.databaseHost, port: config.databasePort, database: config.databaseName, user: config.databaseUser, password: config.databasePassword });
const hrmEnv = dotenv.parse(await readFile(new URL('../../hrm-server/.env', import.meta.url), 'utf8'));
const hrm = createHrmDatabase(hrmEnv.DATABASE_URL);
// The manager fixtures double as the explicit administrators for the manual
// identity-linking flow. Regular employees remain self-service only.
const managerPermissions = ['employee.profile.read.self', 'employee.profile.read.team', 'employee.profile.read.any', 'organization.manage'];
const employeePermissions = ['employee.profile.read.self'];
try {
  await initializeDatabase(chat, await readFile(new URL('../schema.sql', import.meta.url), 'utf8'));
  const passwordHash = await bcrypt.hash(password, 12);
  await chat.transaction(async (client) => {
    for (const account of accounts) {
      await client.query(`INSERT INTO users (id, email, display_name, password_hash) VALUES ($1, $2, $3, $4) ON CONFLICT (id) DO UPDATE SET email = EXCLUDED.email, display_name = EXCLUDED.display_name, password_hash = EXCLUDED.password_hash, updated_at = now()`, [account.id, account.email, account.name, passwordHash]);
    }
  });
  await hrm.transaction(async (client) => {
    for (const [id, name, code] of [['hrm-test-company-a', 'HRM Test Company A', 'HRM-TEST-A'], ['hrm-test-company-b', 'HRM Test Company B', 'HRM-TEST-B']]) await client.query(`INSERT INTO companies (id, name, code) VALUES ($1, $2, $3) ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, code = EXCLUDED.code, archived_at = NULL, updated_at = now()`, [id, name, code]);
    for (const [id, companyId, name, code] of [['hrm-test-department-a', 'hrm-test-company-a', 'Company A Team', 'TEST-A'], ['hrm-test-department-b', 'hrm-test-company-b', 'Company B Team', 'TEST-B']]) await client.query(`INSERT INTO departments (id, company_id, name, code) VALUES ($1, $2, $3, $4) ON CONFLICT (id) DO UPDATE SET company_id = EXCLUDED.company_id, name = EXCLUDED.name, code = EXCLUDED.code, updated_at = now()`, [id, companyId, name, code]);
    for (const [id, code, name] of [['hrm-test-role-manager', 'HRM_TEST_MANAGER', 'HRM Test Manager'], ['hrm-test-role-employee', 'HRM_TEST_EMPLOYEE', 'HRM Test Employee']]) await client.query(`INSERT INTO roles (id, code, name) VALUES ($1, $2, $3) ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name`, [id, code, name]);
    for (const code of [...new Set([...managerPermissions, ...employeePermissions])]) await client.query(`INSERT INTO permissions (id, code, description) VALUES ($1, $2, $3) ON CONFLICT (code) DO NOTHING`, [`hrm-test-permission-${code.replaceAll('.', '-')}`, code, `HRM test permission: ${code}`]);
    await client.query(`DELETE FROM role_permissions WHERE role_id IN ('hrm-test-role-manager', 'hrm-test-role-employee')`);
    for (const [roleId, codes] of [['hrm-test-role-manager', managerPermissions], ['hrm-test-role-employee', employeePermissions]]) for (const code of codes) await client.query(`INSERT INTO role_permissions (role_id, permission_id) SELECT $1, id FROM permissions WHERE code = $2`, [roleId, code]);
    for (const account of accounts) {
      await client.query(`INSERT INTO employees (id, company_id, department_id, email, display_name, title, employment_status) VALUES ($1, $2, $3, $4, $5, $6, 'active') ON CONFLICT (id) DO UPDATE SET company_id = EXCLUDED.company_id, department_id = EXCLUDED.department_id, email = EXCLUDED.email, display_name = EXCLUDED.display_name, title = EXCLUDED.title, employment_status = 'active', updated_at = now()`, [account.employeeId, account.companyId, account.departmentId, account.email, account.name, account.title]);
      await client.query(`DELETE FROM employee_roles WHERE company_id = $1 AND employee_id = $2`, [account.companyId, account.employeeId]);
      await client.query(`INSERT INTO employee_roles (company_id, employee_id, role_id) VALUES ($1, $2, $3)`, [account.companyId, account.employeeId, account.roleId]);
      await client.query(`INSERT INTO hrm_identity_links (company_id, chat_user_id, employee_id) VALUES ($1, $2, $3) ON CONFLICT (chat_user_id) DO UPDATE SET company_id = EXCLUDED.company_id, employee_id = EXCLUDED.employee_id, updated_at = now()`, [account.companyId, account.id, account.employeeId]);
    }
  });
  console.log(JSON.stringify({ event: 'hrm.authorization_fixtures.seeded', accounts: accounts.map(({ email, id, employeeId, companyId, roleCode }) => ({ email, chatUserId: id, employeeId, companyId, role: roleCode })) }, null, 2));
} finally { await Promise.allSettled([chat.close(), hrm.close()]); }

export { accounts };
