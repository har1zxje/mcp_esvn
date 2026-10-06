import pg from 'pg';

const { Pool } = pg;

export function createDatabase(connectionString = process.env.DATABASE_URL) {
  if (!connectionString) throw new Error('DATABASE_URL is required for hrm-server. Run db:migrate before starting the service.');
  const pool = new Pool({ connectionString, max: Number(process.env.HRM_DB_POOL_MAX ?? 10), application_name: 'hrm-server' });
  pool.on('error', (error) => console.error(JSON.stringify({ event: 'hrm.database.pool_error', code: error.code ?? 'DB_POOL_ERROR' })));
  return {
    query(text, values) { return pool.query(text, values); },
    async transaction(work) {
      const client = await pool.connect();
      try { await client.query('BEGIN'); const result = await work(client); await client.query('COMMIT'); return result; }
      catch (error) { await client.query('ROLLBACK').catch(() => {}); throw error; }
      finally { client.release(); }
    },
    close() { return pool.end(); },
  };
}
