import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { createDatabase } from '../src/database.js';
import { createHrmService, createServer } from '../src/app.js';

const integration = process.env.TEST_DATABASE_URL && process.env.DQE_TEST_DATABASE_URL ? test : test.skip;

integration('DQE PostgreSQL fixtures verify aggregates, authorization, injection and concurrent actors', async () => {
  const suffix = randomUUID().replaceAll('-', '');
  const id = (name) => `dqe-${name}-${suffix}`;
  const companies = [id('company-a'), id('company-b')];
  const departments = [id('department-a'), id('department-other'), id('department-b')];
  const employees = [id('owner'), id('peer'), id('other'), id('unprivileged'), id('inactive'), id('foreign')];
  const actors = [id('actor-owner'), id('actor-peer'), id('actor-unprivileged'), id('actor-foreign')];
  const roleAll = id('role-all');
  const roleSelf = id('role-self');
  const permissionCodes = ['employee.profile.read.any', 'employee.profile.read.team', 'attendance.read.team', 'attendance.read.self', 'leave.read.self', 'task.read.self', 'task.read.team'];
  const db = createDatabase(process.env.TEST_DATABASE_URL);
  const queryDb = createDatabase(process.env.DQE_TEST_DATABASE_URL);
  const executedQueries = [];
  const transactionSettings = [];
  const originalTransaction = queryDb.transaction.bind(queryDb);
  queryDb.transaction = (callback) => originalTransaction(async (client) => callback({
    ...client,
    query: (sql, params) => {
      if (typeof sql === 'string' && sql.startsWith('SELECT ') && sql.includes(' LIMIT ')) executedQueries.push({ sql, params });
      if (typeof sql === 'string' && sql.startsWith('SET ')) transactionSettings.push(sql);
      return client.query(sql, params);
    },
  }));
  const server = createServer(createHrmService(db, queryDb), { internalToken: 'dqe-security-token' });
  const request = async (actor, query) => {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/internal/v1/query`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-hrm-internal-token': 'dqe-security-token', 'x-hrm-contract-version': '1', 'x-actor-user-id': actor, 'x-request-id': id('request') },
      body: JSON.stringify(query),
    });
    return { status: response.status, body: await response.json() };
  };
  const legacyRequest = async (actor, path) => {
    const response = await fetch(`http://127.0.0.1:${server.address().port}${path}`, {
      headers: { 'x-hrm-internal-token': 'dqe-security-token', 'x-hrm-contract-version': '1', 'x-actor-user-id': actor, 'x-request-id': id('request') },
    });
    return { status: response.status, body: await response.json() };
  };
  try {
    for (const [index, company] of companies.entries()) await db.query('INSERT INTO companies (id,name,code) VALUES ($1,$2,$3)', [company, `DQE Company ${index}`, `DQE${index}${suffix.slice(0, 12)}`]);
    for (const [index, department] of departments.entries()) await db.query('INSERT INTO departments (id,company_id,name,code) VALUES ($1,$2,$3,$4)', [department, companies[index === 2 ? 1 : 0], `DQE Department ${index}`, `DEPT${index}`]);
    for (const [index, employee] of employees.entries()) {
      await db.query('INSERT INTO employees (id,company_id,department_id,email,display_name,title,employment_status) VALUES ($1,$2,$3,$4,$5,$6,$7)', [
        employee, companies[index === 5 ? 1 : 0], departments[index === 5 ? 2 : index < 2 || index === 4 ? 0 : 1], `${employee}@example.test`, `DQE Employee ${index}`, 'Tester', index === 4 ? 'inactive' : 'active',
      ]);
    }
    for (const [role, label] of [[roleAll, 'ALL'], [roleSelf, 'SELF']]) await db.query('INSERT INTO roles (id,code,name) VALUES ($1,$2,$3)', [role, `DQE_${label}_${suffix}`, `DQE ${label}`]);
    for (const [index, code] of permissionCodes.entries()) await db.query('INSERT INTO permissions (id,code,description) VALUES ($1,$2,$3) ON CONFLICT (code) DO NOTHING', [id(`permission-${index}`), code, 'DQE test']);
    const permissions = Object.fromEntries((await db.query('SELECT code,id FROM permissions WHERE code = ANY($1::text[])', [permissionCodes])).rows.map((row) => [row.code, row.id]));
    for (const code of ['employee.profile.read.any', 'attendance.read.team', 'leave.read.self', 'task.read.team']) await db.query('INSERT INTO role_permissions (role_id,permission_id) VALUES ($1,$2)', [roleAll, permissions[code]]);
    for (const code of ['employee.profile.read.team', 'attendance.read.self', 'leave.read.self', 'task.read.self']) await db.query('INSERT INTO role_permissions (role_id,permission_id) VALUES ($1,$2)', [roleSelf, permissions[code]]);
    for (const [company, employee, role] of [[companies[0], employees[0], roleAll], [companies[0], employees[1], roleSelf], [companies[1], employees[5], roleAll]]) await db.query('INSERT INTO employee_roles (company_id,employee_id,role_id) VALUES ($1,$2,$3)', [company, employee, role]);
    for (const [index, employee] of [[0, employees[0]], [1, employees[1]], [2, employees[3]], [3, employees[5]]]) await db.query('INSERT INTO hrm_identity_links (company_id,chat_user_id,employee_id) VALUES ($1,$2,$3)', [companies[index === 3 ? 1 : 0], actors[index], employee]);
    for (const [index, minutes, status, date] of [[0, 480, 'present', '2026-09-21'], [0, null, 'absent', '2026-09-22'], [1, 300, 'present', '2026-09-21'], [2, 600, 'late', '2026-09-21'], [5, 700, 'present', '2026-09-21']]) await db.query('INSERT INTO attendance_records (company_id,employee_id,work_date,status,minutes_worked) VALUES ($1,$2,$3,$4,$5)', [companies[index === 5 ? 1 : 0], employees[index], date, status, minutes]);
    await db.query('INSERT INTO leave_types (id,company_id,code,name) VALUES ($1,$2,$3,$4)', [id('leave-type'), companies[0], 'ANNUAL', 'Annual']);
    for (const [index, days] of [[0, 2.5], [1, 1.25]]) await db.query('INSERT INTO leave_requests (company_id,employee_id,leave_type_id,start_date,end_date,requested_days,status) VALUES ($1,$2,$3,$4,$5,$6,$7)', [companies[0], employees[index], id('leave-type'), '2026-10-01', '2026-10-02', days, 'approved']);
    for (const [company, project, creator] of [[companies[0], id('project-a'), employees[0]], [companies[0], id('project-other'), employees[2]], [companies[1], id('project-b'), employees[5]]]) await db.query('INSERT INTO projects (id,company_id,name,code,created_by_employee_id) VALUES ($1,$2,$3,$4,$5)', [project, company, project, project, creator]);
    const ownTask = (await db.query('INSERT INTO tasks (company_id,project_id,title,created_by_employee_id) VALUES ($1,$2,$3,$4) RETURNING id', [companies[0], id('project-a'), 'Own team task', employees[0]])).rows[0].id;
    const foreignTask = (await db.query('INSERT INTO tasks (company_id,project_id,title,created_by_employee_id) VALUES ($1,$2,$3,$4) RETURNING id', [companies[1], id('project-b'), 'Foreign task', employees[5]])).rows[0].id;
    const otherTask = (await db.query('INSERT INTO tasks (company_id,project_id,title,created_by_employee_id) VALUES ($1,$2,$3,$4) RETURNING id', [companies[0], id('project-other'), 'Other department task', employees[2]])).rows[0].id;
    await db.query('INSERT INTO task_assignments (company_id,task_id,employee_id,assigned_by_employee_id) VALUES ($1,$2,$3,$4),($5,$6,$7,$8),($9,$10,$11,$11)', [companies[0], ownTask, employees[1], employees[0], companies[1], foreignTask, employees[5], employees[5], companies[0], otherTask, employees[2]]);
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));

    for (const path of ['/api/departments/' + departments[0], '/api/projects', `/api/projects/${id('project-a')}/tasks`]) {
      assert.equal((await legacyRequest(actors[2], path)).status, 403, path);
      assert.equal((await legacyRequest(id('no-link'), path)).status, 401, path);
    }
    assert.equal((await legacyRequest(actors[1], `/api/departments/${departments[0]}`)).status, 403);
    assert.equal((await legacyRequest(actors[0], `/api/departments/${departments[0]}`)).body.data.id, departments[0]);
    assert.equal((await legacyRequest(actors[0], `/api/departments/${departments[2]}`)).status, 404);
    const teamProfile = await legacyRequest(actors[1], `/api/employees/${employees[0]}`);
    assert.equal(teamProfile.status, 200);
    assert.equal('email' in teamProfile.body.data, false);
    const teamMembers = await legacyRequest(actors[1], `/api/departments/${departments[0]}/employees`);
    assert.equal(teamMembers.status, 200);
    assert.equal('email' in teamMembers.body.data.find((member) => member.id === employees[0]), false);
    assert.equal((await legacyRequest(actors[1], `/api/departments/${departments[1]}/employees`)).status, 403);
    assert.equal((await legacyRequest(actors[0], `/api/employees/${employees[2]}/attendance`)).status, 403);
    assert.deepEqual((await legacyRequest(actors[0], '/api/projects')).body.data.map((p) => p.id), [id('project-a')]);
    assert.deepEqual((await legacyRequest(actors[1], '/api/projects')).body.data.map((p) => p.id), [id('project-a')]);
    assert.deepEqual((await legacyRequest(actors[1], `/api/projects/${id('project-a')}/tasks`)).body.data.map((t) => t.id), [ownTask]);
    assert.deepEqual((await legacyRequest(actors[0], `/api/projects/${id('project-a')}/tasks`)).body.data.map((t) => t.id), [ownTask]);
    assert.equal((await legacyRequest(actors[0], `/api/projects/${id('project-b')}/tasks`)).status, 404);
    assert.equal((await legacyRequest(actors[0], `/api/projects/${id('project-other')}/tasks`)).status, 404);

    const count = { dataset: 'employees', filters: [{ field: 'employment_status', operator: 'eq', value: 'active' }], aggregations: [{ function: 'count', alias: 'total' }] };
    const expectedCount = Number((await db.query("SELECT count(*) AS total FROM employees WHERE company_id=$1 AND employment_status='active'", [companies[0]])).rows[0].total);
    const beforeAggregate = executedQueries.length;
    const deniedCount = await request(actors[0], count);
    assert.equal(deniedCount.status, 403);
    assert.equal(deniedCount.body.error.code, 'HRM_FORBIDDEN');
    assert.equal(executedQueries.length, beforeAggregate);
    const initialList = await request(actors[0], { dataset: 'employees', select: ['id'], filters: [{ field: 'employment_status', operator: 'eq', value: 'active' }] });
    assert.equal(initialList.body.data.rows.length, expectedCount);
    assert.deepEqual(transactionSettings.slice(-2), ['SET TRANSACTION READ ONLY', "SET LOCAL statement_timeout = '3000ms'"]);
    await assert.rejects(db.transaction(async (client) => {
      await client.query('SET TRANSACTION READ ONLY');
      assert.equal((await client.query('SHOW transaction_read_only')).rows[0].transaction_read_only, 'on');
      await client.query("SET LOCAL statement_timeout = '3000ms'");
      assert.equal((await client.query('SHOW statement_timeout')).rows[0].statement_timeout, '3s');
      await client.query('UPDATE employees SET title = $1 WHERE company_id = $2 AND id = $3', ['Modified', companies[0], employees[0]]);
    }), (error) => error.code === '25006');
    await assert.rejects(db.transaction(async (client) => {
      await client.query('SET TRANSACTION READ ONLY');
      await client.query("SET LOCAL statement_timeout = '3000ms'");
      await client.query('SELECT pg_sleep(3.2)');
    }), (error) => error.code === '57014');
    assert.equal((await db.query('SELECT title FROM employees WHERE company_id=$1 AND id=$2', [companies[0], employees[0]])).rows[0].title, 'Tester');
    assert.equal(expectedCount, 4);
    const grouped = { ...count, groupBy: ['department_id'], sort: [{ field: 'department_id', direction: 'asc' }] };
    assert.equal((await request(actors[0], grouped)).status, 403);
    const listed = await request(actors[0], { dataset: 'employees', select: ['id', 'display_name'], filters: [{ field: 'employment_status', operator: 'eq', value: 'active' }], sort: [{ field: 'display_name', direction: 'asc' }], limit: 2, offset: 1 });
    assert.equal(listed.status, 200);
    assert.deepEqual(listed.body.data.rows, (await db.query("SELECT id,display_name FROM employees WHERE company_id=$1 AND employment_status='active' ORDER BY display_name LIMIT 2 OFFSET 1", [companies[0]])).rows);

    const dateFilter = { field: 'work_date', operator: 'between', value: ['2026-09-21', '2026-09-22'] };
    const minutes = { dataset: 'attendance_records', filters: [dateFilter], aggregations: [{ function: 'count', alias: 'total' }, { function: 'sum', field: 'minutes_worked', alias: 'sum_minutes' }, { function: 'avg', field: 'minutes_worked', alias: 'avg_minutes' }] };
    const contributors = (await db.query('SELECT count(*)::int AS records, count(DISTINCT a.employee_id)::int AS employees FROM attendance_records a JOIN employees e ON e.company_id=a.company_id AND e.id=a.employee_id WHERE a.company_id=$1 AND e.department_id=$2 AND a.work_date BETWEEN $3 AND $4', [companies[0], departments[0], '2026-09-21', '2026-09-22'])).rows[0];
    assert.deepEqual(contributors, { records: 3, employees: 2 });
    const beforeTeamAggregate = executedQueries.length;
    assert.equal((await request(actors[0], minutes)).status, 403);
    assert.equal(executedQueries.length, beforeTeamAggregate);
    const privacyQueries = [
      { ...minutes, groupBy: ['employee_id'] },
      { ...minutes, groupBy: ['status'] },
      { ...minutes, filters: [dateFilter, { field: 'employee_id', operator: 'eq', value: employees[0] }] },
      { ...minutes, filters: [dateFilter, { field: 'employee_id', operator: 'ne', value: employees[0] }] },
      { ...minutes, aggregations: [{ function: 'min', field: 'minutes_worked', alias: 'minimum' }, { function: 'max', field: 'minutes_worked', alias: 'maximum' }] },
      { dataset: 'employees', filters: [{ field: 'employment_status', operator: 'eq', value: 'active' }], groupBy: ['department_name'], aggregations: [{ function: 'count', alias: 'total' }], sort: [{ field: 'total', direction: 'desc' }], limit: 3 },
      { dataset: 'attendance_records', filters: [{ field: 'work_date', operator: 'between', value: ['2026-09-01', '2026-09-30'] }], groupBy: ['status'], aggregations: [{ function: 'count', alias: 'records' }, { function: 'sum', field: 'minutes_worked', alias: 'total_minutes' }, { function: 'avg', field: 'minutes_worked', alias: 'average_minutes' }] },
    ];
    for (const query of privacyQueries) {
      const denied = await request(actors[0], query);
      assert.equal(denied.status, 403);
      assert.equal(denied.body.error.code, 'HRM_FORBIDDEN');
      assert.equal(executedQueries.length, beforeTeamAggregate, 'No aggregate SELECT may run before privacy denial');
    }
    assert.deepEqual((await request(actors[1], minutes)).body.data.rows[0], { total: 1, sum_minutes: 300, avg_minutes: 300 });
    assert.match(executedQueries.at(-1).sql, /a\.company_id = \$1 AND a\.employee_id = \$2 AND a\.work_date BETWEEN \$3 AND \$4/);
    assert.deepEqual(executedQueries.at(-1).params, [companies[0], employees[1], '2026-09-21', '2026-09-22', 20, 0]);
    const nullRows = await request(actors[0], { dataset: 'attendance_records', select: ['employee_id', 'work_date', 'minutes_worked'], filters: [dateFilter, { field: 'minutes_worked', operator: 'eq', value: null }] });
    assert.deepEqual(nullRows.body.data.rows, [{ employee_id: employees[0], work_date: '2026-09-22', minutes_worked: null }]);
    const leave = await request(actors[0], { dataset: 'leave_requests', aggregations: [{ function: 'sum', field: 'requested_days', alias: 'days' }] });
    assert.deepEqual(leave.body.data.rows, [{ days: 2.5 }]);
    const emptyQuery = { dataset: 'employees', filters: [{ field: 'id', operator: 'eq', value: 'absent' }] };
    assert.deepEqual((await request(actors[0], emptyQuery)).body.data.rows, []);
    assert.deepEqual((await db.query('SELECT id FROM employees WHERE company_id=$1 AND id=$2', [companies[0], 'absent'])).rows, []);
    assert.match(executedQueries.at(-1).sql, /e\.company_id = \$1 AND e\.id = \$2/);
    assert.deepEqual(executedQueries.at(-1).params, [companies[0], 'absent', 20, 0]);

    const combined = { ...count, filters: [
      { field: 'employment_status', operator: 'eq', value: 'active' },
      { field: 'title', operator: 'eq', value: 'Tester' },
    ] };
    const expectedCombined = Number((await db.query("SELECT count(*) AS total FROM employees WHERE company_id=$1 AND employment_status='active' AND title='Tester'", [companies[0]])).rows[0].total);
    assert.equal((await request(actors[0], combined)).status, 403);
    assert.equal(expectedCombined, 4);

    assert.equal((await request(id('no-link'), count)).status, 401);
    const beforeForbidden = executedQueries.length;
    const forbidden = await request(actors[2], count);
    assert.equal(forbidden.status, 403);
    assert.equal(forbidden.body.error.code, 'HRM_FORBIDDEN');
    assert.equal(executedQueries.length, beforeForbidden, 'Unauthorized active actor must not execute a DQE SELECT');
    assert.equal((await request(actors[1], count)).status, 403);
    assert.equal((await request(actors[1], grouped)).status, 403);
    assert.equal((await request(actors[1], { dataset: 'attendance_records', filters: [dateFilter], groupBy: ['status'], aggregations: [{ function: 'avg', field: 'minutes_worked', alias: 'average' }] })).body.data.rows[0].average, 300);
    assert.equal((await request(actors[0], { ...count, filters: [{ field: 'id', operator: 'eq', value: employees[5] }] })).status, 403);
    assert.equal((await request(actors[3], count)).status, 403);
    assert.deepEqual((await request(actors[0], { dataset: 'employees', select: ['id'], filters: [{ field: 'id', operator: 'eq', value: employees[5] }] })).body.data.rows, []);
    for (const injected of [
      { ...count, companyId: companies[1] },
      { ...count, employeeId: employees[5] },
      { dataset: 'employees', select: ['email'], sort: [{ field: 'email', direction: 'asc' }] },
      { dataset: 'employees', select: ['salary'] },
      { dataset: 'employees', filters: [{ field: 'id; DROP TABLE employees', operator: 'eq', value: employees[0] }] },
      { dataset: 'employees', sort: [{ field: 'id; DROP TABLE employees', direction: 'asc' }] },
      { dataset: 'employees', aggregations: [{ function: 'count', alias: 'total"; DROP TABLE employees' }] },
      { dataset: 'employees', limit: 101 },
      { dataset: 'attendance_records', filters: [{ field: 'work_date', operator: 'between', value: ['2025-01-01', '2026-09-22'] }] },
    ]) assert.equal((await request(actors[0], injected)).status, 400);
    assert.equal((await request(actors[0], { ...count, filters: [{ field: 'employment_status', operator: 'eq', value: "active' OR true --" }] })).status, 403);
    assert.equal((await request(actors[0], { dataset: 'employees', select: ['id'], filters: [{ field: 'display_name', operator: 'contains', value: "%' OR true --" }] })).body.data.rows.length, 0);
    const concurrent = await Promise.all([request(actors[0], minutes), request(actors[1], minutes), request(actors[3], minutes)]);
    assert.deepEqual(concurrent.map((result) => result.status), [403, 200, 403]);
    assert.equal(concurrent[1].body.data.rows[0].sum_minutes, 300);
    assert.equal((await db.query("SELECT count(*)::int AS total FROM employees WHERE company_id=$1 AND employment_status='active'", [companies[0]])).rows[0].total, expectedCount);
    const nullActor = id('actor-no-department');
    const nullRole = id('role-no-department');
    const nullEmployees = [id('no-department-actor'), id('no-department-peer')];
    for (const employee of nullEmployees) await db.query('INSERT INTO employees (id,company_id,email,display_name,title,employment_status) VALUES ($1,$2,$3,$4,$5,$6)', [employee, companies[0], `${employee}@example.test`, employee, 'Tester', 'active']);
    await db.query('INSERT INTO roles (id,code,name) VALUES ($1,$2,$3)', [nullRole, nullRole, 'No department role']);
    for (const code of ['employee.profile.read.team', 'attendance.read.team']) await db.query('INSERT INTO role_permissions (role_id,permission_id) VALUES ($1,$2)', [nullRole, permissions[code]]);
    await db.query('INSERT INTO employee_roles (company_id,employee_id,role_id) VALUES ($1,$2,$3)', [companies[0], nullEmployees[0], nullRole]);
    await db.query('INSERT INTO hrm_identity_links (company_id,chat_user_id,employee_id) VALUES ($1,$2,$3)', [companies[0], nullActor, nullEmployees[0]]);
    await db.query('INSERT INTO attendance_records (company_id,employee_id,work_date,status,minutes_worked) VALUES ($1,$2,$3,$4,$5)', [companies[0], nullEmployees[1], '2026-09-21', 'present', 480]);
    assert.equal((await legacyRequest(nullActor, `/api/employees/${nullEmployees[1]}`)).status, 403);
    assert.equal((await legacyRequest(nullActor, `/internal/v1/employees/${nullEmployees[1]}`)).status, 403);
    assert.equal((await legacyRequest(nullActor, `/api/employees/${nullEmployees[1]}/attendance`)).status, 403);
  } finally {
    if (server.listening) await new Promise((resolve) => server.close(resolve));
    await db.query('DELETE FROM companies WHERE id = ANY($1::text[])', [companies]).catch(() => {});
    await db.query('DELETE FROM roles WHERE id = ANY($1::text[])', [[roleAll, roleSelf, id('role-no-department')]]).catch(() => {});
    await db.query('DELETE FROM permissions WHERE id = ANY($1::text[])', [permissionCodes.map((_, index) => id(`permission-${index}`))]).catch(() => {});
    await db.close();
    await queryDb.close();
  }
});
