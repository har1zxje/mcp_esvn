import assert from 'node:assert/strict';
import test from 'node:test';
import { buildDynamicQuery, executeDynamicQuery } from '../src/dynamicQuery.js';
import { createServer } from '../src/app.js';

const any = { companyId: 'company-a', employeeId: 'employee-a', departmentId: 'dept-a', permissions: ['employee.profile.read.any'], requestId: 'request-a' };
const self = { ...any, permissions: ['attendance.read.self', 'leave.read.self'] };
const team = { ...any, permissions: ['attendance.read.team'] };
const count = { dataset: 'employees', filters: [{ field: 'employment_status', operator: 'eq', value: 'active' }], aggregations: [{ function: 'count', alias: 'total' }] };

test('company employee aggregates are denied pending an approved release policy', () => {
  assert.throws(() => buildDynamicQuery(count, any), (error) => error.code === 'HRM_FORBIDDEN');
  assert.throws(() => buildDynamicQuery({ ...count, filters: [{ field: 'id', operator: 'eq', value: 'employee-a' }] }, any), (error) => error.code === 'HRM_FORBIDDEN');
});

test('fixed join, search, sort and pagination use only registered identifiers', () => {
  const plan = buildDynamicQuery({ dataset: 'employees', filters: [{ field: 'display_name', operator: 'contains', value: 'A_%' }], select: ['department_name'], sort: [{ field: 'department_name', direction: 'desc' }], limit: 5, offset: 10 }, any);
  assert.match(plan.sql, /LEFT JOIN departments d ON d\.company_id = e\.company_id AND d\.id = e\.department_id/);
  assert.match(plan.sql, /ORDER BY d\.name DESC LIMIT \$3 OFFSET \$4/);
  assert.equal(plan.params[1], '%A\\_\\%%');
});

test('self attendance aggregates and team attendance aggregates have separate policies', () => {
  const query = { dataset: 'attendance_records', filters: [{ field: 'work_date', operator: 'between', value: ['2026-09-01', '2026-09-30'] }], aggregations: [{ function: 'sum', field: 'minutes_worked', alias: 'minutes' }] };
  const mine = buildDynamicQuery(query, self);
  assert.match(mine.sql, /a\.company_id = \$1 AND a\.employee_id = \$2/);
  assert.deepEqual(mine.params.slice(0, 2), ['company-a', 'employee-a']);
  assert.throws(() => buildDynamicQuery(query, team), (error) => error.code === 'HRM_FORBIDDEN');
  const both = { ...team, permissions: ['attendance.read.team', 'attendance.read.self'] };
  assert.throws(() => buildDynamicQuery(query, both), (error) => error.code === 'HRM_FORBIDDEN');
  const explicitOwn = buildDynamicQuery({ ...query, filters: [...query.filters, { field: 'employee_id', operator: 'eq', value: 'employee-a' }] }, both);
  assert.match(explicitOwn.sql, /a\.company_id = \$1 AND a\.employee_id = \$2/);
});

test('leave records are always owned by the linked employee', () => {
  const plan = buildDynamicQuery({ dataset: 'leave_requests', aggregations: [{ function: 'sum', field: 'requested_days', alias: 'days' }] }, self);
  assert.match(plan.sql, /l\.company_id = \$1 AND l\.employee_id = \$2/);
  assert.deepEqual(plan.params.slice(0, 2), ['company-a', 'employee-a']);
});

test('numeric aggregates, null filters and set filters compile with matching placeholders', () => {
  const plan = buildDynamicQuery({ dataset: 'leave_requests', filters: [
    { field: 'status', operator: 'in', value: ['approved', 'pending'] },
    { field: 'end_date', operator: 'eq', value: null },
  ], aggregations: [
    { function: 'sum', field: 'requested_days', alias: 'sum_days' },
    { function: 'avg', field: 'requested_days', alias: 'avg_days' },
    { function: 'min', field: 'requested_days', alias: 'min_days' },
    { function: 'max', field: 'requested_days', alias: 'max_days' },
  ] }, self);
  assert.match(plan.sql, /SUM\(l\.requested_days\).*AVG\(l\.requested_days\).*MIN\(l\.requested_days\).*MAX\(l\.requested_days\)/);
  assert.match(plan.sql, /l\.status IN \(\$3, \$4\) AND l\.end_date IS NULL/);
  assert.deepEqual(plan.params, ['company-a', 'employee-a', 'approved', 'pending', 20, 0]);
});

test('list fields, empty result and numeric/date normalization retain structure', async () => {
  const db = { transaction: async (work) => work({ query: async (sql) => ({ rows: sql.startsWith('SELECT') ? [{ id: 'record-a', work_date: new Date('2026-09-21T00:00:00Z'), minutes_worked: 480 }] : [] }) }) };
  const query = { dataset: 'attendance_records', select: ['id', 'work_date', 'minutes_worked'], filters: [{ field: 'work_date', operator: 'between', value: ['2026-09-01', '2026-09-30'] }], limit: 1, offset: 0 };
  const result = await executeDynamicQuery(db, self, query);
  assert.deepEqual(result.rows, [{ id: 'record-a', work_date: '2026-09-21', minutes_worked: 480 }]);
  const emptyDb = { transaction: async (work) => work({ query: async () => ({ rows: [] }) }) };
  assert.deepEqual((await executeDynamicQuery(emptyDb, self, query)).rows, []);
});

