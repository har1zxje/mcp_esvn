import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { createDatabase } from '../src/database.js';
import { UserRepository, ConversationRepository } from '../src/repositories.js';
import { createHrmService } from '../../hrm-server/src/app.js';

// This fixture deliberately leaves integrations, sessions and mutation confirmations
// to their real authentication/integration/workflow endpoints.
const people = [
  { key: 'a-manager', company: 'dev-company-a', department: 'dept-product', position: 'position-product-builder', role: 'MANAGER', email: 'demo.manager@sao-viet.test', name: 'Demo Sao Viet Manager', title: 'Product Manager', userId: '10000000-0000-4000-8000-000000000001' },
  { key: 'a-employee', company: 'dev-company-a', department: 'dept-product', position: 'position-product-builder', role: 'EMPLOYEE', email: 'demo.employee@sao-viet.test', name: 'Demo Sao Viet Employee', title: 'Product Specialist', userId: '10000000-0000-4000-8000-000000000002' },
  { key: 'b-manager', company: 'dev-company-b', department: 'dept-logistics', position: 'position-logistics-manager', role: 'MANAGER', email: 'demo.manager@minh-an.test', name: 'Demo Minh An Manager', title: 'Logistics Manager', userId: '10000000-0000-4000-8000-000000000003' },
  { key: 'b-employee', company: 'dev-company-b', department: 'dept-logistics', position: 'position-dispatcher', role: 'EMPLOYEE', email: 'demo.employee@minh-an.test', name: 'Demo Minh An Employee', title: 'Dispatcher', userId: '10000000-0000-4000-8000-000000000004' },
].map((p) => ({ ...p, employeeId: `demo-${p.key}` }));

const db = createDatabase({ connectionString: process.env.DATABASE_URL || undefined, host: process.env.DB_HOST || '127.0.0.1', port: Number(process.env.DB_PORT || 5432), database: process.env.DB_NAME || 'mcpserver', user: process.env.DB_USER || 'postgres', password: process.env.DB_PASSWORD });
const one = async (client, sql, values = []) => (await client.query(sql, values)).rows[0];
const counts = async (client) => {
  const tables = (await client.query("SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename")).rows.map((r) => r.tablename);
  const result = {};
  for (const table of tables) result[table] = Number((await client.query(`SELECT count(*) AS n FROM "${table}"`)).rows[0].n);
  return result;
};
const exact = (value, expected, label) => { if (value !== expected) throw new Error(`${label} conflicts with existing data`); };

