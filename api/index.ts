import { attachDatabasePool } from '@vercel/functions';
import app from '../server/app.js';
import { pool } from '../server/db.js';

attachDatabasePool(pool);
export default app;
