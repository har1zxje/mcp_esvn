import 'dotenv/config';
import { createDatabase } from '../src/database.js';
import { createHrmService } from '../../hrm-server/src/app.js';

const db = createDatabase({ connectionString: process.env.DATABASE_URL || undefined, host: process.env.DB_HOST || '127.0.0.1', port: Number(process.env.DB_PORT || 5432), database: process.env.DB_NAME || 'mcpserver', user: process.env.DB_USER || 'postgres', password: process.env.DB_PASSWORD });
const checks = {};
const check = async (name, sql, expected = 0) => {
  const result = Number((await db.query(sql)).rows[0].n);
  checks[name] = { result, expected, pass: result === expected };
  if (result !== expected) throw new Error(`${name}: expected ${expected}, got ${result}`);
};
try {
  await check('database_name', "SELECT count(*)::int AS n FROM pg_database WHERE datname=current_database() AND datname='mcpserver'", 1);
  await check('unvalidated_foreign_keys', "SELECT count(*)::int AS n FROM pg_constraint WHERE contype='f' AND NOT convalidated");
  await check('demo_users', "SELECT count(*)::int AS n FROM users WHERE email IN ('demo.manager@sao-viet.test','demo.employee@sao-viet.test','demo.manager@minh-an.test','demo.employee@minh-an.test')", 4);
  await check('demo_identity_mismatch', "SELECT count(*)::int AS n FROM users u JOIN hrm_identity_links l ON l.chat_user_id=u.id::text LEFT JOIN employees e ON e.company_id=l.company_id AND e.id=l.employee_id WHERE u.email LIKE 'demo.%' AND (e.id IS NULL OR e.email<>u.email)");
  await check('demo_role_mismatch', "SELECT count(*)::int AS n FROM users u JOIN hrm_identity_links l ON l.chat_user_id=u.id::text JOIN employee_roles er ON er.company_id=l.company_id AND er.employee_id=l.employee_id JOIN roles r ON r.id=er.role_id WHERE u.email LIKE 'demo.%' AND ((u.email LIKE 'demo.manager%' AND r.code<>'MANAGER') OR (u.email LIKE 'demo.employee%' AND r.code<>'EMPLOYEE'))");
  await check('demo_cross_company_links', "SELECT count(*)::int AS n FROM hrm_identity_links l JOIN users u ON u.id::text=l.chat_user_id WHERE u.email LIKE 'demo.%' AND ((u.email LIKE '%sao-viet.test' AND l.company_id<>'dev-company-a') OR (u.email LIKE '%minh-an.test' AND l.company_id<>'dev-company-b'))");
  await check('demo_projects', "SELECT count(*)::int AS n FROM projects WHERE id LIKE 'demo-%-project-%'", 4);
  await check('demo_projects_without_members_or_tasks', "SELECT count(*)::int AS n FROM projects p WHERE p.id LIKE 'demo-%-project-%' AND (NOT EXISTS (SELECT 1 FROM project_members m WHERE m.company_id=p.company_id AND m.project_id=p.id) OR NOT EXISTS (SELECT 1 FROM tasks t WHERE t.company_id=p.company_id AND t.project_id=p.id))");
  await check('demo_unassigned_tasks', "SELECT count(*)::int AS n FROM tasks t JOIN projects p ON p.company_id=t.company_id AND p.id=t.project_id WHERE p.id LIKE 'demo-%-project-%' AND NOT EXISTS (SELECT 1 FROM task_assignments a WHERE a.company_id=t.company_id AND a.task_id=t.id)");
  await check('demo_cross_company_task_relations', "SELECT count(*)::int AS n FROM task_assignments a JOIN tasks t ON t.id=a.task_id LEFT JOIN employees e ON e.id=a.employee_id AND e.company_id=a.company_id WHERE t.company_id<>a.company_id OR e.id IS NULL");
  await check('demo_task_statuses', "SELECT count(DISTINCT status)::int AS n FROM tasks WHERE title LIKE 'Demo %'", 4);
  await check('demo_leave_statuses', "SELECT count(DISTINCT status)::int AS n FROM leave_requests WHERE reason LIKE 'Demo %'", 3);
  await check('demo_leave_approval_mismatch', "SELECT count(*)::int AS n FROM leave_requests r LEFT JOIN leave_approvals a ON a.leave_request_id=r.id WHERE r.reason LIKE 'Demo %' AND ((r.status='pending' AND a.id IS NOT NULL) OR (r.status IN ('approved','rejected') AND (a.id IS NULL OR a.decision<>r.status OR a.company_id<>r.company_id OR a.approver_employee_id=r.employee_id)))");
  await check('demo_leave_balance_mismatch', "SELECT count(*)::int AS n FROM leave_balances b JOIN employees e ON e.company_id=b.company_id AND e.id=b.employee_id WHERE e.id LIKE 'demo-%' AND b.used_days<>(SELECT coalesce(sum(r.requested_days),0) FROM leave_requests r WHERE r.company_id=b.company_id AND r.employee_id=b.employee_id AND r.leave_type_id=b.leave_type_id AND r.status='approved' AND EXTRACT(YEAR FROM r.start_date)=b.leave_year)");
  const hrm = createHrmService(db);
  const identities = [
    ['10000000-0000-4000-8000-000000000001', 'dev-company-a', 'demo-a-manager', true],
    ['10000000-0000-4000-8000-000000000002', 'dev-company-a', 'demo-a-employee', false],
    ['10000000-0000-4000-8000-000000000003', 'dev-company-b', 'demo-b-manager', true],
    ['10000000-0000-4000-8000-000000000004', 'dev-company-b', 'demo-b-employee', false],
  ];
  for (const [userId, companyId, employeeId, manager] of identities) {
    const actor = await hrm.resolveExecutionContext(userId, 'demo-verify');
    if (actor.companyId !== companyId || actor.employeeId !== employeeId || actor.permissions.includes('organization.manage') || actor.permissions.includes('employee.profile.read.any') || actor.permissions.includes('task.manage.team') !== manager || actor.permissions.includes('leave.approve.team') !== manager) throw new Error(`Permission or identity mismatch: ${userId}`);
    checks[`actor_${employeeId}`] = { pass: true };
    const tasks = await hrm.getMyTasks(actor);
    if (!manager && tasks.length !== 8) throw new Error(`Assigned task count mismatch: ${employeeId}`);
    const leave = await hrm.getMyLeaveRequests(actor);
    if (!manager && leave.length !== 3) throw new Error(`Leave count mismatch: ${employeeId}`);
  }
  try { await hrm.getEmployee('dev-company-b', 'demo-a-employee'); throw new Error('Cross-company employee read unexpectedly succeeded'); }
  catch (error) { if (error.code !== 'HRM_NOT_FOUND') throw error; checks.cross_company_employee_read = { pass: true }; }
  console.log(JSON.stringify({ event: 'demo.verify.completed', checks }));
} catch (error) {
  console.error(JSON.stringify({ event: 'demo.verify.failed', message: error.message, checks }));
  process.exitCode = 1;
} finally { await db.close(); }
