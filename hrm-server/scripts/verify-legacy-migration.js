import fs from 'node:fs/promises';
import pg from 'pg';

const databaseUrl = process.env.TEST_LEGACY_DATABASE_URL;
if (!databaseUrl) throw new Error('TEST_LEGACY_DATABASE_URL is required. It must name an empty, disposable database.');

const migrationsUrl = new URL('../migrations/', import.meta.url);
const pool = new pg.Pool({ connectionString: databaseUrl, application_name: 'hrm-legacy-migration-verification' });

try {
  for (const name of [
    '001_initial_hrm.sql',
    '002_company_archival.sql',
    '003_leave_management.sql',
    '004_attendance_management.sql',
    '005_project_task_management.sql',
  ]) {
    await pool.query(await fs.readFile(new URL(name, migrationsUrl), 'utf8'));
  }

  // This is a legacy Chat-database artefact. Migration 006 belongs to the
  // HRM database and must neither read nor silently drop it.
  await pool.query('CREATE TABLE user_hrm_contexts (user_id TEXT PRIMARY KEY, company_id TEXT NOT NULL)');
  await pool.query("INSERT INTO companies (id, name, code) VALUES ('legacy-company', 'Legacy Company', 'LEGACY')");
  await pool.query("INSERT INTO employees (id, company_id, email, display_name, title, employment_status) VALUES ('legacy-employee', 'legacy-company', 'legacy@example.test', 'Legacy Employee', 'Legacy', 'active')");
  await pool.query("INSERT INTO hrm_identity_links (company_id, chat_user_id, employee_id) VALUES ('legacy-company', 'legacy-user', 'legacy-employee')");
  await pool.query("INSERT INTO user_hrm_contexts (user_id, company_id) VALUES ('legacy-user', 'legacy-company')");

  await pool.query(await fs.readFile(new URL('006_identity_link_single_user.sql', migrationsUrl), 'utf8'));
  const { rows } = await pool.query(`SELECT
    to_regclass('public.user_hrm_contexts') AS legacy_table,
    EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'hrm_identity_links_chat_user_unique') AS unique_constraint,
    (SELECT count(*)::int FROM hrm_identity_links WHERE chat_user_id = 'legacy-user') AS link_count`);
  const result = rows[0];
  if (result.legacy_table !== 'user_hrm_contexts' || !result.unique_constraint || result.link_count !== 1) {
    throw new Error('Migration 006 did not preserve legacy data and add the expected identity constraint.');
  }
  console.log(JSON.stringify({ event: 'hrm.legacy_migration.verified', ...result }));
} finally {
  await pool.end();
}
