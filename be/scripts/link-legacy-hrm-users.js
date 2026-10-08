import 'dotenv/config';
import { randomBytes } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { createDatabase } from '../src/database.js';
import { UserRepository } from '../src/repositories.js';

// Stable IDs are also used by hrm-server/src/seed.js. Passwords are generated
// only for newly created users and are never stored in the repository.
const mappings = [
  { oldId: 'chat-sao-minh-anh', userId: '30000000-0000-4000-8000-000000000001', companyId: 'dev-company-a', employeeId: 'employee-a1' },
  { oldId: 'chat-sao-khanh-linh', userId: '30000000-0000-4000-8000-000000000002', companyId: 'dev-company-a', employeeId: 'employee-a2' },
  { oldId: 'chat-sao-hr-quynh', userId: '30000000-0000-4000-8000-000000000003', companyId: 'dev-company-a', employeeId: 'emp-svt-hr-quynh' },
  { oldId: 'chat-minh-an-tuan-lam', userId: '30000000-0000-4000-8000-000000000004', companyId: 'dev-company-b', employeeId: 'emp-man-logistics-lam' },
  { oldId: 'chat-minh-an-trang', userId: '30000000-0000-4000-8000-000000000005', companyId: 'dev-company-b', employeeId: 'emp-man-dispatch-trang' },
];

const db = createDatabase({
  connectionString: process.env.DATABASE_URL || undefined,
  host: process.env.DB_HOST || '127.0.0.1',
  port: Number(process.env.DB_PORT || 5432),
  database: process.env.DB_NAME || 'mcpserver',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD,
});
const one = async (client, sql, args = []) => (await client.query(sql, args)).rows[0];
const assert = (condition, message) => { if (!condition) throw new Error(message); };

try {
  assert(process.argv.includes('--apply'), 'Pass --apply after backing up mcpserver.');
  const createdCredentials = [];
  const result = await db.transaction(async (client) => {
    await client.query('SELECT pg_advisory_xact_lock($1)', [20261009]);
    assert((await one(client, 'SELECT current_database() AS name')).name === 'mcpserver', 'Unexpected database');
    const users = new UserRepository(client);
    const repaired = [];
    for (const mapping of mappings) {
      const employee = await one(client, 'SELECT email,display_name,employment_status FROM employees WHERE company_id=$1 AND id=$2', [mapping.companyId, mapping.employeeId]);
      assert(employee?.employment_status === 'active', `Employee missing or inactive: ${mapping.employeeId}`);
      const oldLink = await one(client, 'SELECT id,company_id,employee_id FROM hrm_identity_links WHERE chat_user_id=$1 FOR UPDATE', [mapping.oldId]);
      const newLink = await one(client, 'SELECT id,company_id,employee_id FROM hrm_identity_links WHERE chat_user_id=$1 FOR UPDATE', [mapping.userId]);
      assert(oldLink || newLink, `HRM identity link missing: ${mapping.employeeId}`);
      assert(!(oldLink && newLink), `Both old and new links exist: ${mapping.employeeId}`);
      const link = oldLink || newLink;
      assert(link.company_id === mapping.companyId && link.employee_id === mapping.employeeId, `Link conflict: ${mapping.employeeId}`);
      const sameId = await one(client, 'SELECT id,email,password_hash FROM users WHERE id=$1', [mapping.userId]);
      const sameEmail = await one(client, 'SELECT id,email,password_hash FROM users WHERE lower(email)=lower($1)', [employee.email]);
      assert(!sameId || (sameId.email.toLowerCase() === employee.email.toLowerCase() && sameId.password_hash), `User ID conflict: ${mapping.userId}`);
      assert(!sameEmail || sameEmail.id === mapping.userId, `Employee email already belongs to another Chat user: ${mapping.employeeId}`);
      if (!sameId) {
        const password = randomBytes(24).toString('base64url');
        await users.createUser({ id: mapping.userId, email: employee.email.toLowerCase(), name: employee.display_name, passwordHash: await bcrypt.hash(password, 12) });
        createdCredentials.push({ email: employee.email.toLowerCase(), password });
      }
      if (oldLink) await client.query('UPDATE hrm_identity_links SET chat_user_id=$1,updated_at=now() WHERE id=$2', [mapping.userId, oldLink.id]);
      repaired.push({ companyId: mapping.companyId, employeeId: mapping.employeeId, userId: mapping.userId, existingLinkPreserved: !oldLink });
    }
    return repaired;
  });
  console.log(JSON.stringify({ event: 'legacy.hrm.links.repaired', links: result, newAccounts: createdCredentials.length }));
  // Printed once after COMMIT; keep this output out of source control and logs.
  if (createdCredentials.length) console.log(JSON.stringify({ event: 'legacy.hrm.login.credentials.once', credentials: createdCredentials }));
} catch (error) {
  console.error(JSON.stringify({ event: 'legacy.hrm.links.failed', message: error.message, code: error.code }));
  process.exitCode = 1;
} finally { await db.close(); }
