import { randomUUID } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { pool, migrate, transaction } from '../server/db.js';
import { audit } from '../server/service.js';
const input = z
  .object({
    email: z.email(),
    name: z.string().min(2),
    password: z.string().min(12).max(128).regex(/[a-z]/).regex(/[A-Z]/).regex(/[0-9]/),
  })
  .parse({
    email: process.env.ADMIN_EMAIL,
    name: process.env.ADMIN_NAME,
    password: process.env.ADMIN_PASSWORD,
  });
await migrate();
await transaction(async (db) => {
  await db.query('LOCK TABLE users IN EXCLUSIVE MODE');
  if ((await db.query("SELECT 1 FROM users WHERE role='ADMIN'")).rowCount)
    throw new Error(
      'An administrator already exists. Create additional accounts through User Management.',
    );
  const id = randomUUID();
  await db.query(
    "INSERT INTO users(id,employee_id,name,email,password_hash,role,department,position) VALUES($1,'A01',$2,$3,$4,'ADMIN','Administration','Administrator')",
    [id, input.name, input.email.toLowerCase(), await bcrypt.hash(input.password, 12)],
  );
  await audit(db, id, 'ADMINISTRATOR_INITIALIZED', 'user', id);
});
await pool.end();
console.log('Initial administrator created.');
