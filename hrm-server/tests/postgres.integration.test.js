import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { createDatabase } from '../src/database.js';
import { createHrmService, createServer } from '../src/app.js';

const databaseUrl = process.env.TEST_DATABASE_URL;
const integration = databaseUrl ? test : test.skip;

async function request(server, path, options = {}) {
  const response = await fetch(`http://127.0.0.1:${server.address().port}${path}`, options);
  return { status: response.status, body: response.status === 204 ? null : await response.json() };
}

integration('PostgreSQL migration-backed v1 API supports company and employee CRUD with company-scoped reads', async () => {
  const db = createDatabase(databaseUrl);
  const server = createServer(createHrmService(db), { internalToken: 'integration-token' });
  const suffix = randomUUID().replaceAll('-', '');
  const companyA = `test-company-a-${suffix}`;
  const companyB = `test-company-b-${suffix}`;
  const employeeId = `test-employee-${suffix}`;
  const requestHeaders = (companyId, actor = 'chat-admin-a') => ({ 'content-type': 'application/json', 'x-hrm-internal-token': 'integration-token', 'x-hrm-contract-version': '1', 'x-company-id': companyId, 'x-actor-user-id': actor, 'x-request-id': `test-${suffix}` });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    await db.query('INSERT INTO companies (id, name, code) VALUES ($1, $2, $3), ($4, $5, $6)', [companyA, 'Integration Company A', `A${suffix.slice(0, 8)}`, companyB, 'Integration Company B', `B${suffix.slice(0, 8)}`]);
    await db.query("INSERT INTO employees (id, company_id, email, display_name, title, employment_status) VALUES ($1, $2, $3, 'Integration Admin', 'Administrator', 'active')", [`admin-${suffix}`, companyA, `admin-${suffix}@example.test`]);
    await db.query('INSERT INTO roles (id, code, name) VALUES ($1, $2, $3)', [`role-${suffix}`, `INTEGRATION_ADMIN_${suffix}`, 'Integration Admin']);
    await db.query("INSERT INTO permissions (id, code, description) VALUES ($1, 'organization.manage', 'integration') ON CONFLICT (code) DO NOTHING", [`permission-${suffix}`]);
    const permission = (await db.query("SELECT id FROM permissions WHERE code = 'organization.manage' LIMIT 1")).rows[0].id;
    await db.query("INSERT INTO permissions (id, code, description) VALUES ($1, 'employee.profile.read.team', 'integration') ON CONFLICT (code) DO NOTHING", [`permission-team-${suffix}`]);
    const teamPermission = (await db.query("SELECT id FROM permissions WHERE code = 'employee.profile.read.team' LIMIT 1")).rows[0].id;
    await db.query('INSERT INTO role_permissions (role_id, permission_id) VALUES ($1, $2)', [`role-${suffix}`, permission]);
    await db.query('INSERT INTO role_permissions (role_id, permission_id) VALUES ($1, $2)', [`role-${suffix}`, teamPermission]);
    await db.query('INSERT INTO employee_roles (company_id, employee_id, role_id) VALUES ($1, $2, $3)', [companyA, `admin-${suffix}`, `role-${suffix}`]);
    await db.query('INSERT INTO hrm_identity_links (company_id, chat_user_id, employee_id) VALUES ($1, $2, $3)', [companyA, 'chat-admin-a', `admin-${suffix}`]);
    const created = await request(server, '/internal/v1/employees', { method: 'POST', headers: requestHeaders(companyA), body: JSON.stringify({ id: employeeId, email: `${employeeId}@example.test`, displayName: 'Integration Employee', title: 'Tester' }) });
    assert.equal(created.status, 201);
    assert.equal((await request(server, `/internal/v1/employees/${employeeId}`, { headers: requestHeaders(companyA) })).body.data.id, employeeId);
    const restarted = createServer(createHrmService(db), { internalToken: 'integration-token' });
    await new Promise((resolve) => restarted.listen(0, '127.0.0.1', resolve));
    try { assert.equal((await request(restarted, `/internal/v1/employees/${employeeId}`, { headers: requestHeaders(companyA) })).body.data.id, employeeId); }
    finally { await new Promise((resolve) => restarted.close(resolve)); }
    // A caller-supplied company header cannot switch the actor's company.
    assert.equal((await request(server, `/internal/v1/employees/${employeeId}`, { headers: requestHeaders(companyB) })).status, 200);
    const updated = await request(server, `/internal/v1/employees/${employeeId}`, { method: 'PATCH', headers: requestHeaders(companyA), body: JSON.stringify({ title: 'Senior Tester' }) });
    assert.equal(updated.body.data.title, 'Senior Tester');
    assert.equal((await request(server, `/internal/v1/employees/${employeeId}`, { method: 'DELETE', headers: requestHeaders(companyA) })).status, 204);
    const audit = await db.query('SELECT action, request_id FROM audit_logs WHERE company_id = $1 AND resource_id = $2 ORDER BY created_at', [companyA, employeeId]);
    assert.deepEqual(audit.rows.map((row) => row.action), ['employee.created', 'employee.updated', 'employee.deleted']);
    assert.ok(audit.rows.every((row) => row.request_id === `test-${suffix}`));
    assert.equal((await request(server, `/internal/v1/companies/${companyA}`, { method: 'DELETE', headers: requestHeaders(companyA) })).status, 204);
    assert.equal((await request(server, `/internal/v1/companies/${companyA}`, { headers: requestHeaders(companyA) })).status, 401);
    const archived = await db.query('SELECT action FROM audit_logs WHERE company_id = $1 AND resource_id = $1 ORDER BY created_at DESC LIMIT 1', [companyA]);
    assert.equal(archived.rows[0].action, 'company.archived');
  } finally {
    await db.query('DELETE FROM audit_logs WHERE company_id = ANY($1::text[])', [[companyA, companyB]]).catch(() => {});
    await db.query('DELETE FROM hrm_identity_links WHERE company_id = ANY($1::text[])', [[companyA, companyB]]).catch(() => {});
    await db.query('DELETE FROM companies WHERE id = ANY($1::text[])', [[companyA, companyB]]).catch(() => {});
    await new Promise((resolve) => server.close(resolve));
    await db.close();
  }
});

