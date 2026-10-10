import app from './app.js';
import { config } from './config.js';
import { pool } from './db.js';
await pool.query('SELECT 1');
const database = new URL(config.databaseUrl);
console.log(
  `eDTR database: ${database.pathname.slice(1)} on ${database.hostname}:${database.port || '5432'}`,
);
const server = app.listen(config.port, config.host, () =>
  console.log(`eDTR API: http://localhost:${config.port}`),
);
for (const signal of ['SIGINT', 'SIGTERM'])
  process.on(signal, () =>
    server.close(async () => {
      await pool.end();
      process.exit(0);
    }),
  );
