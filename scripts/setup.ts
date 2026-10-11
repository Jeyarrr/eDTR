import { ensureLocalPostgres } from './local-postgres.mjs';
if (process.env.DIRECT_DATABASE_URL) process.env.DATABASE_URL = process.env.DIRECT_DATABASE_URL;
ensureLocalPostgres();
const { migrate, pool } = await import('../server/db.js');
await migrate();
await pool.end();
console.log('eDTR schema is ready.');