integration('identity-link provisioning is admin-only, company-scoped, and becomes the target user identity', async () => {
  const db = createDatabase(databaseUrl);
  const server = createServer(createHrmService(db), { internalToken: 'integration-token' });
  const suffix = randomUUID().replaceAll('-', '');
  const company = `identity-company-${suffix}`;
  const foreignCompany = `identity-foreign-${suffix}`;
  const admin = `identity-admin-${suffix}`;
  const target = `identity-target-${suffix}`;
  const foreignTarget = `identity-foreign-target-${suffix}`;
  const targetUser = `chat-identity-target-${suffix}`;
  const headers = (actor) => ({ 'content-type': 'application/json', 'x-hrm-internal-token': 'integration-token', 'x-hrm-contract-version': '1', 'x-actor-user-id': actor, 'x-request-id': `identity-${suffix}` });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    await db.query('INSERT INTO companies (id,name,code) VALUES ($1,$2,$3),($4,$5,$6)', [company, 'Identity Company', `IC${suffix.slice(0, 8)}`, foreignCompany, 'Foreign Identity Company', `IF${suffix.slice(0, 8)}`]);
    for (const [id, companyId, name] of [[admin, company, 'Identity Admin'], [target, company, 'Identity Target'], [foreignTarget, foreignCompany, 'Foreign Target']]) await db.query('INSERT INTO employees (id,company_id,email,display_name,title,employment_status) VALUES ($1,$2,$3,$4,$4,$5)', [id, companyId, `${id}@example.test`, name, 'active']);
    for (const code of ['organization.manage', 'employee.profile.read.self']) await db.query('INSERT INTO permissions (id,code,description) VALUES ($1,$2,$3) ON CONFLICT (code) DO NOTHING', [`identity-permission-${code.replaceAll('.', '-')}-${suffix}`, code, 'identity integration']);
    const permissions = Object.fromEntries((await db.query('SELECT id,code FROM permissions WHERE code = ANY($1::text[])', [['organization.manage', 'employee.profile.read.self']])).rows.map((row) => [row.code, row.id]));
    for (const [role, employeeId, codes] of [['admin', admin, ['organization.manage']], ['target', target, ['employee.profile.read.self']]]) {
      const roleId = `identity-role-${role}-${suffix}`;
      await db.query('INSERT INTO roles (id,code,name) VALUES ($1,$2,$3)', [roleId, `IDENTITY_${role}_${suffix}`, role]);
      for (const code of codes) await db.query('INSERT INTO role_permissions (role_id,permission_id) VALUES ($1,$2)', [roleId, permissions[code]]);
      await db.query('INSERT INTO employee_roles (company_id,employee_id,role_id) VALUES ($1,$2,$3)', [company, employeeId, roleId]);
    }
    await db.query('INSERT INTO hrm_identity_links (company_id,chat_user_id,employee_id) VALUES ($1,$2,$3)', [company, `chat-identity-admin-${suffix}`, admin]);
    const linked = await request(server, `/internal/v1/identity-links/${targetUser}`, { method: 'PUT', headers: headers(`chat-identity-admin-${suffix}`), body: JSON.stringify({ employeeId: target }) });
    assert.deepEqual(linked.body.data, { companyId: company, userId: targetUser, employeeId: target });
    assert.deepEqual((await db.query('SELECT company_id,chat_user_id,employee_id FROM hrm_identity_links WHERE chat_user_id=$1', [targetUser])).rows[0], { company_id: company, chat_user_id: targetUser, employee_id: target });
    assert.equal((await request(server, '/internal/v1/me/profile', { headers: headers(targetUser) })).body.data.id, target);
    assert.equal((await request(server, `/internal/v1/identity-links/chat-foreign-${suffix}`, { method: 'PUT', headers: headers(`chat-identity-admin-${suffix}`), body: JSON.stringify({ employeeId: foreignTarget }) })).status, 404);
    assert.equal((await request(server, `/internal/v1/identity-links/${targetUser}`, { method: 'DELETE', headers: headers(`chat-identity-admin-${suffix}`) })).status, 204);
    assert.equal((await request(server, '/internal/v1/me/profile', { headers: headers(targetUser) })).status, 401);
  } finally {
    await db.query('DELETE FROM audit_logs WHERE company_id = ANY($1::text[])', [[company, foreignCompany]]).catch(() => {});
    await db.query('DELETE FROM hrm_identity_links WHERE company_id = ANY($1::text[])', [[company, foreignCompany]]).catch(() => {});
    await db.query('DELETE FROM companies WHERE id = ANY($1::text[])', [[company, foreignCompany]]).catch(() => {});
    await new Promise((resolve) => server.close(resolve));
    await db.close();
  }
});