try {
  if (process.argv.includes('--counts')) {
    console.log(JSON.stringify(await counts(db)));
  } else if (process.argv.includes('--seed')) {
    const password = process.env.MCP_DEMO_PASSWORD;
    if (!password || password.length < 16) throw new Error('MCP_DEMO_PASSWORD must be set to at least 16 characters');
    const before = await counts(db);
    await db.transaction(async (client) => {
      await client.query('SELECT pg_advisory_xact_lock($1)', [20261008]);
      const scopedDb = { query: (...args) => client.query(...args), transaction: (work) => work(client) };
      const hrm = createHrmService(scopedDb);
      const users = new UserRepository(scopedDb);
      const conversations = new ConversationRepository(scopedDb);
      const roleRows = (await client.query("SELECT id, code FROM roles WHERE code IN ('MANAGER','EMPLOYEE')")).rows;
      const roles = Object.fromEntries(roleRows.map((r) => [r.code, r.id]));
      if (!roles.MANAGER || !roles.EMPLOYEE) throw new Error('Required HRM roles are missing');
      const passwordHash = await bcrypt.hash(password, 12);
      for (const p of people) {
        const userByEmail = await users.findByEmail(p.email);
        const userById = await users.findById(p.userId);
        if (userByEmail || userById) {
          exact(userByEmail?.id, p.userId, `Chat user ${p.email}`);
          exact(userById?.email, p.email, `Chat user ${p.userId}`);
        } else await users.createUser({ id: p.userId, email: p.email, name: p.name, passwordHash });
        const existing = await one(client, 'SELECT company_id, department_id, email FROM employees WHERE id=$1', [p.employeeId]);
        if (existing) {
          exact(existing.company_id, p.company, `Employee ${p.employeeId}`);
          exact(existing.department_id, p.department, `Employee ${p.employeeId}`);
          exact(existing.email, p.email, `Employee ${p.employeeId}`);
        } else await hrm.createEmployee(p.company, { id: p.employeeId, departmentId: p.department, positionId: p.position, email: p.email, displayName: p.name, title: p.title, employmentStatus: 'active' }, { requestId: 'demo-seed' });
        await client.query('INSERT INTO employee_roles(company_id,employee_id,role_id) VALUES($1,$2,$3) ON CONFLICT DO NOTHING', [p.company, p.employeeId, roles[p.role]]);
        const link = await one(client, 'SELECT company_id, employee_id FROM hrm_identity_links WHERE chat_user_id=$1', [p.userId]);
        if (link) { exact(link.company_id, p.company, `Identity ${p.email}`); exact(link.employee_id, p.employeeId, `Identity ${p.email}`); }
        else await client.query('INSERT INTO hrm_identity_links(company_id,chat_user_id,employee_id) VALUES($1,$2,$3)', [p.company, p.userId, p.employeeId]);
        const leaveType = await one(client, "SELECT id FROM leave_types WHERE company_id=$1 AND code='ANNUAL'", [p.company]);
        if (!leaveType) throw new Error(`Annual leave type missing for ${p.company}`);
        await client.query('INSERT INTO leave_balances(company_id,employee_id,leave_type_id,leave_year,allocated_days) VALUES($1,$2,$3,2026,$4) ON CONFLICT DO NOTHING', [p.company, p.employeeId, leaveType.id, p.role === 'MANAGER' ? 15 : 12]);
        p.leaveTypeId = leaveType.id;
        const conversationId = `20000000-0000-4000-8000-00000000000${people.indexOf(p) + 1}`;
        const oldConversation = await conversations.findById(conversationId);
        if (oldConversation) exact(oldConversation.ownerId, p.userId, `Conversation ${conversationId}`);
        else {
          const now = Date.now();
          await conversations.upsert({ id: conversationId, ownerId: p.userId, title: 'Giới thiệu HRM demo', modelId: process.env.CHAT_DEFAULT_MODEL_ID || '', mcpServers: [], messages: [{ id: randomUUID(), role: 'user', content: 'Tôi có thể xem công việc và đơn nghỉ phép của mình ở đâu?' }, { id: randomUUID(), role: 'assistant', content: 'Bạn có thể dùng công cụ HRM để xem công việc được giao và các đơn nghỉ phép của chính mình.' }], createdAt: now, updatedAt: now });
        }
      }
      const contexts = {};
      for (const p of people) contexts[p.key] = { ...await hrm.resolveExecutionContext(p.userId, 'demo-seed'), chatUserId: p.userId };
      for (const companyKey of ['a', 'b']) {
        const manager = people.find((p) => p.key === `${companyKey}-manager`);
        const employee = people.find((p) => p.key === `${companyKey}-employee`);
        const managerContext = contexts[manager.key];
        const employeeContext = contexts[employee.key];
        for (let projectNo = 1; projectNo <= 2; projectNo++) {
          const projectId = `demo-${companyKey}-project-${projectNo}`;
          const project = await one(client, 'SELECT company_id, created_by_employee_id FROM projects WHERE id=$1', [projectId]);
          if (project) { exact(project.company_id, manager.company, projectId); exact(project.created_by_employee_id, manager.employeeId, projectId); }
          else await hrm.createProject(managerContext, { id: projectId, name: `Demo ${companyKey.toUpperCase()} - ${projectNo === 1 ? 'Vận hành' : 'Cải tiến'}`, code: `DEMO-${companyKey.toUpperCase()}-${projectNo}`, description: 'Dự án mẫu để thực hành quy trình HRM.' });
          for (const [index, status] of ['todo', 'in_progress', 'blocked', 'done'].entries()) {
            const title = `Demo ${companyKey.toUpperCase()} P${projectNo} - Công việc ${index + 1}`;
            const found = (await client.query('SELECT id, status FROM tasks WHERE company_id=$1 AND project_id=$2 AND title=$3', [manager.company, projectId, title])).rows;
            if (found.length > 1) throw new Error(`Duplicate task: ${title}`);
            const task = found[0] || await hrm.createTask(managerContext, projectId, { title, description: 'Công việc demo có người phụ trách và lịch sử trạng thái.', priority: index === 2 ? 'high' : 'medium', dueDate: `2026-10-${String(20 + index + projectNo).padStart(2, '0')}` });
            const assignment = await one(client, 'SELECT employee_id FROM task_assignments WHERE company_id=$1 AND task_id=$2', [manager.company, task.id]);
            if (assignment) exact(assignment.employee_id, employee.employeeId, `Assignment ${task.id}`);
            else await hrm.assignTask(managerContext, task.id, { employeeId: employee.employeeId });
            if (!found[0]) {
              if (status === 'done') await hrm.updateTaskStatus(employeeContext, task.id, { status: 'in_progress' });
              if (status !== 'todo') await hrm.updateTaskStatus(employeeContext, task.id, { status });
            } else exact(found[0].status, status, `Task status ${task.id}`);
            const comment = `Demo: Đã cập nhật tiến độ công việc ${index + 1}.`;
            const existingComment = await one(client, 'SELECT id FROM task_comments WHERE company_id=$1 AND task_id=$2 AND employee_id=$3 AND body=$4', [manager.company, task.id, employee.employeeId, comment]);
            if (!existingComment) await client.query('INSERT INTO task_comments(company_id,task_id,employee_id,body) VALUES($1,$2,$3,$4)', [manager.company, task.id, employee.employeeId, comment]);
          }
        }
        for (const [index, desiredStatus] of ['pending', 'approved', 'rejected'].entries()) {
          const reason = `Demo ${companyKey.toUpperCase()}: ${desiredStatus} ${index + 1}`;
          const found = (await client.query('SELECT id,status FROM leave_requests WHERE company_id=$1 AND employee_id=$2 AND reason=$3', [employee.company, employee.employeeId, reason])).rows;
          if (found.length > 1) throw new Error(`Duplicate leave: ${reason}`);
          const request = found[0] || await hrm.requestLeave(employeeContext, { leaveTypeId: employee.leaveTypeId, startDate: `2026-10-${String(26 + index).padStart(2, '0')}`, endDate: `2026-10-${String(26 + index).padStart(2, '0')}`, requestedDays: 1, reason });
          if (!found[0]) {
            if (desiredStatus === 'approved') await hrm.approveLeave(managerContext, request.id);
            if (desiredStatus === 'rejected') await hrm.rejectLeave(managerContext, request.id);
          } else exact(found[0].status, desiredStatus, `Leave ${request.id}`);
        }
      }
    });
    const after = await counts(db);
    console.log(JSON.stringify({ event: 'demo.seed.completed', before, after, accounts: people.map(({ email, role, company }) => ({ email, role, company })) }));
  } else throw new Error('Use --counts or --seed');
} catch (error) {
  console.error(JSON.stringify({ event: 'demo.seed.failed', message: error.message, code: error.code }));
  process.exitCode = 1;
} finally { await db.close(); }
