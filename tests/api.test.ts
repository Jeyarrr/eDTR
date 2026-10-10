import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { DateTime } from 'luxon';
import bcrypt from 'bcryptjs';
import pg from 'pg';
import sharp from 'sharp';
import { ensureDemoAccounts, demoAccounts } from '../scripts/demo-accounts.js';
const proof =
  'data:image/png;base64,' +
  (
    await sharp({ create: { width: 8, height: 8, channels: 3, background: '#aaa' } })
      .png()
      .toBuffer()
  ).toString('base64');
import request from 'supertest';
import { readdir, readFile, unlink, rmdir } from 'node:fs/promises';
import { resolve, join } from 'node:path';
const schema = 'test_' + randomUUID().replaceAll('-', '');
process.env.DB_SCHEMA = schema;
const outbox = resolve('.local', schema + '-outbox');
process.env.MAIL_OUTBOX = outbox;
process.env.SMTP_HOST = '';
const { config } = await import('../server/config.js');
const root = new pg.Pool({ connectionString: config.databaseUrl });
const { pool, migrate, transaction } = await import('../server/db.js');
const { default: app } = await import('../server/app.js');
const { clock, dailyRecords, requestCorrection, reviewCorrection, createPayroll } =
  await import('../server/service.js');
const { today, ZONE } = await import('../server/domain.js');
const manager = randomUUID(),
  employee = randomUUID(),
  other = randomUUID(),
  scheduleId = randomUUID();
const schedule = {
  id: scheduleId,
  name: 'Test day',
  start_time: '08:00',
  end_time: '17:00',
  grace_minutes: 5,
  break_minutes: 60,
  break_after_minutes: 360,
  work_days: [1, 2, 3, 4, 5, 6, 7],
};
let adminAgent: any, employeeAgent: any, adminCsrf: string, employeeCsrf: string;
before(async () => {
  await root.query(`CREATE SCHEMA ${schema}`);
  await migrate();
  await pool.query(
    'INSERT INTO schedules(id,name,start_time,end_time,grace_minutes,break_minutes,break_after_minutes,work_days) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',
    [
      scheduleId,
      schedule.name,
      schedule.start_time,
      schedule.end_time,
      5,
      60,
      360,
      schedule.work_days,
    ],
  );
  for (const [id, email, role, code] of [
    [manager, 'admin@test.local', 'ADMIN', 'A99'],
    [employee, 'employee@test.local', 'EMPLOYEE', 'M99'],
    [other, 'other@test.local', 'EMPLOYEE', 'M98'],
  ]) {
    await pool.query(
      `INSERT INTO users(id,employee_id,name,email,password_hash,role,department,position,schedule_id,employment_from) VALUES($1,$2,'Test Person',$3,$4,$5,'IT','Support',$6,'2026-01-01')`,
      [id, code, email, await bcrypt.hash('Testing@123456', 4), role, scheduleId],
    );
    await pool.query(
      "INSERT INTO schedule_assignments(id,user_id,schedule_id,effective_from) VALUES($1,$2,$3,'2026-01-01')",
      [randomUUID(), id, scheduleId],
    );
  }
  adminAgent = request.agent(app);
  employeeAgent = request.agent(app);
  adminCsrf = (
    await adminAgent
      .post('/api/auth/login')
      .send({ email: 'admin@test.local', password: 'Testing@123456' })
      .expect(200)
  ).body.csrf_token;
  employeeCsrf = (
    await employeeAgent
      .post('/api/auth/login')
      .send({ email: 'employee@test.local', password: 'Testing@123456' })
      .expect(200)
  ).body.csrf_token;
});
after(async () => {
  await pool.end();
  await root.query(`DROP SCHEMA ${schema} CASCADE`);
  await root.end();
  const files = await readdir(outbox).catch(() => []);
  for (const file of files) await unlink(join(outbox, file));
  if (files.length) await rmdir(outbox);
});
test('logout clears stale sessions and succeeds when already signed out', async () => {
  const result = await request(app)
    .post('/api/auth/logout')
    .set('Cookie', 'edtr_session=expired')
    .expect(200);
  assert.match(result.headers['set-cookie'][0], /edtr_session=;/);
});

