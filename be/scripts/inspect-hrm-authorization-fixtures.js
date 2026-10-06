import { readFile } from 'node:fs/promises';
import { config } from '../src/config.js';
import { createDatabase as createChatDatabase } from '../src/database.js';
import { createDatabase as createHrmDatabase } from '../../hrm-server/src/database.js';

const ids = ['10000000-0000-4000-8000-0000000000a1', '10000000-0000-4000-8000-0000000000a2', '20000000-0000-4000-8000-0000000000b1', '20000000-0000-4000-8000-0000000000b2'];
const hrmEnv = Object.fromEntries((await readFile(new URL('../../hrm-server/.env', import.meta.url), 'utf8')).split(/\r?\n/).map((line) => line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)=(.*)$/)).filter(Boolean).map(([, key, value]) => [key, value.trim().replace(/^['"]|['"]$/g, '')]));
const chat = createChatDatabase({ connectionString: config.databaseUrl || undefined, host: config.databaseHost, port: config.databasePort, database: config.databaseName, user: config.databaseUser, password: config.databasePassword });
const hrm = createHrmDatabase(hrmEnv.DATABASE_URL);
try {
  const [chatRows, hrmRows] = await Promise.all([
    chat.query('SELECT id AS chat_user_id, email, display_name FROM users WHERE id = ANY($1::uuid[]) ORDER BY id', [ids]),
    hrm.query(`SELECT l.chat_user_id, e.id AS employee_id, e.email, e.display_name, e.company_id, array_agg(r.code ORDER BY r.code) FILTER (WHERE r.code IS NOT NULL) AS roles
      FROM hrm_identity_links l JOIN employees e ON e.company_id = l.company_id AND e.id = l.employee_id
      LEFT JOIN employee_roles er ON er.company_id = e.company_id AND er.employee_id = e.id
      LEFT JOIN roles r ON r.id = er.role_id
      WHERE l.chat_user_id = ANY($1::text[]) GROUP BY l.chat_user_id, e.id, e.email, e.display_name, e.company_id ORDER BY l.chat_user_id`, [ids]),
  ]);
  console.log(JSON.stringify({ chatDatabase: config.databaseName, hrmDatabase: new URL(hrmEnv.DATABASE_URL).pathname.slice(1), chatRows: chatRows.rows, hrmRows: hrmRows.rows }, null, 2));
} finally { await Promise.allSettled([chat.close(), hrm.close()]); }