test('invalid permissions, fields, operators and limits fail closed', () => {
  const forbidden = (query, actor = any) => assert.throws(() => buildDynamicQuery(query, actor), (error) => ['HRM_FORBIDDEN', 'HRM_VALIDATION_FAILED'].includes(error.code));
  forbidden(count, self);
  forbidden({ dataset: 'employees', sql: 'SELECT * FROM employees' });
  forbidden({ dataset: 'employees', select: ['salary'] });
  forbidden({ dataset: 'employees', filters: [{ field: 'email', operator: 'contains', value: "x' OR true --" }] }, self);
  forbidden({ dataset: 'employees', joins: [{ table: 'hrm_identity_links' }] });
  forbidden({ dataset: 'employees', sort: [{ field: 'email', direction: 'asc' }] });
  forbidden({ dataset: 'employees', aggregations: [{ function: 'avg', field: 'display_name', alias: 'avg' }] });
  forbidden({ dataset: 'employees', limit: 101 });
  forbidden({ dataset: 'attendance_records' }, self);
  forbidden({ dataset: 'attendance_records', filters: [{ field: 'work_date', operator: 'between', value: ['2025-01-01', '2026-12-31'] }] }, self);
  forbidden({ dataset: 'employees', aggregations: [{ function: 'count', alias: 'total"; DROP TABLE employees; --' }] });
});

test('untrusted self-only values stay in parameters and read-only transaction is enforced', async () => {
  const calls = [];
  const db = { transaction: async (work) => work({ query: async (sql, params) => { calls.push({ sql, params }); return { rows: sql.startsWith('SELECT') ? [{ total: '3' }] : [] }; } }) };
  const data = await executeDynamicQuery(db, self, { dataset: 'leave_requests', filters: [{ field: 'status', operator: 'eq', value: "active' OR true --" }], aggregations: [{ function: 'count', alias: 'total' }] });
  assert.deepEqual(calls.slice(0, 2).map((call) => call.sql), ['SET TRANSACTION READ ONLY', "SET LOCAL statement_timeout = '3000ms'"]);
  assert.equal(calls[2].params[2], "active' OR true --");
  assert.ok(!calls[2].sql.includes("active' OR true --"));
  assert.equal(data.rows[0].total, 3);
});

test('one-person groups, repeated rows, small groups and subtraction queries fail before SQL', async () => {
  let transactions = 0;
  const db = { transaction: async () => { transactions++; throw new Error('SQL must not run'); } };
  const date = { field: 'work_date', operator: 'between', value: ['2026-09-01', '2026-09-30'] };
  const aggregate = { dataset: 'attendance_records', filters: [date], aggregations: [{ function: 'count', alias: 'records' }, { function: 'sum', field: 'minutes_worked', alias: 'minutes' }] };
  const variants = [
    { ...aggregate, groupBy: ['employee_id'] },
    { ...aggregate, groupBy: ['status'] },
    { ...aggregate, filters: [...aggregate.filters, { field: 'employee_id', operator: 'eq', value: 'employee-a' }] },
    { ...aggregate, filters: [...aggregate.filters, { field: 'employee_id', operator: 'ne', value: 'employee-a' }] },
    aggregate,
    { ...aggregate, aggregations: [{ function: 'avg', field: 'minutes_worked', alias: 'average' }] },
    { ...count, groupBy: ['department_name'] },
    { ...count, filters: [{ field: 'id', operator: 'eq', value: 'foreign-employee' }] },
  ];
  for (const query of variants) await assert.rejects(executeDynamicQuery(db, query.dataset === 'employees' ? any : team, query), (error) => error.code === 'HRM_FORBIDDEN');
  assert.equal(transactions, 0);
});

test('HTTP query route requires trusted actor and forwards only the validated body', async () => {
  const seen = [];
  const service = {
    async resolveExecutionContext(actor) { return { ...any, actor }; },
    async queryData(context, query) { seen.push({ context, query }); return { dataset: 'employees', rows: [{ total: 3 }], count: 1, limit: 20, offset: 0 }; },
  };
  const server = createServer(service, { internalToken: 'secret' });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${server.address().port}/internal/v1/query`;
  try {
    const unauth = await fetch(url, { method: 'POST', body: JSON.stringify(count) });
    assert.equal(unauth.status, 401);
    const authorized = await fetch(url, { method: 'POST', headers: { 'x-hrm-internal-token': 'secret', 'x-hrm-contract-version': '1', 'x-actor-user-id': 'chat-a', 'x-request-id': 'request-a' }, body: JSON.stringify({ ...count, companyId: 'spoofed' }) });
    assert.equal(authorized.status, 200);
    assert.equal((await authorized.json()).data.rows[0].total, 3);
    assert.equal(seen[0].context.companyId, 'company-a');
  } finally { await new Promise((resolve) => server.close(resolve)); }
});
