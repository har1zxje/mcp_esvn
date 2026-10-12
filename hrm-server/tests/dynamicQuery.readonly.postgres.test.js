import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { createDatabase } from '../src/database.js';
import { createHrmService, createServer } from '../src/app.js';

const integration = process.env.TEST_DATABASE_URL && process.env.DQE_TEST_DATABASE_URL ? test : test.skip;

integration('DQE uses a separate PostgreSQL SELECT-only principal', async () => {
  const suffix = randomUUID().replaceAll('-', '');
  const company = `dqe-readonly-company-${suffix}`;
  const department = `dqe-readonly-department-${suffix}`;
  const employee = `dqe-readonly-employee-${suffix}`;
  const actor = `dqe-readonly-actor-${suffix}`;
  const role = `dqe-readonly-role-${suffix}`;
  const permissionId = `dqe-readonly-permission-${suffix}`;
  const newTable = `dqe_new_table_${suffix}`;
  const writer = createDatabase(process.env.TEST_DATABASE_URL);
  const reader = createDatabase(process.env.DQE_TEST_DATABASE_URL);
  const server = createServer(createHrmService(writer, reader), { internalToken: 'dqe-readonly-token' });
  try {
    const dbIdentity = (await reader.query('SELECT current_user AS name, current_database() AS database')).rows[0];
    assert.equal(dbIdentity.name, 'hrm_dqe_test_reader');
    assert.equal(dbIdentity.database, 'hrm_identity_test');
    const grants = (await reader.query(`SELECT
      has_table_privilege(current_user, 'companies', 'SELECT') AS companies,
      has_table_privilege(current_user, 'departments', 'SELECT') AS departments,
      has_table_privilege(current_user, 'employees', 'SELECT') AS employees,
      has_table_privilege(current_user, 'attendance_records', 'SELECT') AS attendance,
      has_table_privilege(current_user, 'leave_requests', 'SELECT') AS leave,
      has_table_privilege(current_user, 'hrm_identity_links', 'SELECT') AS identity,
      has_table_privilege(current_user, 'employees', 'INSERT, UPDATE, DELETE') AS write,
      has_schema_privilege(current_user, 'public', 'CREATE') AS ddl,
      has_database_privilege(current_user, current_database(), 'TEMPORARY') AS temporary`)).rows[0];
    assert.deepEqual(grants, { companies: true, departments: true, employees: true, attendance: true, leave: true, identity: false, write: false, ddl: false, temporary: false });
    const tableGrants = (await reader.query("SELECT table_name, privilege_type FROM information_schema.role_table_grants WHERE grantee = current_user AND table_schema = 'public' ORDER BY table_name, privilege_type")).rows;
    assert.deepEqual(tableGrants, ['attendance_records', 'companies', 'departments', 'employees', 'leave_requests'].map((table_name) => ({ table_name, privilege_type: 'SELECT' })));
    await writer.query('INSERT INTO companies (id,name,code) VALUES ($1,$2,$3)', [company, 'DQE readonly', `RO${suffix.slice(0, 12)}`]);
    await writer.query('INSERT INTO departments (id,company_id,name,code) VALUES ($1,$2,$3,$4)', [department, company, 'Readers', 'READERS']);
    await writer.query('INSERT INTO employees (id,company_id,department_id,email,display_name,title,employment_status) VALUES ($1,$2,$3,$4,$5,$6,$7)', [employee, company, department, `${employee}@example.invalid`, 'Reader Fixture', 'Tester', 'active']);
    await writer.query('INSERT INTO permissions (id,code,description) VALUES ($1,$2,$3) ON CONFLICT (code) DO NOTHING', [permissionId, 'employee.profile.read.any', 'test']);
    const permission = (await writer.query("SELECT id FROM permissions WHERE code = 'employee.profile.read.any'")).rows[0].id;
    await writer.query('INSERT INTO roles (id,code,name) VALUES ($1,$2,$3)', [role, role, 'DQE readonly test']);
    await writer.query('INSERT INTO role_permissions (role_id,permission_id) VALUES ($1,$2)', [role, permission]);
    await writer.query('INSERT INTO employee_roles (company_id,employee_id,role_id) VALUES ($1,$2,$3)', [company, employee, role]);
    await writer.query('INSERT INTO hrm_identity_links (company_id,chat_user_id,employee_id) VALUES ($1,$2,$3)', [company, actor, employee]);
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const response = await fetch(`http://127.0.0.1:${server.address().port}/internal/v1/query`, {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-hrm-internal-token': 'dqe-readonly-token', 'x-hrm-contract-version': '1', 'x-actor-user-id': actor, 'x-request-id': `readonly-${suffix}` },
      body: JSON.stringify({ dataset: 'employees', select: ['id'] }),
    });
    assert.equal(response.status, 200);
    assert.deepEqual((await response.json()).data.rows, [{ id: employee }]);
    const body = JSON.stringify({ dataset: 'employees', select: ['id'] });
    const headers = { 'content-type': 'application/json', 'x-hrm-internal-token': 'dqe-readonly-token', 'x-hrm-contract-version': '1', 'x-actor-user-id': actor, 'x-request-id': `readonly-${suffix}` };
    const missingReader = createServer(createHrmService(writer), { internalToken: 'dqe-readonly-token' });
    await new Promise((resolve) => missingReader.listen(0, '127.0.0.1', resolve));
    try {
      const denied = await fetch(`http://127.0.0.1:${missingReader.address().port}/internal/v1/query`, { method: 'POST', headers, body });
      assert.equal(denied.status, 503);
      assert.equal((await denied.json()).error.code, 'HRM_UNAVAILABLE');
    } finally { await new Promise((resolve) => missingReader.close(resolve)); }
    const unavailableUrl = new URL(process.env.DQE_TEST_DATABASE_URL);
    unavailableUrl.port = '1';
    const unavailableDb = createDatabase(unavailableUrl.toString());
    const unavailableServer = createServer(createHrmService(writer, unavailableDb), { internalToken: 'dqe-readonly-token' });
    await new Promise((resolve) => unavailableServer.listen(0, '127.0.0.1', resolve));
    try {
      const denied = await fetch(`http://127.0.0.1:${unavailableServer.address().port}/internal/v1/query`, { method: 'POST', headers, body });
      assert.equal(denied.status, 500);
      const payload = await denied.json();
      assert.equal(payload.error.code, 'HRM_INTERNAL');
      assert.equal(JSON.stringify(payload).includes(unavailableUrl.password), false);
    } finally {
      await new Promise((resolve) => unavailableServer.close(resolve));
      await unavailableDb.close();
    }
    await writer.query(`CREATE TABLE public.${newTable} (id integer)`);
    await assert.rejects(reader.query(`SELECT * FROM public.${newTable}`), (error) => error.code === '42501');
    for (const sql of [
      'INSERT INTO companies (id,name,code) VALUES (\'forbidden\',\'forbidden\',\'forbidden\')',
      `UPDATE employees SET title = 'forbidden' WHERE id = '${employee}'`,
      `DELETE FROM employees WHERE id = '${employee}'`,
      'CREATE TABLE public.dqe_forbidden (id integer)',
      'CREATE TEMP TABLE dqe_forbidden_temp (id integer)',
    ]) await assert.rejects(reader.query(sql), (error) => error.code === '42501');
    assert.equal((await writer.query('SELECT title FROM employees WHERE id=$1', [employee])).rows[0].title, 'Tester');
    await reader.transaction(async (client) => {
      await client.query('SET TRANSACTION READ ONLY');
      await client.query("SET LOCAL statement_timeout = '3000ms'");
      assert.equal((await client.query('SHOW transaction_read_only')).rows[0].transaction_read_only, 'on');
      assert.equal((await client.query('SHOW statement_timeout')).rows[0].statement_timeout, '3s');
    });
    await assert.rejects(reader.transaction(async (client) => {
      await client.query('SET TRANSACTION READ ONLY');
      await client.query("SET LOCAL statement_timeout = '3000ms'");
      await client.query('SELECT pg_sleep(3.2)');
    }), (error) => error.code === '57014');
  } finally {
    if (server.listening) await new Promise((resolve) => server.close(resolve));
    await writer.query(`DROP TABLE IF EXISTS public.${newTable}`).catch(() => {});
    await writer.query('DELETE FROM companies WHERE id=$1', [company]).catch(() => {});
    await writer.query('DELETE FROM roles WHERE id=$1', [role]).catch(() => {});
    await writer.query('DELETE FROM permissions WHERE id=$1', [permissionId]).catch(() => {});
    await reader.close();
    await writer.close();
  }
});
