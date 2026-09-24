import pg from 'pg';

const { Pool } = pg;

export function createDatabase({ connectionString, host, port, database, user, password, max = 10 } = {}) {
  let connectionOptions;
  if (connectionString) {
    let urlPassword = '';
    try { urlPassword = decodeURIComponent(new URL(connectionString).password || ''); } catch { throw new Error('DATABASE_URL is invalid'); }
    const resolvedPassword = password ?? process.env.PGPASSWORD ?? urlPassword;
    if (typeof resolvedPassword !== 'string' || resolvedPassword.length === 0) throw new Error('PostgreSQL password is missing; set DB_PASSWORD or include a password in DATABASE_URL');
    connectionOptions = { connectionString, ...(password != null || process.env.PGPASSWORD ? { password: String(resolvedPassword) } : {}) };
  } else {
    if (typeof password !== 'string' || password.length === 0) throw new Error('PostgreSQL password is missing; set DB_PASSWORD or DATABASE_URL');
    connectionOptions = { host, port, database, user, password: String(password) };
  }
  const pool = new Pool({
    ...connectionOptions,
    max,
    application_name: 'mcpserver-project-backend',
  });
  pool.on('error', (error) => console.error(JSON.stringify({ event: 'database.pool.error', code: error.code || 'DB_POOL_ERROR' })));
  return {
    pool,
    query(text, values) { return pool.query(text, values); },
    async transaction(work) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const result = await work(client);
        await client.query('COMMIT');
        return result;
      } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        throw error;
      } finally { client.release(); }
    },
    async close() { await pool.end(); },
  };
}

export async function initializeDatabase(database, schemaSql) {
  await database.query(schemaSql);
}
