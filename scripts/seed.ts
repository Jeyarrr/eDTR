import { randomUUID } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { DateTime } from 'luxon';
import { pool, migrate, transaction } from '../server/db.js';
import { ZONE, calculateAttendance } from '../server/domain.js';
import { audit, createPayroll, requestCorrection } from '../server/service.js';
import { config } from '../server/config.js';
import { ensureDemoAccounts } from './demo-accounts.js';
if (config.production)
  throw new Error('Demo seeding is available only in development. Use admin:create in production.');
await migrate();
if ((await pool.query('SELECT 1 FROM users LIMIT 1')).rowCount) {
  const created = await transaction(ensureDemoAccounts);
  console.log(
    `Demo accounts ready (${created} added). Existing passwords and attendance were preserved.`,
  );
  await pool.end();
  process.exit(0);
}
const admin = randomUUID(),
  hr = randomUUID(),
  ids = [randomUUID(), randomUUID(), randomUUID()];
const schedule = {
  id: randomUUID(),
  name: 'Regular day shift',
  start_time: '08:00',
  end_time: '17:00',
  grace_minutes: 5,
  break_minutes: 60,
  break_after_minutes: 360,
  work_days: [1, 2, 3, 4, 5],
};
const overnight = {
  ...schedule,
  id: randomUUID(),
  name: 'Overnight support',
  start_time: '22:00',
  end_time: '07:00',
};
const day = DateTime.now().setZone(ZONE).startOf('day'),
  employment = day.minus({ months: 2 }).startOf('month').toISODate()!;
