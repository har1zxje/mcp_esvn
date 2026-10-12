import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { createDatabase } from '../src/database.js';
import { createHrmService, createServer } from '../src/app.js';

const integration = process.env.TEST_DATABASE_URL && process.env.DQE_TEST_DATABASE_URL ? test : test.skip;

integration('HTTP dynamic query denies company aggregates and keeps company-scoped lists', async () => {
  const suffix = randomUUID().replaceAll('-', '');
  const company = `dqe-company-${suffix}`;
  const foreignCompany = `dqe-foreign-${suffix}`;
  const role = `dqe-role-${suffix}`;
  const permissionId = `dqe-permission-${suffix}`;
  const actor = `dqe-actor-${suffix}`;
  const employeeIds = [`dqe-owner-${suffix}`, `dqe-peer-${suffix}`, `dqe-inactive-${suffix}`, `dqe-foreign-employee-${suffix}`];
  const db = createDatabase(process.env.TEST_DATABASE_URL);
  const queryDb = createDatabase(process.env.DQE_TEST_DATABASE_URL);
  const server = createServer(createHrmService(db, queryDb), { internalToken: 'dqe-integration-token' });
  try {
    await db.query('INSERT INTO companies (id,name,code) VALUES ($1,$2,$3),($4,$5,$6)', [company, 'DQE Test', `DQE${suffix.slice(0, 12)}`, foreignCompany, 'DQE Foreign', `DQF${suffix.slice(0, 12)}`]);
    for (const [index, id] of employeeIds.entries()) {
      const companyId = index === 3 ? foreignCompany : company;
      await db.query('INSERT INTO employees (id,company_id,email,display_name,title,employment_status) VALUES ($1,$2,$3,$4,$5,$6)', [id, companyId, `${id}@example.test`, `DQE Employee ${index}`, 'Tester', index === 2 ? 'inactive' : 'active']);
    }
    await db.query('INSERT INTO roles (id,code,name) VALUES ($1,$2,$3)', [role, `DQE_${suffix}`, 'DQE Test']);
    await db.query("INSERT INTO permissions (id,code,description) VALUES ($1,'employee.profile.read.any','DQE test') ON CONFLICT (code) DO NOTHING", [permissionId]);
    const permission = (await db.query("SELECT id FROM permissions WHERE code='employee.profile.read.any'")).rows[0].id;
    await db.query('INSERT INTO role_permissions (role_id,permission_id) VALUES ($1,$2)', [role, permission]);
    await db.query('INSERT INTO employee_roles (company_id,employee_id,role_id) VALUES ($1,$2,$3)', [company, employeeIds[0], role]);
    await db.query('INSERT INTO hrm_identity_links (company_id,chat_user_id,employee_id) VALUES ($1,$2,$3)', [company, actor, employeeIds[0]]);
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const query = { dataset: 'employees', filters: [{ field: 'employment_status', operator: 'eq', value: 'active' }], aggregations: [{ function: 'count', alias: 'total' }] };
    const headers = { 'content-type': 'application/json', 'x-hrm-internal-token': 'dqe-integration-token', 'x-hrm-contract-version': '1', 'x-actor-user-id': actor, 'x-request-id': `dqe-${suffix}` };
    const response = await fetch(`http://127.0.0.1:${server.address().port}/internal/v1/query`, { method: 'POST', headers, body: JSON.stringify(query) });
    assert.equal(response.status, 403);
    assert.equal((await response.json()).error.code, 'HRM_FORBIDDEN');
    const listed = await fetch(`http://127.0.0.1:${server.address().port}/internal/v1/query`, { method: 'POST', headers, body: JSON.stringify({ dataset: 'employees', select: ['id'], filters: [{ field: 'employment_status', operator: 'eq', value: 'active' }] }) });
    assert.equal(listed.status, 200);
    assert.deepEqual((await listed.json()).data.rows.map((row) => row.id), employeeIds.slice(0, 2));
    const foreign = await fetch(`http://127.0.0.1:${server.address().port}/internal/v1/query`, { method: 'POST', headers, body: JSON.stringify({ dataset: 'employees', select: ['id'], filters: [{ field: 'id', operator: 'eq', value: employeeIds[3] }] }) });
    assert.deepEqual((await foreign.json()).data.rows, []);
  } finally {
    if (server.listening) await new Promise((resolve) => server.close(resolve));
    await db.query('DELETE FROM companies WHERE id = ANY($1::text[])', [[company, foreignCompany]]).catch(() => {});
    await db.query('DELETE FROM roles WHERE id=$1', [role]).catch(() => {});
    await db.query('DELETE FROM permissions WHERE id=$1', [permissionId]).catch(() => {});
    await db.close();
    await queryDb.close();
  }
});
