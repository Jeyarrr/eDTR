import { ensureLocalPostgres } from './local-postgres.mjs';
ensureLocalPostgres();
const { migrate, pool } = await import('../server/db.js');
await migrate();
await pool.end();
console.log('eDTR schema is ready.');