test('overnight clocking retains the scheduled start date in PostgreSQL', async () => {
  const id = randomUUID(),
    sid = randomUUID(),
    s = { ...schedule, id: sid, start_time: '22:00', end_time: '07:00' };
  await pool.query(
    'INSERT INTO schedules(id,name,start_time,end_time,grace_minutes,break_minutes,break_after_minutes,work_days) VALUES($1,$2,$3,$4,5,60,360,$5)',
    [sid, 'Overnight', '22:00', '07:00', s.work_days],
  );
  await pool.query(
    "INSERT INTO users(id,employee_id,name,email,password_hash,role,department,position,schedule_id,employment_from) VALUES($1,'N99','Night Worker','night@test.local','unused','EMPLOYEE','IT','Support',$2,'2026-01-01')",
    [id, sid],
  );
  await pool.query(
    "INSERT INTO schedule_assignments(id,user_id,schedule_id,effective_from) VALUES($1,$2,$3,'2026-01-01')",
    [randomUUID(), id, sid],
  );
  const day = DateTime.now().setZone(ZONE).minus({ days: 8 }).startOf('day');
  const row = await transaction((db) => clock(db, id, 'in', day.set({ hour: 22 }).toJSDate()));
  assert.equal(row.work_date, day.toISODate());
  const closed = await transaction((db) =>
    clock(db, id, 'out', day.plus({ days: 1 }).set({ hour: 7 }).toJSDate()),
  );
  assert.equal(closed.work_date, day.toISODate());
  assert.equal(closed.worked_minutes, 480);
});
test('role authorization, CSRF, and record scoping', async () => {
  await request(app).get('/api/attendance').expect(401);
  await employeeAgent.get('/api/employees').expect(403);
  await employeeAgent.get('/api/audit').expect(403);
  await employeeAgent.post('/api/attendance/clock-in').send({}).expect(403);
  const result = await employeeAgent
    .get(`/api/attendance?from=${today()}&to=${today()}&user_id=${other}`)
    .expect(200);
  assert.ok(result.body.records.every((r: any) => r.user_id === employee));
  await employeeAgent
    .post('/api/payroll/calculate')
    .set('X-CSRF-Token', employeeCsrf)
    .send({})
    .expect(403);
});
test('normal clocking and duplicate race are enforced by database transaction', async () => {
  const date = DateTime.now().setZone(ZONE).minus({ days: 2 }).toISODate()!,
    inTime = new Date(`${date}T08:00:00+08:00`),
    outTime = new Date(`${date}T17:00:00+08:00`);
  const results = await Promise.allSettled([
    transaction((db) => clock(db, employee, 'in', inTime)),
    transaction((db) => clock(db, employee, 'in', inTime)),
  ]);
  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
  const result = await transaction((db) => clock(db, employee, 'out', outTime));
  assert.equal(result.worked_minutes, 480);
  await assert.rejects(() => transaction((db) => clock(db, employee, 'out', outTime)));
});
test('server timestamp ignores a forged device timestamp', async () => {
  const before = Date.now();
  const result = await employeeAgent
    .post('/api/attendance/clock-in')
    .set('X-CSRF-Token', employeeCsrf)
    .send({ proof, timestamp: '2000-01-01T00:00:00Z' })
    .expect(201);
  assert.ok(new Date(result.body.clock_in).getTime() >= before - 1000);
  const dash = await employeeAgent.get('/api/dashboard').expect(200);
  assert.equal(dash.body.own.id, result.body.id);
  assert.equal(dash.body.own.clock_out, null);
  await employeeAgent
    .get('/api/attendance/' + result.body.id + '/proof')
    .expect(200)
    .expect('Content-Type', /image\/jpeg/);
  await adminAgent.get('/api/attendance/' + result.body.id + '/proof').expect(200);
  const stranger = request.agent(app);
  await stranger
    .post('/api/auth/login')
    .send({ email: 'other@test.local', password: 'Testing@123456' })
    .expect(200);
  await stranger.get('/api/attendance/' + result.body.id + '/proof').expect(404);
  await employeeAgent
    .post('/api/attendance/clock-in')
    .set('X-CSRF-Token', employeeCsrf)
    .send({ proof })
    .expect(409);
  await employeeAgent
    .post('/api/attendance/clock-out')
    .set('X-CSRF-Token', employeeCsrf)
    .send({})
    .expect(200);
});
test('leave and scheduled absence are derived from real records', async () => {
  const date = DateTime.now().setZone(ZONE).minus({ days: 3 }).toISODate()!;
  await pool.query(
    "INSERT INTO leaves(id,user_id,start_date,end_date,reason,status) VALUES($1,$2,$3,$3,'Approved test leave','APPROVED')",
    [randomUUID(), other, date],
  );
  const records = await dailyRecords(pool, date, date);
  assert.equal(records.find((r) => r.user_id === other).status, 'ON_LEAVE');
  assert.equal(records.find((r) => r.user_id === employee).status, 'ABSENT');
  await assert.rejects(
    () => transaction((db) => clock(db, other, 'in', new Date(`${date}T08:00:00+08:00`))),
    /approved leave/,
  );
});
test('missed clock-out is incomplete and overdue clock-out is blocked', async () => {
  const date = DateTime.now().setZone(ZONE).minus({ days: 5 }).toISODate()!;
  await transaction((db) => clock(db, other, 'in', new Date(`${date}T08:00:00+08:00`)));
  const records = await dailyRecords(pool, date, date, other);
  assert.equal(records[0].status, 'INCOMPLETE');
  await assert.rejects(() => transaction((db) => clock(db, other, 'out', new Date())), /36 hours/);
});
test('correction approval preserves original values and fixes incomplete attendance', async () => {
  const date = DateTime.now().setZone(ZONE).minus({ days: 5 }).toISODate()!;
  const r = await transaction((db) =>
    requestCorrection(
      db,
      { id: other, role: 'EMPLOYEE' },
      {
        work_date: date,
        requested_in: `${date}T08:12:00+08:00`,
        requested_out: `${date}T17:00:00+08:00`,
        reason: 'Forgot to clock out after the scheduled shift.',
      },
    ),
  );
  assert.equal(r.original.clock_out, null);
  await transaction((db) =>
    reviewCorrection(
      db,
      { id: manager, role: 'ADMIN' },
      r.id,
      'APPROVED',
      'Confirmed against the manager’s work record.',
    ),
  );
  const record = (
    await pool.query('SELECT * FROM attendance WHERE user_id=$1 AND work_date=$2', [other, date])
  ).rows[0];
  assert.equal(record.worked_minutes, 468);
  assert.equal(record.late_minutes, 12);
  assert.equal(record.verified, true);
  const log = (
    await pool.query(
      "SELECT * FROM audit_logs WHERE entity_id=$1 AND action='CORRECTION_APPROVED'",
      [r.id],
    )
  ).rows[0];
  assert.equal(log.details.original.clock_out, null);
});
test('rejection changes no attendance and self-approval is rejected', async () => {
  const date = DateTime.now().setZone(ZONE).minus({ days: 4 }).toISODate()!;
  const r = await transaction((db) =>
    requestCorrection(
      db,
      { id: employee, role: 'EMPLOYEE' },
      {
        work_date: date,
        requested_in: `${date}T08:00:00+08:00`,
        requested_out: `${date}T17:00:00+08:00`,
        reason: 'I need a correction for a missed recording.',
      },
    ),
  );
  await assert.rejects(
    () =>
      transaction((db) =>
        reviewCorrection(
          db,
          { id: employee, role: 'ADMIN' },
          r.id,
          'APPROVED',
          'I approve my own times here.',
        ),
      ),
    /Another/,
  );
  await transaction((db) =>
    reviewCorrection(
      db,
      { id: manager, role: 'ADMIN' },
      r.id,
      'REJECTED',
      'The times could not be confirmed by the supervisor.',
    ),
  );
  assert.equal(
    (
      await pool.query('SELECT 1 FROM attendance WHERE user_id=$1 AND work_date=$2', [
        employee,
        date,
      ])
    ).rowCount,
    0,
  );
});
test('payroll blocks unverified time, recalculates after a correction, and freezes approval', async () => {
  const date = DateTime.now().setZone(ZONE).minus({ days: 2 }).toISODate()!;
  await assert.rejects(
    () =>
      transaction((db) =>
        createPayroll(db, { id: manager }, { user_id: employee, start_date: date, end_date: date }),
      ),
    /verify/,
  );
  await pool.query('UPDATE attendance SET verified=true WHERE user_id=$1 AND work_date=$2', [
    employee,
    date,
  ]);
  const id = await transaction((db) =>
    createPayroll(db, { id: manager }, { user_id: employee, start_date: date, end_date: date }),
  );
  const correction = await transaction((db) =>
    requestCorrection(
      db,
      { id: employee, role: 'EMPLOYEE' },
      {
        work_date: date,
        requested_in: `${date}T08:30:00+08:00`,
        requested_out: `${date}T17:00:00+08:00`,
        reason: 'My original clock-in should be thirty minutes later.',
      },
    ),
  );
  await transaction((db) =>
    reviewCorrection(
      db,
      { id: manager },
      correction.id,
      'APPROVED',
      'Confirmed the actual arrival time with the manager.',
    ),
  );
  await adminAgent
    .post(`/api/payroll/${id}/status`)
    .set('X-CSRF-Token', adminCsrf)
    .send({ status: 'FOR_REVIEW' })
    .expect(409);
  await transaction((db) =>
    createPayroll(db, { id: manager }, { user_id: employee, start_date: date, end_date: date }),
  );
  const row = (await pool.query('SELECT * FROM payroll WHERE id=$1', [id])).rows[0];
  assert.equal(row.calculation.base_cents, 75000);
  await adminAgent
    .post(`/api/payroll/${id}/status`)
    .set('X-CSRF-Token', adminCsrf)
    .send({ status: 'FOR_REVIEW' })
    .expect(200);
  await adminAgent
    .post(`/api/payroll/${id}/status`)
    .set('X-CSRF-Token', adminCsrf)
    .send({ status: 'APPROVED' })
    .expect(200);
  await adminAgent
    .post('/api/payroll/calculate')
    .set('X-CSRF-Token', adminCsrf)
    .send({ user_id: employee, start_date: date, end_date: date })
    .expect(409);
  const slip = await employeeAgent.get(`/api/payroll/${id}/payslip`).expect(200);
  assert.match(slip.headers['content-type'], /pdf/);
  const otherLogin = request.agent(app);
  await otherLogin
    .post('/api/auth/login')
    .send({ email: 'other@test.local', password: 'Testing@123456' })
    .expect(200);
  await otherLogin.get(`/api/payroll/${id}/payslip`).expect(403);
});
test('DTR exports use authorized records and generate real PDF and Excel files', async () => {
  const from = DateTime.now().setZone(ZONE).minus({ days: 6 }).toISODate()!,
    to = today();
  const pdf = await employeeAgent.get(`/api/reports/dtr/pdf?from=${from}&to=${to}`).expect(200);
  assert.match(pdf.headers['content-type'], /pdf/);
  const excel = await adminAgent.get(`/api/reports/dtr/xlsx?from=${from}&to=${to}`).expect(200);
  assert.match(excel.headers['content-type'], /spreadsheet/);
});
test('approved payroll remains frozen while an adjustment is recalculated and approved', async () => {
  const date = DateTime.now().setZone(ZONE).minus({ days: 2 }).toISODate()!;
  const original = (
    await pool.query(
      "SELECT * FROM payroll WHERE user_id=$1 AND status='APPROVED' AND adjustment_of IS NULL",
      [employee],
    )
  ).rows[0];
  const correction = await transaction((db) =>
    requestCorrection(
      db,
      { id: employee, role: 'EMPLOYEE' },
      {
        work_date: date,
        requested_in: `${date}T08:45:00+08:00`,
        requested_out: `${date}T17:00:00+08:00`,
        reason: 'Confirmed arrival time was forty-five minutes after the scheduled start.',
      },
    ),
  );
  await transaction((db) =>
    reviewCorrection(
      db,
      { id: manager },
      correction.id,
      'APPROVED',
      'Verified the time using the supervisor’s attendance record.',
    ),
  );
  const result = await adminAgent
    .post(`/api/payroll/${original.id}/adjust`)
    .set('X-CSRF-Token', adminCsrf)
    .send({ reason: 'Adjust the verified arrival time after the approved attendance correction.' })
    .expect(201);
  let adjustment = (await pool.query('SELECT * FROM payroll WHERE id=$1', [result.body.id]))
    .rows[0];
  assert.equal(adjustment.calculation.net_cents, -2500);
  await adminAgent
    .put('/api/payroll/policy')
    .set('X-CSRF-Token', adminCsrf)
    .send({
      overtime_multiplier: 1.25,
      contribution_cents: 0,
      other_deduction_cents: 0,
      other_earnings_cents: 1000,
    })
    .expect(200);
  await adminAgent
    .post(`/api/payroll/${adjustment.id}/status`)
    .set('X-CSRF-Token', adminCsrf)
    .send({ status: 'FOR_REVIEW' })
    .expect(409);
  await adminAgent
    .post(`/api/payroll/${adjustment.id}/recalculate-adjustment`)
    .set('X-CSRF-Token', adminCsrf)
    .send({})
    .expect(200);
  adjustment = (await pool.query('SELECT * FROM payroll WHERE id=$1', [adjustment.id])).rows[0];
  assert.equal(adjustment.calculation.net_cents, -1500);
  for (const status of ['FOR_REVIEW', 'APPROVED', 'PAID'])
    await adminAgent
      .post(`/api/payroll/${adjustment.id}/status`)
      .set('X-CSRF-Token', adminCsrf)
      .send({ status })
      .expect(200);
  const frozen = (await pool.query('SELECT * FROM payroll WHERE id=$1', [original.id])).rows[0];
  assert.deepEqual(frozen.calculation, original.calculation);
});
test('employee invitations and account recovery use single-use tokens and revoke old sessions', async () => {
  const input = {
    employee_id: 'I99',
    name: 'Invited Employee',
    email: 'invited@test.local',
    role: 'EMPLOYEE',
    department: 'IT',
    position: 'Support',
    schedule_id: scheduleId,
    hourly_rate_cents: 10000,
  };
  const created = await adminAgent
    .post('/api/employees')
    .set('X-CSRF-Token', adminCsrf)
    .send(input)
    .expect(201);
  const token = new URL(created.body.invitation_link).searchParams.get('token');
  await request(app)
    .post('/api/auth/reset-password')
    .send({ token, password: 'Invited@123456' })
    .expect(200);
  await request(app)
    .post('/api/auth/reset-password')
    .send({ token, password: 'OtherPass@123456' })
    .expect(422);
  const invited = request.agent(app);
  await invited
    .post('/api/auth/login')
    .send({ email: input.email, password: 'Invited@123456' })
    .expect(200);
  await request(app).post('/api/auth/forgot-password').send({ email: input.email }).expect(200);
  const files = await readdir(outbox);
  let link = '';
  for (const name of files) {
    const mail = JSON.parse(await readFile(join(outbox, name), 'utf8'));
    if (mail.to === input.email && mail.kind === 'RESET') link = mail.link;
  }
  assert.ok(link);
  const resetToken = new URL(link).searchParams.get('token');
  await request(app)
    .post('/api/auth/reset-password')
    .send({ token: resetToken, password: 'Recovered@123456' })
    .expect(200);
  await invited.get('/api/auth/me').expect(401);
  await invited
    .post('/api/auth/login')
    .send({ email: input.email, password: 'Recovered@123456' })
    .expect(200);
  await adminAgent
    .post(`/api/employees/${created.body.id}/status`)
    .set('X-CSRF-Token', adminCsrf)
    .send({ active: false })
    .expect(200);
  await invited.get('/api/auth/me').expect(401);
  assert.equal(
    (await pool.query('SELECT active FROM users WHERE id=$1', [created.body.id])).rows[0].active,
    false,
  );
});
test('reactivation preserves inactive gaps in historical attendance', async () => {
  const id = randomUUID();
  await pool.query(
    "INSERT INTO users(id,employee_id,name,email,password_hash,role,department,position,schedule_id,active,employment_from,employment_to) VALUES($1,'G99','Gap Employee','gap@test.local','unused','EMPLOYEE','IT','Support',$2,false,'2026-01-01','2026-01-31')",
    [id, scheduleId],
  );
  await pool.query(
    "INSERT INTO schedule_assignments(id,user_id,schedule_id,effective_from) VALUES($1,$2,$3,'2026-01-01')",
    [randomUUID(), id, scheduleId],
  );
  await pool.query(
    "INSERT INTO employment_periods(user_id,start_date,end_date) VALUES($1,'2026-01-01','2026-01-31')",
    [id],
  );
  await adminAgent
    .post(`/api/employees/${id}/status`)
    .set('X-CSRF-Token', adminCsrf)
    .send({ active: true })
    .expect(200);
  assert.equal((await dailyRecords(pool, '2026-02-02', '2026-02-02', id)).length, 0);
  assert.equal((await dailyRecords(pool, today(), today(), id)).length, 1);
});