integration('Phase 3 resolves identity links and enforces employee, manager, HR, and tenant scopes', async () => {
  const db = createDatabase(databaseUrl); const suffix = randomUUID().replaceAll('-', '');
  const companyA = `rbac-company-a-${suffix}`; const companyB = `rbac-company-b-${suffix}`;
  const departmentA = `rbac-department-a-${suffix}`; const departmentB = `rbac-department-b-${suffix}`;
    const manager = `rbac-manager-${suffix}`; const employee = `rbac-employee-${suffix}`; const peer = `rbac-peer-${suffix}`; const ambiguousTeam = `rbac-ambiguous-team-${suffix}`; const outsideTeam = `rbac-outside-${suffix}`; const ambiguousOutsideTeam = `rbac-ambiguous-outside-${suffix}`; const hr = `rbac-hr-${suffix}`; const admin = `rbac-admin-${suffix}`;
  const server = createServer(createHrmService(db), { internalToken: 'integration-token' });
  const headers = (companyId, actor) => ({ 'content-type': 'application/json', 'x-hrm-internal-token': 'integration-token', 'x-hrm-contract-version': '1', 'x-company-id': companyId, 'x-actor-user-id': actor, 'x-request-id': `rbac-${suffix}` });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    await db.query('INSERT INTO companies (id, name, code) VALUES ($1, $2, $3), ($4, $5, $6)', [companyA, 'RBAC Company A', `RA${suffix.slice(0, 8)}`, companyB, 'RBAC Company B', `RB${suffix.slice(0, 8)}`]);
    await db.query('INSERT INTO departments (id, company_id, name, code) VALUES ($1, $2, $3, $4), ($5, $2, $6, $7)', [departmentA, companyA, 'Engineering', 'ENG', departmentB, 'Operations', 'OPS']);
    const people = [[manager, departmentA, 'Manager'], [employee, departmentA, 'Employee'], [peer, departmentA, 'Peer'], [ambiguousTeam, departmentA, 'Alex Nguyen'], [outsideTeam, departmentB, 'Outside'], [ambiguousOutsideTeam, departmentB, 'Alex Nguyen'], [hr, departmentB, 'HR'], [admin, departmentB, 'Admin']];
    for (const [id, department, name] of people) await db.query('INSERT INTO employees (id, company_id, department_id, email, display_name, title, employment_status) VALUES ($1, $2, $3, $4, $5, $6, $7)', [id, companyA, department, `${id}@example.test`, name, name, 'active']);
    const permissions = ['employee.profile.read.self', 'employee.profile.read.team', 'employee.profile.read.any', 'organization.manage'];
    for (const code of permissions) await db.query('INSERT INTO permissions (id, code, description) VALUES ($1, $2, $3) ON CONFLICT (code) DO NOTHING', [`permission-${code.replaceAll('.', '-')}-${suffix}`, code, 'integration']);
    const permissionRows = await db.query('SELECT id, code FROM permissions WHERE code = ANY($1::text[])', [permissions]); const permissionByCode = Object.fromEntries(permissionRows.rows.map((row) => [row.code, row.id]));
    const roleRows = [['employee', [permissions[0]], employee], ['manager', [permissions[0], permissions[1]], manager], ['hr', [permissions[0], permissions[1], permissions[2], permissions[3]], hr], ['admin', [permissions[0], permissions[1], permissions[2], permissions[3]], admin]];
    for (const [role, codes, member] of roleRows) { const roleId = `role-${role}-${suffix}`; await db.query('INSERT INTO roles (id, code, name) VALUES ($1, $2, $3)', [roleId, `RBAC_${role}_${suffix}`, role]); for (const code of codes) await db.query('INSERT INTO role_permissions (role_id, permission_id) VALUES ($1, $2)', [roleId, permissionByCode[code]]); await db.query('INSERT INTO employee_roles (company_id, employee_id, role_id) VALUES ($1, $2, $3)', [companyA, member, roleId]); }
    for (const [chatUserId, employeeId] of [['chat-rbac-employee', employee], ['chat-rbac-manager', manager], ['chat-rbac-hr', hr], ['chat-rbac-admin', admin]]) await db.query('INSERT INTO hrm_identity_links (company_id, chat_user_id, employee_id) VALUES ($1, $2, $3)', [companyA, chatUserId, employeeId]);
    assert.equal((await request(server, `/internal/v1/employees/${employee}`, { headers: headers(companyA, 'chat-rbac-employee') })).status, 200);
    assert.equal((await request(server, '/internal/v1/me/profile', { headers: headers(companyA, 'chat-rbac-employee') })).body.data.email, `${employee}@example.test`);
    assert.equal((await request(server, `/internal/v1/employees/${peer}`, { headers: headers(companyA, 'chat-rbac-employee') })).status, 403);
    assert.equal((await request(server, '/internal/v1/employees/search?query=Alex%20Nguyen', { headers: headers(companyA, 'chat-rbac-employee') })).status, 403);
    assert.equal((await request(server, `/internal/v1/employees/${peer}`, { headers: headers(companyA, 'chat-rbac-manager') })).status, 200);
    const team = await request(server, '/internal/v1/me/team', { headers: headers(companyA, 'chat-rbac-manager') });
    assert.equal(team.status, 200); assert.equal('email' in team.body.data.find((member) => member.id === peer), false);
    assert.equal(team.body.data.some((member) => member.id === ambiguousTeam), true);
    assert.equal(team.body.data.some((member) => member.id === ambiguousOutsideTeam), false);
    const teamProfile = await request(server, `/internal/v1/employees/${ambiguousTeam}`, { headers: headers(companyA, 'chat-rbac-manager') });
    assert.equal(teamProfile.status, 200); assert.equal('email' in teamProfile.body.data, false);
    assert.equal((await request(server, '/internal/v1/employees/search?query=Alex%20Nguyen', { headers: headers(companyA, 'chat-rbac-manager') })).status, 403);
    assert.equal((await request(server, `/internal/v1/employees/${outsideTeam}`, { headers: headers(companyA, 'chat-rbac-manager') })).status, 403);
    assert.equal((await request(server, `/internal/v1/employees/${outsideTeam}`, { headers: headers(companyA, 'chat-rbac-hr') })).status, 200);
    const ambiguousSearch = await request(server, '/internal/v1/employees/search?query=Alex%20Nguyen', { headers: headers(companyA, 'chat-rbac-hr') });
    assert.equal(ambiguousSearch.status, 200);
    assert.deepEqual(ambiguousSearch.body.data.map((member) => member.id), [ambiguousOutsideTeam, ambiguousTeam]);
    assert.equal(ambiguousSearch.body.data.every((member) => member.email.endsWith('@example.test')), true);
    assert.equal((await request(server, '/internal/v1/employees/search?query=Outside', { headers: headers(companyA, 'chat-rbac-hr') })).body.data[0].id, outsideTeam);
    assert.equal((await request(server, `/internal/v1/employees/${outsideTeam}`, { headers: headers(companyA, 'chat-rbac-admin') })).status, 200);
    assert.equal((await request(server, `/internal/v1/departments/${departmentA}/employees`, { headers: headers(companyA, 'chat-rbac-employee') })).status, 403);
    assert.equal((await request(server, `/internal/v1/departments/${departmentA}/employees`, { headers: headers(companyA, 'chat-rbac-manager') })).status, 200);
    assert.equal((await request(server, `/internal/v1/employees/${employee}`, { headers: headers(companyA, 'chat-missing') })).status, 401);
    assert.equal((await request(server, `/internal/v1/employees/${employee}`, { headers: headers(companyB, 'chat-rbac-manager') })).status, 200);
    assert.equal((await request(server, `/internal/v1/employees/${employee}`, { method: 'PATCH', headers: headers(companyA, 'chat-rbac-employee'), body: JSON.stringify({ title: 'Spoofed', actorUserId: 'chat-rbac-hr' }) })).status, 403);
    assert.equal((await request(server, `/internal/v1/employees/${employee}`, { method: 'PATCH', headers: headers(companyA, 'chat-rbac-hr'), body: JSON.stringify({ title: 'Updated by HR' }) })).status, 200);
    const audit = await db.query('SELECT actor_user_id, actor_employee_id, request_id FROM audit_logs WHERE company_id = $1 AND resource_id = $2 ORDER BY created_at DESC LIMIT 1', [companyA, employee]);
    assert.deepEqual(audit.rows[0], { actor_user_id: 'chat-rbac-hr', actor_employee_id: hr, request_id: `rbac-${suffix}` });
  } finally { await db.query('DELETE FROM audit_logs WHERE company_id = ANY($1::text[])', [[companyA, companyB]]).catch(() => {}); await db.query('DELETE FROM companies WHERE id = ANY($1::text[])', [[companyA, companyB]]).catch(() => {}); await new Promise((resolve) => server.close(resolve)); await db.close(); }
});

