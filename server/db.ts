import pg, { type PoolClient } from 'pg';
import { readFile } from 'node:fs/promises';
import { config } from './config.js';
pg.types.setTypeParser(1082, (value) => value); // DATE values must stay calendar dates, never local JS timestamps.
const databaseUrl = new URL(config.databaseUrl);
if (process.env.DATABASE_SSL === 'true') {
  for (const key of ['sslmode', 'sslcert', 'sslkey', 'sslrootcert'])
    databaseUrl.searchParams.delete(key);
}
export const pool = new pg.Pool({
  connectionString: databaseUrl.href,
  max: process.env.VERCEL ? 2 : 10,
  connectionTimeoutMillis: 10000,
  idleTimeoutMillis: 10000,
  ssl:
    process.env.DATABASE_SSL === 'true'
      ? {
          rejectUnauthorized: true,
          ...(process.env.DATABASE_SSL_CA
            ? { ca: process.env.DATABASE_SSL_CA.replace(/\\n/g, '\n') }
            : {}),
        }
      : undefined,
  options: process.env.DB_SCHEMA ? `-c search_path=${process.env.DB_SCHEMA}` : undefined,
});
pool.on('error', (error) => console.error('Idle PostgreSQL connection error:', error.message));
export type DB = Pick<PoolClient, 'query'>;
export async function transaction<T>(fn: (db: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
export async function migrate() {
  const sql = await readFile(new URL('./schema.sql', import.meta.url), 'utf8');
  await transaction(async (db) => {
    await db.query('SELECT pg_advisory_xact_lock(418944)');
    await db.query(sql);
  });
}