test('clock-in rejects missing and malformed photos', async () => {
  await employeeAgent
    .post('/api/attendance/clock-in')
    .set('X-CSRF-Token', employeeCsrf)
    .send({})
    .expect(422);
  await employeeAgent
    .post('/api/attendance/clock-in')
    .set('X-CSRF-Token', employeeCsrf)
    .send({ proof: 'data:image/png;base64,YmFk' })
    .expect(422);
});

test('sample accounts can be added to an existing database and reseeded without resetting data', async () => {
  const attendanceBefore = (await pool.query('SELECT count(*) FROM attendance')).rows[0].count;
  assert.equal(await transaction(ensureDemoAccounts), 5);
  for (const account of demoAccounts) {
    const row = (await pool.query('SELECT * FROM users WHERE username=$1', [account.username]))
      .rows[0];
    assert.equal(row.role, account.role);
    assert.equal(await bcrypt.compare(account.password, row.password_hash), true);
  }
  const changed = await bcrypt.hash('Changed@123456', 4);
  await pool.query("UPDATE users SET password_hash=$1 WHERE username='HRAlex'", [changed]);
  assert.equal(await transaction(ensureDemoAccounts), 0);
  assert.equal(
    (await pool.query("SELECT password_hash FROM users WHERE username='HRAlex'")).rows[0]
      .password_hash,
    changed,
  );
  assert.equal(
    (await pool.query('SELECT count(*) FROM attendance')).rows[0].count,
    attendanceBefore,
  );
});
