import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createDatabase } from './database.js';

const migrationsUrl = new URL('../migrations/', import.meta.url);
const db = createDatabase();
try {
  await db.query('CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())');
  const applied = new Set((await db.query('SELECT name FROM schema_migrations')).rows.map((row) => row.name));
  const names = (await fs.readdir(migrationsUrl)).filter((name) => /^\d+_.+\.sql$/.test(name)).sort();
  for (const name of names) {
    if (applied.has(name)) continue;
    const sql = await fs.readFile(new URL(name, migrationsUrl), 'utf8');
    await db.transaction(async (client) => { await client.query(sql); await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [name]); });
    console.log(JSON.stringify({ event: 'hrm.migration.applied', name }));
  }
} finally { await db.close(); }

if (process.argv[1] === fileURLToPath(import.meta.url)) process.exitCode = 0;
