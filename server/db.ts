import pg, { type PoolClient } from 'pg';
import { readFile } from 'node:fs/promises';
import { config } from './config.js';
pg.types.setTypeParser(1082, (value) => value); // DATE values must stay calendar dates, never local JS timestamps.
export const pool = new pg.Pool({
  connectionString: config.databaseUrl,
  max: 10,
  options: process.env.DB_SCHEMA ? `-c search_path=${process.env.DB_SCHEMA}` : undefined,
});
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
  await pool.query(await readFile(new URL('./schema.sql', import.meta.url), 'utf8'));
}
