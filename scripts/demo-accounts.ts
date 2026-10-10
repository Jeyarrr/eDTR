import { randomUUID } from 'node:crypto';
import bcrypt from 'bcryptjs';
import type { DB } from '../server/db.js';
import { today } from '../server/domain.js';

export const demoAccounts = [
  {
    email: 'admin@edtr.local',
    username: 'admin',
    password: 'admin',
    name: 'Jay Administrator',
    role: 'ADMIN',
    code: 'A01',
  },
  {
    email: 'hr@edtr.local',
    username: 'HRAlex',
    password: 'hralex',
    name: 'Alex HR',
    role: 'HR',
    code: 'H01',
  },
  {
    email: 'raymond@edtr.local',
    username: 'raymondsantiago',
    password: 'Raymond',
    name: 'Raymond Santiago',
    role: 'EMPLOYEE',
    code: 'M01',
  },
  {
    email: 'george@edtr.local',
    username: 'georgeanthony',
    password: 'George',
    name: 'George Gonzaga',
    role: 'EMPLOYEE',
    code: 'M02',
  },
  {
    email: 'syren@edtr.local',
    username: 'syrentortal',
    password: 'Syren',
    name: 'Syren Tortal',
    role: 'EMPLOYEE',
    code: 'M03',
  },
];

// Add missing demo accounts without resetting existing passwords or attendance.
export async function ensureDemoAccounts(db: DB) {
  if (process.env.NODE_ENV === 'production') throw new Error('Demo accounts are development-only.');
  await db.query('SELECT pg_advisory_xact_lock(418943)');
  let created = 0;
  for (const account of demoAccounts) {
    const existing = (
      await db.query('SELECT id,username FROM users WHERE lower(email)=lower($1)', [account.email])
    ).rows[0];
    if (existing) {
      if (!existing.username)
        await db.query('UPDATE users SET username=$2 WHERE id=$1', [existing.id, account.username]);
      continue;
    }
    let schedule = (
      await db.query("SELECT id FROM schedules WHERE name='Demo regular shift' LIMIT 1")
    ).rows[0]?.id;
    if (!schedule) {
      schedule = randomUUID();
      await db.query(
        "INSERT INTO schedules(id,name,start_time,end_time,work_days) VALUES($1,'Demo regular shift','08:00','17:00','{1,2,3,4,5}')",
        [schedule],
      );
    }
    const id = randomUUID();
    await db.query(
      `INSERT INTO users(id,employee_id,name,email,username,password_hash,role,department,position,schedule_id,employment_from)
      VALUES($1,$2,$3,$4,$5,$6,$7,'Demo workspace','Demo account',$8,$9)`,
      [
        id,
        account.code,
        account.name,
        account.email,
        account.username,
        await bcrypt.hash(account.password, 12),
        account.role,
        schedule,
        today(),
      ],
    );
    await db.query(
      'INSERT INTO schedule_assignments(id,user_id,schedule_id,effective_from) VALUES($1,$2,$3,$4)',
      [randomUUID(), id, schedule, today()],
    );
    await db.query('INSERT INTO employment_periods(user_id,start_date) VALUES($1,$2)', [
      id,
      today(),
    ]);
    created++;
  }
  return created;
}