integration('Phase 5 leave request, approval, rejection, cancellation, balance, audit, and tenant boundaries work', async () => {
  const db = createDatabase(databaseUrl); const suffix = randomUUID().replaceAll('-', ''); const company = `leave-company-${suffix}`; const foreignCompany = `leave-foreign-${suffix}`; const department = `leave-dept-${suffix}`; const manager = `leave-manager-${suffix}`; const employee = `leave-employee-${suffix}`; const type = `leave-type-${suffix}`;
  const server = createServer(createHrmService(db), { internalToken: 'integration-token' });
  const headers = (actor, companyId = company) => ({ 'content-type': 'application/json', 'x-hrm-internal-token': 'integration-token', 'x-hrm-contract-version': '1', 'x-company-id': companyId, 'x-actor-user-id': actor, 'x-request-id': `leave-${suffix}` });
  const post = (path, actor, body, companyId) => request(server, path, { method: 'POST', headers: headers(actor, companyId), body: JSON.stringify(body ?? {}) });
  const get = (path, actor, companyId) => request(server, path, { headers: headers(actor, companyId) });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    await db.query('INSERT INTO companies (id,name,code) VALUES ($1,$2,$3),($4,$5,$6)', [company, 'Leave Company', `LC${suffix.slice(0, 8)}`, foreignCompany, 'Foreign Company', `LF${suffix.slice(0, 8)}`]);
    await db.query('INSERT INTO departments (id,company_id,name,code) VALUES ($1,$2,$3,$4)', [department, company, 'Leave Team', 'LEAVE']);
    for (const [id, name] of [[manager, 'Manager'], [employee, 'Employee']]) await db.query('INSERT INTO employees (id,company_id,department_id,email,display_name,title,employment_status) VALUES ($1,$2,$3,$4,$5,$5,$6)', [id, company, department, `${id}@example.test`, name, 'active']);
    await db.query('INSERT INTO leave_types (id,company_id,code,name,requires_balance) VALUES ($1,$2,$3,$4,TRUE)', [type, company, 'ANNUAL', 'Annual leave']);
    await db.query('INSERT INTO leave_balances (company_id,employee_id,leave_type_id,leave_year,allocated_days) VALUES ($1,$2,$3,2026,5)', [company, employee, type]);
    for (const code of ['leave.read.self', 'leave.request.self', 'leave.approve.team']) await db.query('INSERT INTO permissions (id,code,description) VALUES ($1,$2,$3) ON CONFLICT (code) DO NOTHING', [`leave-perm-${code.replaceAll('.', '-')}-${suffix}`, code, 'leave integration']);
    const permissions = Object.fromEntries((await db.query('SELECT id,code FROM permissions WHERE code=ANY($1::text[])', [['leave.read.self', 'leave.request.self', 'leave.approve.team']])).rows.map((row) => [row.code, row.id]));
    for (const [role, member, codes] of [['employee', employee, ['leave.read.self', 'leave.request.self']], ['manager', manager, ['leave.approve.team']]]) { const roleId = `leave-role-${role}-${suffix}`; await db.query('INSERT INTO roles (id,code,name) VALUES ($1,$2,$3)', [roleId, `LEAVE_${role}_${suffix}`, role]); for (const code of codes) await db.query('INSERT INTO role_permissions (role_id,permission_id) VALUES ($1,$2)', [roleId, permissions[code]]); await db.query('INSERT INTO employee_roles (company_id,employee_id,role_id) VALUES ($1,$2,$3)', [company, member, roleId]); }
    await db.query('INSERT INTO hrm_identity_links (company_id,chat_user_id,employee_id) VALUES ($1,$2,$3),($1,$4,$5)', [company, 'chat-leave-employee', employee, 'chat-leave-manager', manager]);
    const balances = await get('/internal/v1/me/leave-balances?year=2026', 'chat-leave-employee');
    assert.deepEqual(balances.body.data, [{ leaveTypeId: type, code: 'ANNUAL', name: 'Annual leave', requiresBalance: true, allocatedDays: 5, usedDays: 0, remainingDays: 5 }]);
    assert.equal((await get('/internal/v1/me/leave-balances?year=1999', 'chat-leave-employee')).status, 400);
    assert.equal((await get('/internal/v1/me/leave-balances?year=2026', 'chat-leave-manager')).status, 403);
    assert.equal((await get('/internal/v1/me/leave-balances?year=2026', 'chat-leave-employee', foreignCompany)).status, 200);
    assert.deepEqual((await get('/internal/v1/me/leave-requests', 'chat-leave-employee')).body.data, []);
    assert.equal((await get('/internal/v1/me/leave-requests', 'chat-leave-manager')).status, 403);
    assert.equal((await get('/internal/v1/me/leave-requests', 'chat-leave-employee', foreignCompany)).status, 200);
    const previewInput = { leaveTypeCode: 'ANNUAL', startDate: '2026-06-10', endDate: '2026-06-11', requestedDays: 2, reason: 'Integration preview' };
    const preview = await post('/internal/v1/me/leave-request-preview', 'chat-leave-employee', previewInput);
    assert.equal(preview.status, 200);
    assert.deepEqual(preview.body.data, { companyId: company, leaveTypeCode: 'ANNUAL', leaveTypeName: 'Annual leave', requiresBalance: true, startDate: '2026-06-10', endDate: '2026-06-11', requestedDays: 2, reason: 'Integration preview', remainingDaysBefore: 5, remainingDaysAfter: 3, hasConflict: false });
    assert.equal((await db.query('SELECT count(*)::int AS count FROM leave_requests WHERE company_id = $1', [company])).rows[0].count, 0);
    assert.equal((await db.query("SELECT count(*)::int AS count FROM audit_logs WHERE company_id = $1 AND action LIKE 'leave.%'", [company])).rows[0].count, 0);
    assert.equal((await post('/internal/v1/me/leave-request-preview', 'chat-leave-employee', { ...previewInput, leaveTypeCode: type })).status, 404);
    assert.equal((await post('/internal/v1/me/leave-request-preview', 'chat-leave-employee', { ...previewInput, requestedDays: 6 })).status, 409);
    assert.equal((await post('/internal/v1/me/leave-request-preview', 'chat-leave-employee', { ...previewInput, startDate: 'invalid' })).status, 400);
    assert.equal((await post('/internal/v1/me/leave-request-preview', 'chat-leave-manager', previewInput)).status, 403);
    assert.equal((await post('/internal/v1/me/leave-request-preview', 'chat-leave-employee', previewInput, foreignCompany)).status, 200);
    const requested = await post('/internal/v1/me/leave-requests', 'chat-leave-employee', { leaveTypeId: type, startDate: '2026-06-10', endDate: '2026-06-11', requestedDays: 2 }); assert.equal(requested.status, 201);
    assert.equal((await post('/internal/v1/me/leave-request-preview', 'chat-leave-employee', { ...previewInput, startDate: '2026-06-11', endDate: '2026-06-12' })).status, 409);
    const managerPending = (await db.query('INSERT INTO leave_requests (company_id,employee_id,leave_type_id,start_date,end_date,requested_days,reason) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id', [company, manager, type, '2026-06-12', '2026-06-12', 1, 'Manager own request'])).rows[0];
    const myRequests = await get('/internal/v1/me/leave-requests', 'chat-leave-employee');
    assert.equal(myRequests.status, 200); assert.equal(myRequests.body.data.length, 1);
    assert.deepEqual(myRequests.body.data[0], { id: requested.body.data.id, leaveTypeId: type, leaveTypeCode: 'ANNUAL', leaveTypeName: 'Annual leave', startDate: '2026-06-10', endDate: '2026-06-11', requestedDays: 2, reason: null, status: 'pending', createdAt: myRequests.body.data[0].createdAt, updatedAt: myRequests.body.data[0].updatedAt });
    assert.equal('employeeId' in myRequests.body.data[0] || 'companyId' in myRequests.body.data[0], false);
    const pendingForApproval = await get('/internal/v1/me/team/pending-leave-requests', 'chat-leave-manager');
    assert.equal(pendingForApproval.status, 200); assert.deepEqual(pendingForApproval.body.data, [{ id: requested.body.data.id, employeeId: employee, employeeDisplayName: 'Employee', leaveTypeId: type, leaveTypeCode: 'ANNUAL', leaveTypeName: 'Annual leave', startDate: '2026-06-10', endDate: '2026-06-11', requestedDays: 2, reason: null, status: 'pending', createdAt: pendingForApproval.body.data[0].createdAt, updatedAt: pendingForApproval.body.data[0].updatedAt }]);
    assert.equal((await get('/internal/v1/me/team/pending-leave-requests', 'chat-leave-employee')).status, 403);
    assert.equal((await get('/internal/v1/me/team/pending-leave-requests', 'chat-leave-manager', foreignCompany)).status, 200);
    assert.equal((await post(`/internal/v1/leave-requests/${managerPending.id}/approve`, 'chat-leave-manager')).status, 403);
    assert.equal((await post(`/internal/v1/leave-requests/${managerPending.id}/reject`, 'chat-leave-manager')).status, 403);
    const approved = await post(`/internal/v1/leave-requests/${requested.body.data.id}/approve`, 'chat-leave-manager');
    assert.equal(approved.status, 200); assert.equal(approved.body.data.status, 'approved');
    assert.equal(Number((await db.query('SELECT used_days FROM leave_balances WHERE company_id=$1 AND employee_id=$2 AND leave_type_id=$3 AND leave_year=2026', [company, employee, type])).rows[0].used_days), 2);
    const rejected = await post('/internal/v1/me/leave-requests', 'chat-leave-employee', { leaveTypeId: type, startDate: '2026-07-10', endDate: '2026-07-10', requestedDays: 1 }); assert.equal((await post(`/internal/v1/leave-requests/${rejected.body.data.id}/reject`, 'chat-leave-manager')).body.data.status, 'rejected');
    const cancelled = await post('/internal/v1/me/leave-requests', 'chat-leave-employee', { leaveTypeId: type, startDate: '2026-08-10', endDate: '2026-08-10', requestedDays: 1 }); assert.equal((await post(`/internal/v1/leave-requests/${cancelled.body.data.id}/cancel`, 'chat-leave-employee')).body.data.status, 'cancelled');
    assert.equal((await post(`/internal/v1/leave-requests/${cancelled.body.data.id}/approve`, 'chat-leave-manager')).status, 404);
    assert.equal((await post(`/internal/v1/leave-requests/${requested.body.data.id}/approve`, 'chat-leave-manager', {}, foreignCompany)).status, 404);
    assert.equal((await db.query("SELECT count(*)::int AS count FROM audit_logs WHERE company_id=$1 AND action LIKE 'leave.%'", [company])).rows[0].count, 6);
  } finally { await db.query('DELETE FROM audit_logs WHERE company_id=ANY($1::text[])', [[company, foreignCompany]]).catch(() => {}); await db.query('DELETE FROM companies WHERE id=ANY($1::text[])', [[company, foreignCompany]]).catch(() => {}); await new Promise((resolve) => server.close(resolve)); await db.close(); }
});

