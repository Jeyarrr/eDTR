import { DateTime } from 'luxon';
export const ZONE = 'Asia/Manila';
export type Schedule = {
  id?: string;
  name: string;
  start_time: string;
  end_time: string;
  grace_minutes: number;
  break_minutes: number;
  break_after_minutes: number;
  work_days: number[];
};
export class AppError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
export const today = (now = new Date()) => DateTime.fromJSDate(now, { zone: ZONE }).toISODate()!;
export const shiftBounds = (date: string, schedule: Schedule) => {
  const start = DateTime.fromISO(`${date}T${schedule.start_time}`, { zone: ZONE });
  let end = DateTime.fromISO(`${date}T${schedule.end_time}`, { zone: ZONE });
  if (end <= start) end = end.plus({ days: 1 });
  return { start, end };
};
export function attendanceDate(now: Date, schedule: Schedule) {
  const current = DateTime.fromJSDate(now, { zone: ZONE });
  const previous = current.minus({ days: 1 }).toISODate()!;
  const { start, end } = shiftBounds(previous, schedule);
  const overnight = end.toISODate() !== start.toISODate();
  return overnight && current < end.plus({ hours: 4 }) ? previous : current.toISODate()!;
}
export function calculateAttendance(
  date: string,
  schedule: Schedule,
  clockIn: Date | string,
  clockOut?: Date | string | null,
) {
  const inTime = new Date(clockIn).getTime();
  const { start, end } = shiftBounds(date, schedule);
  const late = Math.max(0, Math.floor((inTime - start.toMillis()) / 60000));
  if (!clockOut)
    return {
      worked_minutes: 0,
      late_minutes: late > schedule.grace_minutes ? late : 0,
      overtime_minutes: 0,
    };
  const outTime = new Date(clockOut).getTime();
  const elapsed = Math.floor((outTime - inTime) / 60000);
  if (!Number.isFinite(elapsed) || outTime <= inTime || elapsed > 36 * 60)
    throw new AppError(422, 'A shift must be longer than zero and no longer than 36 hours.');
  const breakMinutes =
    elapsed >= schedule.break_after_minutes ? Math.min(schedule.break_minutes, elapsed) : 0;
  const worked = Math.max(0, elapsed - breakMinutes);
  const overtime = Math.min(
    worked,
    Math.max(0, Math.floor((outTime - Math.max(inTime, end.toMillis())) / 60000)),
  );
  return {
    worked_minutes: worked,
    late_minutes: late > schedule.grace_minutes ? late : 0,
    overtime_minutes: overtime,
  };
}
export const cents = (value: number) => Math.round(value);
export function calculatePayroll(records: any[], rate: number, policy: any) {
  const verified = records.filter((r) => r.id && r.verified && r.clock_out);
  const regularMinutes = verified.reduce(
    (sum, r) =>
      sum +
      Math.min(
        r.worked_minutes - r.overtime_minutes,
        Math.max(
          0,
          shiftBounds(r.work_date, r.schedule_snapshot).end.diff(
            shiftBounds(r.work_date, r.schedule_snapshot).start,
            'minutes',
          ).minutes -
            (shiftBounds(r.work_date, r.schedule_snapshot).end.diff(
              shiftBounds(r.work_date, r.schedule_snapshot).start,
              'minutes',
            ).minutes >= r.schedule_snapshot.break_after_minutes
              ? r.schedule_snapshot.break_minutes
              : 0),
        ),
      ),
    0,
  );
  const overtimeMinutes = verified.reduce((sum, r) => sum + r.approved_overtime_minutes, 0);
  const base = cents((regularMinutes * rate) / 60);
  const overtime = cents((overtimeMinutes * rate * Number(policy.overtime_multiplier)) / 60);
  const other = Number(policy.other_earnings_cents);
  const deductions = Number(policy.contribution_cents) + Number(policy.other_deduction_cents);
  const gross = base + overtime + other;
  return {
    rate_cents: rate,
    regular_minutes: regularMinutes,
    approved_overtime_minutes: overtimeMinutes,
    verified_days: verified.length,
    worked_minutes: verified.reduce((s, r) => s + r.worked_minutes, 0),
    late_minutes: verified.reduce((s, r) => s + r.late_minutes, 0),
    scheduled_days: records.filter((r) => r.scheduled).length,
    absent_days: records.filter((r) => r.status === 'ABSENT').length,
    leave_days: records.filter((r) => r.status === 'ON_LEAVE').length,
    base_cents: base,
    overtime_cents: overtime,
    other_earnings_cents: other,
    contribution_cents: Number(policy.contribution_cents),
    other_deduction_cents: Number(policy.other_deduction_cents),
    gross_cents: gross,
    deductions_cents: deductions,
    net_cents: gross - deductions,
    policy,
    method:
      'Hourly: only verified regular minutes are paid. Absence, lateness, and undertime are already reflected in worked minutes; no second deduction.',
  };
}
