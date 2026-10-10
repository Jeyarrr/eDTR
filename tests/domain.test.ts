import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  calculateAttendance,
  attendanceDate,
  calculatePayroll,
  type Schedule,
} from '../server/domain.js';
const schedule: Schedule = {
  name: 'Day',
  start_time: '08:00',
  end_time: '17:00',
  grace_minutes: 5,
  break_minutes: 60,
  break_after_minutes: 360,
  work_days: [1, 2, 3, 4, 5],
};
test('normal shift subtracts configured break', () => {
  assert.deepEqual(
    calculateAttendance('2026-10-09', schedule, '2026-10-09T00:00:00Z', '2026-10-09T09:00:00Z'),
    { worked_minutes: 480, late_minutes: 0, overtime_minutes: 0 },
  );
});
test('grace and lateness are separate from attendance state', () => {
  assert.equal(calculateAttendance('2026-10-09', schedule, '2026-10-09T00:05:00Z').late_minutes, 0);
  assert.equal(
    calculateAttendance('2026-10-09', schedule, '2026-10-09T00:17:00Z').late_minutes,
    17,
  );
});
test('short shifts do not deduct an unearned break and immediate clock-out remains valid', () => {
  assert.equal(
    calculateAttendance('2026-10-09', schedule, '2026-10-09T00:00:00Z', '2026-10-09T04:00:00Z')
      .worked_minutes,
    240,
  );
  assert.equal(
    calculateAttendance('2026-10-09', schedule, '2026-10-09T00:00:00Z', '2026-10-09T00:00:01Z')
      .worked_minutes,
    0,
  );
});
test('overnight dates and duration survive midnight', () => {
  const overnight = { ...schedule, start_time: '22:00', end_time: '07:00' };
  assert.equal(attendanceDate(new Date('2026-10-09T17:00:00Z'), overnight), '2026-10-09');
  assert.deepEqual(
    calculateAttendance('2026-10-09', overnight, '2026-10-09T14:00:00Z', '2026-10-09T23:00:00Z'),
    { worked_minutes: 480, late_minutes: 0, overtime_minutes: 0 },
  );
});
test('missed clock-outs longer than 36 hours require corrections', () => {
  assert.throws(() =>
    calculateAttendance('2026-10-09', schedule, '2026-10-09T00:00:00Z', '2026-10-11T00:00:00Z'),
  );
});
test('a scheduled short shift does not lose pay for a break that does not apply', () => {
  const short = { ...schedule, end_time: '12:00' };
  const stats = calculateAttendance(
    '2026-10-09',
    short,
    '2026-10-09T00:00:00Z',
    '2026-10-09T04:00:00Z',
  );
  const result = calculatePayroll(
    [
      {
        id: 'short',
        verified: true,
        clock_out: '2026-10-09T04:00:00Z',
        work_date: '2026-10-09',
        schedule_snapshot: short,
        ...stats,
        approved_overtime_minutes: 0,
      },
    ],
    10000,
    {
      overtime_multiplier: 1.5,
      other_earnings_cents: 0,
      contribution_cents: 0,
      other_deduction_cents: 0,
    },
  );
  assert.equal(result.regular_minutes, 240);
  assert.equal(result.base_cents, 40000);
});

test('hourly payroll pays verified time and approved overtime without double deductions', () => {
  const records = [
    {
      id: '1',
      verified: true,
      clock_out: '2026-10-09T10:00:00Z',
      work_date: '2026-10-09',
      schedule_snapshot: schedule,
      worked_minutes: 525,
      overtime_minutes: 60,
      approved_overtime_minutes: 30,
      late_minutes: 15,
      scheduled: true,
      status: 'PRESENT',
    },
    {
      id: '2',
      verified: false,
      clock_out: 'x',
      worked_minutes: 480,
      late_minutes: 0,
      scheduled: true,
      status: 'PRESENT',
    },
    { scheduled: true, status: 'ABSENT' },
  ];
  const result = calculatePayroll(records, 12000, {
    overtime_multiplier: 1.5,
    contribution_cents: 5000,
    other_deduction_cents: 1000,
    other_earnings_cents: 2000,
  });
  assert.equal(result.base_cents, 93000);
  assert.equal(result.overtime_cents, 9000);
  assert.equal(result.net_cents, 98000);
  assert.equal(result.verified_days, 1);
  assert.equal(result.absent_days, 1);
});