integration('Phase 6 attendance reads enforce self/team scope, date validation, and tenant isolation', async () => {
  const db = createDatabase(databaseUrl); const suffix = randomUUID().replaceAll('-', '');
  const company = `attendance-company-${suffix}`; const foreignCompany = `attendance-foreign-${suffix}`;
  const department = `attendance-dept-${suffix}`; const outsideDepartment = `attendance-outside-dept-${suffix}`;
  const manager = `attendance-manager-${suffix}`; const employee = `attendance-employee-${suffix}`; const outsideEmployee = `attendance-outside-${suffix}`;
  const server = createServer(createHrmService(db), { internalToken: 'integration-token' });
  const headers = (actor, companyId = company) => ({ 'x-hrm-internal-token': 'integration-token', 'x-hrm-contract-version': '1', 'x-company-id': companyId, 'x-actor-user-id': actor, 'x-request-id': `attendance-${suffix}` });
  const get = (path, actor, companyId) => request(server, path, { headers: headers(actor, companyId) });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    await db.query('INSERT INTO companies (id,name,code) VALUES ($1,$2,$3),($4,$5,$6)', [company, 'Attendance Company', `AC${suffix.slice(0, 8)}`, foreignCompany, 'Foreign Attendance Company', `AF${suffix.slice(0, 8)}`]);
    await db.query('INSERT INTO departments (id,company_id,name,code) VALUES ($1,$2,$3,$4),($5,$2,$6,$7)', [department, company, 'Attendance Team', 'ATTENDANCE', outsideDepartment, 'Outside Team', 'OUTSIDE']);
    for (const [id, departmentId, name] of [[manager, department, 'Attendance Manager'], [employee, department, 'Attendance Employee'], [outsideEmployee, outsideDepartment, 'Outside Employee']]) await db.query('INSERT INTO employees (id,company_id,department_id,email,display_name,title,employment_status) VALUES ($1,$2,$3,$4,$5,$5,$6)', [id, company, departmentId, `${id}@example.test`, name, 'active']);
    for (const code of ['attendance.read.self', 'attendance.read.team']) await db.query('INSERT INTO permissions (id,code,description) VALUES ($1,$2,$3) ON CONFLICT (code) DO NOTHING', [`attendance-permission-${code.replaceAll('.', '-')}-${suffix}`, code, 'attendance integration']);
    const permissionRows = await db.query('SELECT id,code FROM permissions WHERE code = ANY($1::text[])', [['attendance.read.self', 'attendance.read.team']]); const permissions = Object.fromEntries(permissionRows.rows.map((row) => [row.code, row.id]));
    for (const [role, member, codes] of [['employee', employee, ['attendance.read.self']], ['manager', manager, ['attendance.read.self', 'attendance.read.team']]]) { const roleId = `attendance-role-${role}-${suffix}`; await db.query('INSERT INTO roles (id,code,name) VALUES ($1,$2,$3)', [roleId, `ATTENDANCE_${role}_${suffix}`, role]); for (const code of codes) await db.query('INSERT INTO role_permissions (role_id,permission_id) VALUES ($1,$2)', [roleId, permissions[code]]); await db.query('INSERT INTO employee_roles (company_id,employee_id,role_id) VALUES ($1,$2,$3)', [company, member, roleId]); }
    await db.query('INSERT INTO hrm_identity_links (company_id,chat_user_id,employee_id) VALUES ($1,$2,$3),($1,$4,$5)', [company, 'chat-attendance-manager', manager, 'chat-attendance-employee', employee]);
    const rows = [[manager, '2026-09-01', 'present', 480], [employee, '2026-09-01', 'late', 450], [employee, '2026-09-02', 'absent', null], [outsideEmployee, '2026-09-01', 'present', 480]];
    for (const [employeeId, workDate, status, minutesWorked] of rows) await db.query('INSERT INTO attendance_records (company_id,employee_id,work_date,status,minutes_worked,source) VALUES ($1,$2,$3,$4,$5,$6)', [company, employeeId, workDate, status, minutesWorked, 'import']);
    const range = 'from=2026-09-01&to=2026-09-02';
    const self = await get(`/internal/v1/me/attendance?${range}&employeeId=${manager}`, 'chat-attendance-employee');
    assert.equal(self.status, 200); assert.deepEqual(self.body.data.map((record) => record.employeeId), [employee, employee]);
    assert.equal(self.body.data.find((record) => record.status === 'absent').checkOutAt, null);
    const selfSummary = await get(`/internal/v1/me/attendance/summary?${range}`, 'chat-attendance-employee');
    assert.deepEqual(selfSummary.body.data, { from: '2026-09-01', to: '2026-09-02', totalRecords: 2, totalMinutesWorked: 450, byStatus: { absent: 1, late: 1 } });
    assert.equal((await get(`/internal/v1/me/team/attendance?${range}`, 'chat-attendance-employee')).status, 403);
    const team = await get(`/internal/v1/me/team/attendance?${range}`, 'chat-attendance-manager');
    assert.equal(team.status, 200); assert.deepEqual(new Set(team.body.data.map((record) => record.employeeId)), new Set([manager, employee]));
    const summary = await get(`/internal/v1/me/team/attendance/summary?${range}`, 'chat-attendance-manager');
    assert.deepEqual(summary.body.data, { from: '2026-09-01', to: '2026-09-02', totalRecords: 3, totalMinutesWorked: 930, byStatus: { absent: 1, late: 1, present: 1 } });
    assert.equal((await get('/internal/v1/me/attendance?from=2026-02-30&to=2026-03-01', 'chat-attendance-employee')).status, 400);
    assert.equal((await get('/internal/v1/me/attendance?from=2025-01-01&to=2026-01-02', 'chat-attendance-employee')).status, 400);
    assert.equal((await get(`/internal/v1/me/attendance?${range}`, 'chat-attendance-manager', foreignCompany)).status, 200);
  } finally {
    await db.query('DELETE FROM audit_logs WHERE company_id = ANY($1::text[])', [[company, foreignCompany]]).catch(() => {});
    await db.query('DELETE FROM companies WHERE id = ANY($1::text[])', [[company, foreignCompany]]).catch(() => {});
    await new Promise((resolve) => server.close(resolve)); await db.close();
  }
});