await transaction(async (db) => {
  for (const s of [schedule, overnight])
    await db.query(
      'INSERT INTO schedules(id,name,start_time,end_time,grace_minutes,break_minutes,break_after_minutes,work_days) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',
      [
        s.id,
        s.name,
        s.start_time,
        s.end_time,
        s.grace_minutes,
        s.break_minutes,
        s.break_after_minutes,
        s.work_days,
      ],
    );
  const users = [
    {
      id: admin,
      employee_id: 'A01',
      name: 'Jay Administrator',
      email: 'admin@edtr.local',
      role: 'ADMIN',
      department: 'Administration',
      position: 'System Administrator',
      password: 'admin',
      rate: 15000,
    },
    {
      id: hr,
      employee_id: 'H01',
      name: 'Alex HR',
      email: 'hr@edtr.local',
      role: 'HR',
      department: 'Human Resources',
      position: 'HR Officer',
      password: 'hralex',
      rate: 12500,
    },
    ...['Raymond Santiago', 'George Gonzaga', 'Syren Tortal'].map((name, i) => ({
      id: ids[i],
      employee_id: `M0${i + 1}`,
      name,
      email: `${['raymond', 'george', 'syren'][i]}@edtr.local`,
      role: 'EMPLOYEE',
      department: i === 2 ? 'Operations' : 'IT Support',
      position: i === 2 ? 'Operations Specialist' : 'IT Support Specialist',
      password: ['Raymond', 'George', 'Syren'][i],
      rate: [12500, 11500, 10000][i],
    })),
  ];
  for (const u of users) {
    await db.query(
      `INSERT INTO users(id,employee_id,name,email,password_hash,role,department,position,schedule_id,hourly_rate_cents,employment_from) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [
        u.id,
        u.employee_id,
        u.name,
        u.email,
        await bcrypt.hash(u.password, 12),
        u.role,
        u.department,
        u.position,
        schedule.id,
        u.rate,
        employment,
      ],
    );
    await db.query('UPDATE users SET username=$2 WHERE id=$1', [
      u.id,
      (
        {
          'admin@edtr.local': 'admin',
          'hr@edtr.local': 'HRAlex',
          'raymond@edtr.local': 'raymondsantiago',
          'george@edtr.local': 'georgeanthony',
          'syren@edtr.local': 'syrentortal',
        } as Record<string, string>
      )[u.email],
    ]);
    await db.query(
      'INSERT INTO schedule_assignments(id,user_id,schedule_id,effective_from) VALUES($1,$2,$3,$4)',
      [randomUUID(), u.id, schedule.id, employment],
    );
  }
  const start = day.minus({ months: 1 }).startOf('month');
  for (let d = start; d < day; d = d.plus({ days: 1 })) {
    if (d.weekday > 5) continue;
    for (let i = 0; i < ids.length; i++) {
      if ((d.day + i) % 13 === 0) continue;
      const date = d.toISODate()!,
        late = i === 2 && d.day % 3 === 0 ? 18 : 0;
      const clockIn = d.set({ hour: 8, minute: late }).toUTC().toISO()!,
        clockOut = d
          .set({ hour: d.day % 7 === 0 ? 18 : 17, minute: 0 })
          .toUTC()
          .toISO()!;
      const stats = calculateAttendance(date, schedule, clockIn, clockOut),
        id = randomUUID();
      await db.query(
        `INSERT INTO attendance(id,user_id,work_date,clock_in,clock_out,schedule_snapshot,worked_minutes,late_minutes,overtime_minutes,approved_overtime_minutes,verified,verified_by,verified_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$9,true,$10,now())`,
        [
          id,
          ids[i],
          date,
          clockIn,
          clockOut,
          JSON.stringify(schedule),
          stats.worked_minutes,
          stats.late_minutes,
          stats.overtime_minutes,
          admin,
        ],
      );
    }
  }
  if (day.weekday <= 5) {
    const recentEnd = day.set({ hour: 17, minute: 5 });
    if (DateTime.now().setZone(ZONE) > recentEnd) {
      const clockIn = day.set({ hour: 9, minute: 12 }).toUTC().toISO()!,
        clockOut = recentEnd.toUTC().toISO()!,
        stats = calculateAttendance(day.toISODate()!, schedule, clockIn, clockOut);
      await db.query(
        `INSERT INTO attendance(id,user_id,work_date,clock_in,clock_out,schedule_snapshot,worked_minutes,late_minutes,overtime_minutes) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [
          randomUUID(),
          ids[2],
          day.toISODate(),
          clockIn,
          clockOut,
          JSON.stringify(schedule),
          stats.worked_minutes,
          stats.late_minutes,
          stats.overtime_minutes,
        ],
      );
    }
    await db.query(
      "INSERT INTO leaves(id,user_id,start_date,end_date,reason,status,reviewer_id,review_note) VALUES($1,$2,$3,$3,'Medical appointment approved by HR','APPROVED',$4,'Approved for the medical appointment.')",
      [randomUUID(), ids[1], day.toISODate(), hr],
    );
  }
  const requestDate =
    day.minus({ days: 1 }).weekday <= 5 ? day.minus({ days: 1 }) : day.minus({ days: 3 });
  const old = (
    await db.query('SELECT * FROM attendance WHERE user_id=$1 AND work_date=$2', [
      ids[1],
      requestDate.toISODate(),
    ])
  ).rows[0];
  if (old)
    await requestCorrection(
      db,
      { id: ids[1], role: 'EMPLOYEE' },
      {
        work_date: requestDate.toISODate(),
        requested_in: requestDate.set({ hour: 8, minute: 0 }).toUTC().toISO(),
        requested_out: requestDate.set({ hour: 17, minute: 15 }).toUTC().toISO(),
        reason: 'My recorded clock-out missed fifteen minutes of completed support work.',
      },
    );
  const from = start.toISODate()!,
    to = start.endOf('month').toISODate()!;
  const approvedId = await createPayroll(
    db,
    { id: admin },
    { user_id: ids[0], start_date: from, end_date: to },
  );
  await db.query(
    "UPDATE payroll SET status='APPROVED',approved_by=$2,approved_at=now() WHERE id=$1",
    [approvedId, admin],
  );
  await createPayroll(db, { id: admin }, { user_id: ids[2], start_date: from, end_date: to });
  await audit(db, admin, 'DEMO_DATA_INITIALIZED', 'system', 'seed', {
    description: 'Fictional demonstration employees, verified historical attendance, and payroll.',
  });
});
await pool.end();
console.log('Demo data created. Login details are listed in README.md.');
