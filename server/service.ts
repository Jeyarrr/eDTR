import { randomUUID, createHash } from 'node:crypto';
import { DateTime } from 'luxon';
import { type DB } from './db.js';
import {
  AppError,
  ZONE,
  today,
  attendanceDate,
  shiftBounds,
  calculateAttendance,
  calculatePayroll,
  type Schedule,
} from './domain.js';
export const hash = (value: string) => createHash('sha256').update(value).digest('hex');
export async function audit(
  db: DB,
  actor: string | null,
  action: string,
  type: string,
  id: string,
  details: any = {},
) {
  await db.query(
    'INSERT INTO audit_logs(actor_id,action,entity_type,entity_id,details) VALUES($1,$2,$3,$4,$5)',
    [actor, action, type, id, JSON.stringify(details)],
  );
}
export async function payrollLock(db: DB) {
  await db.query('SELECT pg_advisory_xact_lock(418942)');
}
export async function scheduleFor(db: DB, userId: string, date: string): Promise<Schedule> {
  const { rows } = await db.query(
    `SELECT s.* FROM schedule_assignments a JOIN schedules s ON s.id=a.schedule_id
    WHERE a.user_id=$1 AND a.effective_from <= $2 AND (a.effective_to IS NULL OR a.effective_to >= $2)
    ORDER BY a.effective_from DESC LIMIT 1`,
    [userId, date],
  );
  if (rows[0]) return rows[0];
  const fallback = await db.query(
    'SELECT s.* FROM users u JOIN schedules s ON s.id=u.schedule_id WHERE u.id=$1',
    [userId],
  );
  if (!fallback.rows[0])
    throw new AppError(422, 'Assign a work schedule before recording attendance.');
  return fallback.rows[0];
}
export async function clock(db: DB, userId: string, action: 'in' | 'out', now?: Date) {
  // Lock the employee, so parallel requests cannot create two clock-ins or update a clock-out twice.
  const user = (await db.query('SELECT * FROM users WHERE id=$1 FOR UPDATE', [userId])).rows[0];
  if (!user?.active) throw new AppError(403, 'Your employee account is inactive.');
  const timestamp = now || (await db.query('SELECT clock_timestamp() AS now')).rows[0].now;
  const open = (
    await db.query('SELECT * FROM attendance WHERE user_id=$1 AND clock_out IS NULL FOR UPDATE', [
      userId,
    ])
  ).rows[0];
  if (action === 'in') {
    if (open)
      throw new AppError(
        409,
        'You already have an open shift. Clock out or request a correction for the missed clock-out.',
      );
    const currentSchedule = await scheduleFor(db, userId, today(timestamp));
    const date = attendanceDate(timestamp, currentSchedule);
    const schedule = await scheduleFor(db, userId, date);
    const weekday = DateTime.fromISO(date, { zone: ZONE }).weekday;
    if (
      !schedule.work_days.includes(weekday) ||
      (await db.query('SELECT 1 FROM holidays WHERE date=$1', [date])).rowCount
    )
      throw new AppError(
        422,
        'Today is a rest day or configured holiday. Ask HR to assign an appropriate work schedule.',
      );
    if (
      (
        await db.query(
          "SELECT 1 FROM leaves WHERE user_id=$1 AND status='APPROVED' AND $2 BETWEEN start_date AND end_date",
          [userId, date],
        )
      ).rowCount
    )
      throw new AppError(409, 'You are on approved leave for this attendance date.');
    if (
      (await db.query('SELECT 1 FROM attendance WHERE user_id=$1 AND work_date=$2', [userId, date]))
        .rowCount
    )
      throw new AppError(
        409,
        'Attendance is already recorded for this date. Submit a correction if it needs adjustment.',
      );
    const stats = calculateAttendance(date, schedule, timestamp);
    const id = randomUUID();
    const row = (
      await db.query(
        `INSERT INTO attendance(id,user_id,work_date,clock_in,schedule_snapshot,late_minutes)
      VALUES($1,$2,$3,$4,$5,$6) RETURNING *`,
        [id, userId, date, timestamp, JSON.stringify(schedule), stats.late_minutes],
      )
    ).rows[0];
    await audit(db, userId, 'CLOCK_IN', 'attendance', id, { server_timestamp: timestamp });
    return row;
  }
  if (!open) throw new AppError(409, 'Clock in before clocking out.');
  const stats = calculateAttendance(
    open.work_date,
    open.schedule_snapshot,
    open.clock_in,
    timestamp,
  );
  const row = (
    await db.query(
      `UPDATE attendance SET clock_out=$2,worked_minutes=$3,late_minutes=$4,overtime_minutes=$5,version=version+1
    WHERE id=$1 RETURNING *`,
      [open.id, timestamp, stats.worked_minutes, stats.late_minutes, stats.overtime_minutes],
    )
  ).rows[0];
  await audit(db, userId, 'CLOCK_OUT', 'attendance', row.id, {
    server_timestamp: timestamp,
    worked_minutes: stats.worked_minutes,
  });
  return row;
}
export async function dailyRecords(
  db: DB,
  from: string,
  to: string,
  scope?: string,
  now = new Date(),
) {
  const employees = (
    await db.query(
      `SELECT id,employee_id,name,department,employment_from,employment_to FROM users
    WHERE role='EMPLOYEE' OR id=$1 ORDER BY employee_id`,
      [scope || null],
    )
  ).rows.filter((u) => !scope || u.id === scope);
  const att = await db.query(
    'SELECT a.*, EXISTS(SELECT 1 FROM attendance_proofs p WHERE p.attendance_id=a.id) AS has_proof FROM attendance a WHERE work_date BETWEEN $1 AND $2 AND ($3::uuid IS NULL OR user_id=$3)',
    [from, to, scope || null],
  );
  const leaves = await db.query(
    "SELECT * FROM leaves WHERE status='APPROVED' AND start_date <= $2 AND end_date >= $1 AND ($3::uuid IS NULL OR user_id=$3)",
    [from, to, scope || null],
  );
  const holidays = await db.query('SELECT * FROM holidays WHERE date BETWEEN $1 AND $2', [
    from,
    to,
  ]);
  const assignments = await db.query(
    `SELECT a.*,row_to_json(s.*) AS schedule FROM schedule_assignments a JOIN schedules s ON a.schedule_id=s.id
      WHERE a.effective_from <= $2 AND (a.effective_to IS NULL OR a.effective_to >= $1)`,
    [from, to],
  );
  const employmentPeriods = (await db.query('SELECT * FROM employment_periods')).rows;
  const map = new Map(att.rows.map((r) => [`${r.user_id}:${r.work_date}`, r]));
  const holidayDates = new Set(holidays.rows.map((h) => h.date));
  const records: any[] = [];
  for (
    let date = DateTime.fromISO(from, { zone: ZONE });
    date.toISODate()! <= to;
    date = date.plus({ days: 1 })
  ) {
    const key = date.toISODate()!;
    for (const employee of employees) {
      const existing = map.get(`${employee.id}:${key}`);
      const periods = employmentPeriods.filter((p) => p.user_id === employee.id);
      const employed = periods.length
        ? periods.some((p) => p.start_date <= key && (!p.end_date || p.end_date >= key))
        : key >= employee.employment_from &&
          (!employee.employment_to || key <= employee.employment_to);
      if (!existing && !employed) continue;
      const assignment = assignments.rows
        .filter(
          (a) =>
            a.user_id === employee.id &&
            a.effective_from <= key &&
            (!a.effective_to || a.effective_to >= key),
        )
        .sort((a, b) => b.effective_from.localeCompare(a.effective_from))[0];
      const schedule = existing?.schedule_snapshot || assignment?.schedule;
      if (!schedule) continue;
      const scheduled = schedule.work_days.includes(date.weekday) && !holidayDates.has(key);
      const leave = leaves.rows.find(
        (l) => l.user_id === employee.id && l.start_date <= key && l.end_date >= key,
      );
      const { start, end } = shiftBounds(key, schedule);
      let status = existing
        ? existing.clock_out
          ? 'PRESENT'
          : new Date(now).getTime() > end.plus({ hours: 4 }).toMillis()
            ? 'INCOMPLETE'
            : 'CLOCKED_IN'
        : leave
          ? 'ON_LEAVE'
          : !scheduled
            ? holidayDates.has(key)
              ? 'HOLIDAY'
              : 'REST_DAY'
            : new Date(now).getTime() > end.toMillis()
              ? 'ABSENT'
              : 'NOT_CLOCKED_IN';
      records.push({
        ...existing,
        id: existing?.id || null,
        user_id: employee.id,
        employee_id: employee.employee_id,
        name: employee.name,
        department: employee.department,
        work_date: key,
        schedule_snapshot: schedule,
        scheduled,
        scheduled_in: start.toISO(),
        scheduled_out: end.toISO(),
        status,
        clock_in: existing?.clock_in || null,
        clock_out: existing?.clock_out || null,
        worked_minutes: existing?.worked_minutes || 0,
        late_minutes: existing?.late_minutes || 0,
        approved_overtime_minutes: existing?.approved_overtime_minutes || 0,
        verified: existing?.verified || false,
        remarks: existing?.remarks || leave?.reason || '',
        leave_id: leave?.id,
      });
    }
  }
  return records.sort(
    (a, b) => b.work_date.localeCompare(a.work_date) || a.employee_id.localeCompare(b.employee_id),
  );
}
export function summary(records: any[]) {
  return {
    scheduled_days: records.filter((r) => r.scheduled).length,
    present: records.filter((r) => ['PRESENT', 'CLOCKED_IN', 'INCOMPLETE'].includes(r.status))
      .length,
    absent: records.filter((r) => r.status === 'ABSENT').length,
    on_leave: records.filter((r) => r.status === 'ON_LEAVE').length,
    worked_minutes: records.reduce((s, r) => s + r.worked_minutes, 0),
    late_minutes: records.reduce((s, r) => s + r.late_minutes, 0),
    approved_overtime_minutes: records.reduce((s, r) => s + r.approved_overtime_minutes, 0),
    incomplete: records.filter((r) => r.status === 'INCOMPLETE').length,
  };
}
export async function requestCorrection(db: DB, actor: any, input: any) {
  await payrollLock(db);
  const userId = actor.role === 'EMPLOYEE' ? actor.id : input.user_id || actor.id;
  await db.query('SELECT id FROM users WHERE id=$1 FOR UPDATE', [userId]);
  const record = (
    await db.query('SELECT * FROM attendance WHERE user_id=$1 AND work_date=$2', [
      userId,
      input.work_date,
    ])
  ).rows[0];
  const schedule = record?.schedule_snapshot || (await scheduleFor(db, userId, input.work_date));
  const { start, end } = shiftBounds(input.work_date, schedule);
  if (
    Math.abs(new Date(input.requested_in).getTime() - start.toMillis()) > 12 * 3600000 ||
    new Date(input.requested_out).getTime() > end.plus({ hours: 12 }).toMillis()
  )
    throw new AppError(422, 'Requested times must belong to the selected work date and schedule.');
  calculateAttendance(input.work_date, schedule, input.requested_in, input.requested_out);
  if (input.work_date > today())
    throw new AppError(422, 'Cannot correct a future attendance date.');
  if (new Date(input.requested_out).getTime() > Date.now())
    throw new AppError(422, 'Requested clock-out cannot be in the future.');
  if (
    (
      await db.query(
        "SELECT 1 FROM leaves WHERE user_id=$1 AND status='APPROVED' AND $2 BETWEEN start_date AND end_date",
        [userId, input.work_date],
      )
    ).rowCount
  )
    throw new AppError(409, 'Attendance cannot be recorded on an approved leave day.');
  const id = randomUUID();
  const original = record
    ? {
        clock_in: record.clock_in,
        clock_out: record.clock_out,
        version: record.version,
        schedule_snapshot: schedule,
      }
    : { clock_in: null, clock_out: null, version: null, schedule_snapshot: schedule };
  const result = (
    await db.query(
      `INSERT INTO corrections(id,user_id,work_date,attendance_id,original,requested_in,requested_out,reason)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [
        id,
        userId,
        input.work_date,
        record?.id || null,
        JSON.stringify(original),
        input.requested_in,
        input.requested_out,
        input.reason,
      ],
    )
  ).rows[0];
  await audit(db, actor.id, 'CORRECTION_REQUESTED', 'correction', id, {
    reason: input.reason,
    original,
    requested_in: input.requested_in,
    requested_out: input.requested_out,
  });
  return result;
}
export async function reviewCorrection(
  db: DB,
  actor: any,
  id: string,
  status: string,
  note: string,
) {
  await payrollLock(db);
  const request = (await db.query('SELECT * FROM corrections WHERE id=$1 FOR UPDATE', [id]))
    .rows[0];
  if (!request) throw new AppError(404, 'Correction request not found.');
  if (request.user_id === actor.id)
    throw new AppError(403, 'Another authorized reviewer must review your own correction.');
  if (request.status !== 'PENDING')
    throw new AppError(409, 'This request has already been reviewed.');
  if (status === 'APPROVED') {
    await db.query('SELECT id FROM users WHERE id=$1 FOR UPDATE', [request.user_id]);
    const record = (
      await db.query('SELECT * FROM attendance WHERE user_id=$1 AND work_date=$2 FOR UPDATE', [
        request.user_id,
        request.work_date,
      ])
    ).rows[0];
    if ((record?.version || null) !== request.original.version)
      throw new AppError(
        409,
        'Attendance changed after this request. Reject it and submit a new correction with current times.',
      );
    const schedule = record?.schedule_snapshot || request.original.schedule_snapshot;
    const stats = calculateAttendance(
      request.work_date,
      schedule,
      request.requested_in,
      request.requested_out,
    );
    const overlapping = (
      await db.query(
        `SELECT 1 FROM attendance WHERE user_id=$1 AND id<>$2 AND clock_in < $4
      AND COALESCE(clock_out,clock_in+interval '36 hours') > $3`,
        [request.user_id, record?.id || randomUUID(), request.requested_in, request.requested_out],
      )
    ).rowCount;
    if (overlapping) throw new AppError(409, 'Requested attendance overlaps another shift.');
    if (record)
      await db.query(
        `UPDATE attendance SET clock_in=$2,clock_out=$3,worked_minutes=$4,late_minutes=$5,overtime_minutes=$6,
      approved_overtime_minutes=LEAST(approved_overtime_minutes,$6),verified=true,verified_by=$7,verified_at=now(),remarks=$8,version=version+1 WHERE id=$1`,
        [
          record.id,
          request.requested_in,
          request.requested_out,
          stats.worked_minutes,
          stats.late_minutes,
          stats.overtime_minutes,
          actor.id,
          `Correction approved: ${request.reason}`,
        ],
      );
    else
      await db.query(
        `INSERT INTO attendance(id,user_id,work_date,clock_in,clock_out,schedule_snapshot,worked_minutes,late_minutes,overtime_minutes,verified,verified_by,verified_at,remarks)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,true,$10,now(),$11)`,
        [
          randomUUID(),
          request.user_id,
          request.work_date,
          request.requested_in,
          request.requested_out,
          JSON.stringify(schedule),
          stats.worked_minutes,
          stats.late_minutes,
          stats.overtime_minutes,
          actor.id,
          `Correction approved: ${request.reason}`,
        ],
      );
    await db.query(
      "UPDATE payroll SET status='DRAFT' WHERE user_id=$1 AND $2 BETWEEN start_date AND end_date AND status='FOR_REVIEW'",
      [request.user_id, request.work_date],
    );
  }
  await db.query(
    'UPDATE corrections SET status=$2,reviewer_id=$3,review_note=$4,reviewed_at=now() WHERE id=$1',
    [id, status, actor.id, note],
  );
  await audit(db, actor.id, `CORRECTION_${status}`, 'correction', id, {
    original: request.original,
    updated: { clock_in: request.requested_in, clock_out: request.requested_out },
    reason: request.reason,
    review_note: note,
  });
}
export async function payrollCalculation(db: DB, userId: string, from: string, to: string) {
  const records = await dailyRecords(db, from, to, userId);
  const unresolved = records.filter((r) => r.id && (!r.clock_out || !r.verified));
  if (unresolved.length)
    throw new AppError(
      422,
      `Resolve and verify ${unresolved.length} attendance record(s) before calculating payroll.`,
    );
  if (
    (
      await db.query(
        "SELECT 1 FROM corrections WHERE user_id=$1 AND work_date BETWEEN $2 AND $3 AND status='PENDING'",
        [userId, from, to],
      )
    ).rowCount
  )
    throw new AppError(422, 'Review pending attendance corrections before calculating payroll.');
  if (to >= today())
    throw new AppError(
      422,
      'Payroll periods must end before today, so every scheduled day has finished.',
    );
  const user = (await db.query('SELECT hourly_rate_cents FROM users WHERE id=$1', [userId]))
    .rows[0];
  if (!user) throw new AppError(404, 'Employee not found.');
  const policy = (await db.query('SELECT * FROM payroll_policy WHERE id=1')).rows[0];
  const calculation = calculatePayroll(records, user.hourly_rate_cents, policy);
  const fingerprint = hash(
    JSON.stringify({
      records: records.map((r) => [
        r.id,
        r.work_date,
        r.version,
        r.status,
        r.verified,
        r.worked_minutes,
        r.approved_overtime_minutes,
        r.schedule_snapshot,
      ]),
      rate: user.hourly_rate_cents,
      policy,
      calculation,
    }),
  );
  return { calculation, fingerprint };
}
export async function createPayroll(db: DB, actor: any, input: any) {
  await payrollLock(db);
  const { calculation, fingerprint } = await payrollCalculation(
    db,
    input.user_id,
    input.start_date,
    input.end_date,
  );
  if (calculation.net_cents < 0)
    throw new AppError(
      422,
      'Configured deductions exceed earnings. Adjust the payroll policy before continuing.',
    );
  const existing = (
    await db.query(
      'SELECT * FROM payroll WHERE user_id=$1 AND start_date=$2 AND end_date=$3 AND adjustment_of IS NULL FOR UPDATE',
      [input.user_id, input.start_date, input.end_date],
    )
  ).rows[0];
  if (existing) {
    if (!['DRAFT', 'FOR_REVIEW'].includes(existing.status))
      throw new AppError(409, 'This period is finalized. Use an authorized payroll adjustment.');
    await db.query(
      "UPDATE payroll SET calculation=$2,attendance_fingerprint=$3,status='DRAFT' WHERE id=$1",
      [existing.id, JSON.stringify(calculation), fingerprint],
    );
    await audit(db, actor.id, 'PAYROLL_RECALCULATED', 'payroll', existing.id, { calculation });
    return existing.id;
  }
  const overlaps = (
    await db.query(
      `SELECT 1 FROM payroll WHERE user_id=$1 AND adjustment_of IS NULL AND start_date <= $3 AND end_date >= $2`,
      [input.user_id, input.start_date, input.end_date],
    )
  ).rowCount;
  if (overlaps) throw new AppError(409, 'A payroll period already overlaps these dates.');
  const id = randomUUID();
  await db.query(
    'INSERT INTO payroll(id,user_id,start_date,end_date,calculation,attendance_fingerprint) VALUES($1,$2,$3,$4,$5,$6)',
    [id, input.user_id, input.start_date, input.end_date, JSON.stringify(calculation), fingerprint],
  );
  await audit(db, actor.id, 'PAYROLL_CALCULATED', 'payroll', id, { calculation });
  return id;
}
export async function adjustPayroll(db: DB, actor: any, id: string, reason: string) {
  await payrollLock(db);
  const original = (await db.query('SELECT * FROM payroll WHERE id=$1 FOR UPDATE', [id])).rows[0];
  if (!original || !['APPROVED', 'PAID'].includes(original.status) || original.adjustment_of)
    throw new AppError(422, 'Choose an approved or paid original payroll to create an adjustment.');
  if (
    (
      await db.query(
        "SELECT 1 FROM payroll WHERE adjustment_of=$1 AND status IN ('DRAFT','FOR_REVIEW')",
        [id],
      )
    ).rowCount
  )
    throw new AppError(409, 'Review the existing pending adjustment first.');
  const { calculation, fingerprint } = await payrollCalculation(
    db,
    original.user_id,
    original.start_date,
    original.end_date,
  );
  const previous = (
    await db.query(
      "SELECT calculation FROM payroll WHERE (id=$1 OR adjustment_of=$1) AND status IN ('APPROVED','PAID')",
      [id],
    )
  ).rows;
  const delta: any = {
    ...calculation,
    full_calculation: calculation,
    method: 'Adjustment: difference from the original and all previously approved adjustments.',
  };
  for (const key of [
    'base_cents',
    'overtime_cents',
    'other_earnings_cents',
    'contribution_cents',
    'other_deduction_cents',
    'gross_cents',
    'deductions_cents',
    'net_cents',
  ])
    delta[key] =
      (calculation[key as keyof typeof calculation] as number) -
      previous.reduce((s, r) => s + r.calculation[key], 0);
  if (!delta.net_cents && !delta.gross_cents && !delta.deductions_cents)
    throw new AppError(422, 'No payable change was found for this period.');
  const adjustment = randomUUID();
  await db.query(
    `INSERT INTO payroll(id,user_id,start_date,end_date,calculation,attendance_fingerprint,adjustment_of,adjustment_reason) VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,
    [
      adjustment,
      original.user_id,
      original.start_date,
      original.end_date,
      JSON.stringify(delta),
      fingerprint,
      id,
      reason,
    ],
  );
  await audit(db, actor.id, 'PAYROLL_ADJUSTMENT_CREATED', 'payroll', adjustment, {
    original_id: id,
    reason,
    calculation: delta,
  });
  return adjustment;
}
export async function recalculateAdjustment(db: DB, actor: any, id: string) {
  await payrollLock(db);
  const pending = (await db.query('SELECT * FROM payroll WHERE id=$1 FOR UPDATE', [id])).rows[0];
  if (!pending?.adjustment_of || !['DRAFT', 'FOR_REVIEW'].includes(pending.status))
    throw new AppError(422, 'Only pending payroll adjustments can be recalculated.');
  const { calculation, fingerprint } = await payrollCalculation(
    db,
    pending.user_id,
    pending.start_date,
    pending.end_date,
  );
  const previous = (
    await db.query(
      "SELECT calculation FROM payroll WHERE (id=$1 OR adjustment_of=$1) AND status IN ('APPROVED','PAID')",
      [pending.adjustment_of],
    )
  ).rows;
  const delta: any = {
    ...calculation,
    full_calculation: calculation,
    method: 'Adjustment: difference from the original and all previously approved adjustments.',
  };
  for (const key of [
    'base_cents',
    'overtime_cents',
    'other_earnings_cents',
    'contribution_cents',
    'other_deduction_cents',
    'gross_cents',
    'deductions_cents',
    'net_cents',
  ])
    delta[key] =
      (calculation[key as keyof typeof calculation] as number) -
      previous.reduce((s, r) => s + r.calculation[key], 0);
  await db.query(
    "UPDATE payroll SET calculation=$2,attendance_fingerprint=$3,status='DRAFT' WHERE id=$1",
    [id, JSON.stringify(delta), fingerprint],
  );
  await audit(db, actor.id, 'PAYROLL_ADJUSTMENT_RECALCULATED', 'payroll', id, {
    reason: pending.adjustment_reason,
    calculation: delta,
  });
}