integration('Phase 7 manager task workflow preserves tenant, team, assignment, status, and audit boundaries', async () => {
  const db = createDatabase(databaseUrl); const suffix = randomUUID().replaceAll('-', '');
  const company = `task-company-${suffix}`; const foreignCompany = `task-foreign-${suffix}`; const department = `task-dept-${suffix}`; const outsideDepartment = `task-outside-dept-${suffix}`;
  const manager = `task-manager-${suffix}`; const employee = `task-employee-${suffix}`; const outsideEmployee = `task-outside-${suffix}`;
  const server = createServer(createHrmService(db), { internalToken: 'integration-token' });
  const headers = (actor, companyId = company) => ({ 'content-type': 'application/json', 'x-hrm-internal-token': 'integration-token', 'x-hrm-contract-version': '1', 'x-company-id': companyId, 'x-actor-user-id': actor, 'x-request-id': `task-${suffix}` });
  const requestAs = (method, path, actor, body, companyId) => request(server, path, { method, headers: headers(actor, companyId), body: body === undefined ? undefined : JSON.stringify(body) });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    await db.query('INSERT INTO companies (id,name,code) VALUES ($1,$2,$3),($4,$5,$6)', [company, 'Task Company', `TC${suffix.slice(0, 8)}`, foreignCompany, 'Foreign Task Company', `TF${suffix.slice(0, 8)}`]);
    await db.query('INSERT INTO departments (id,company_id,name,code) VALUES ($1,$2,$3,$4),($5,$2,$6,$7)', [department, company, 'Task Team', 'TASK', outsideDepartment, 'Outside Task Team', 'OUTSIDE-TASK']);
    for (const [id, departmentId, name] of [[manager, department, 'Task Manager'], [employee, department, 'Task Employee'], [outsideEmployee, outsideDepartment, 'Outside Task Employee']]) await db.query('INSERT INTO employees (id,company_id,department_id,email,display_name,title,employment_status) VALUES ($1,$2,$3,$4,$5,$5,$6)', [id, company, departmentId, `${id}@example.test`, name, 'active']);
    const permissionCodes = ['task.read.self', 'task.read.team', 'task.update.self', 'task.manage.team'];
    for (const code of permissionCodes) await db.query('INSERT INTO permissions (id,code,description) VALUES ($1,$2,$3) ON CONFLICT (code) DO NOTHING', [`task-permission-${code.replaceAll('.', '-')}-${suffix}`, code, 'task integration']);
    const permissions = Object.fromEntries((await db.query('SELECT id,code FROM permissions WHERE code=ANY($1::text[])', [permissionCodes])).rows.map((row) => [row.code, row.id]));
    for (const [role, member, codes] of [['employee', employee, ['task.read.self', 'task.update.self']], ['manager', manager, permissionCodes]]) { const roleId = `task-role-${role}-${suffix}`; await db.query('INSERT INTO roles (id,code,name) VALUES ($1,$2,$3)', [roleId, `TASK_${role}_${suffix}`, role]); for (const code of codes) await db.query('INSERT INTO role_permissions (role_id,permission_id) VALUES ($1,$2)', [roleId, permissions[code]]); await db.query('INSERT INTO employee_roles (company_id,employee_id,role_id) VALUES ($1,$2,$3)', [company, member, roleId]); }
    await db.query('INSERT INTO hrm_identity_links (company_id,chat_user_id,employee_id) VALUES ($1,$2,$3),($1,$4,$5)', [company, 'chat-task-manager', manager, 'chat-task-employee', employee]);
    const projectId = `project-${suffix}`;
    const project = await requestAs('POST', '/internal/v1/projects', 'chat-task-manager', { id: projectId, name: 'Task Project', code: `TASK-${suffix.slice(0, 8)}` });
    assert.equal(project.status, 201);
    const created = await requestAs('POST', `/internal/v1/projects/${projectId}/tasks`, 'chat-task-manager', { title: 'Implement integration workflow', description: 'Initial description', priority: 'high', dueDate: '2026-10-01' });
    assert.equal(created.status, 201); const taskId = created.body.data.id;
    const updated = await requestAs('PATCH', `/internal/v1/tasks/${taskId}`, 'chat-task-manager', { description: 'Updated by manager', priority: 'medium' });
    assert.equal(updated.body.data.description, 'Updated by manager');
    assert.equal((await requestAs('POST', `/internal/v1/tasks/${taskId}/assignments`, 'chat-task-manager', { employeeId: outsideEmployee })).status, 403);
    const assigned = await requestAs('POST', `/internal/v1/tasks/${taskId}/assignments`, 'chat-task-manager', { employeeId: employee });
    assert.equal(assigned.body.data.assignedEmployeeId, employee);
    const mine = await requestAs('GET', '/internal/v1/me/tasks?status=todo', 'chat-task-employee');
    assert.deepEqual(mine.body.data.map((task) => task.id), [taskId]);
    assert.equal((await requestAs('PATCH', `/internal/v1/tasks/${taskId}`, 'chat-task-employee', { title: 'Spoofed' })).status, 403);
    const started = await requestAs('POST', `/internal/v1/tasks/${taskId}/status`, 'chat-task-employee', { status: 'in_progress' });
    assert.equal(started.body.data.status, 'in_progress');
    assert.equal((await requestAs('POST', `/internal/v1/tasks/${taskId}/status`, 'chat-task-employee', { status: 'todo' })).status, 409);
    const team = await requestAs('GET', '/internal/v1/me/team/tasks?status=in_progress', 'chat-task-manager');
    assert.deepEqual(team.body.data.map((task) => task.id), [taskId]);
    assert.equal((await requestAs('POST', '/internal/v1/projects', 'chat-task-employee', { id: `forbidden-${suffix}`, name: 'Forbidden', code: 'FORBIDDEN' })).status, 403);
    assert.equal((await requestAs('GET', '/internal/v1/me/team/tasks', 'chat-task-manager', undefined, foreignCompany)).status, 200);
    const audit = await db.query("SELECT action FROM audit_logs WHERE company_id=$1 AND resource_id = ANY($2::text[]) ORDER BY created_at", [company, [projectId, taskId]]);
    assert.deepEqual(audit.rows.map((row) => row.action), ['project.created', 'task.created', 'task.updated', 'task.assigned', 'task.status_updated']);
  } finally {
    await db.query('DELETE FROM audit_logs WHERE company_id = ANY($1::text[])', [[company, foreignCompany]]).catch(() => {});
    await db.query('DELETE FROM companies WHERE id = ANY($1::text[])', [[company, foreignCompany]]).catch(() => {});
    await new Promise((resolve) => server.close(resolve)); await db.close();
  }
});
