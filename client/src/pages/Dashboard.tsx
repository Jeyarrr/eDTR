import { useEffect, useState } from 'react';
import { DateTime } from 'luxon';
import { Link } from 'react-router-dom';
import {
  ArrowUpRight,
  Clock3,
  UserCheck,
  UserX,
  CalendarDays,
  Play,
  Square,
  Users,
  ChevronRight,
  ClipboardCheck,
  Coffee,
  CheckCircle2,
} from 'lucide-react';
import { useApp } from '../App';
import { post } from '../api';
import { ClockProof } from '../ClockProof';
import { Badge, State, hours, timeText, dateText, useResource, ZONE, Notice } from '../ui';
function LiveClock({ offset }: { offset: number }) {
  const [tick, setTick] = useState(Date.now());
  useEffect(() => {
    const timer = setInterval(() => {
      if (!document.hidden) setTick(Date.now());
    }, 1000);
    return () => clearInterval(timer);
  }, []);
  const now = DateTime.fromMillis(tick + offset, { zone: ZONE });
  return (
    <div className="live-time">
      {now.toFormat('hh:mm:ss')}
      <span>{now.toFormat('a')}</span>
    </div>
  );
}
export function Dashboard() {
  const { user, revision, lookups, refresh, notify } = useApp(),
    employee = user.role === 'EMPLOYEE';
  const [tick, setTick] = useState(Date.now()),
    [poll, setPoll] = useState(0),
    [busy, setBusy] = useState(false),
    [actionError, setActionError] = useState('');
  const [proofOpen, setProofOpen] = useState(false);
  const { data, error, loading, setData } = useResource('/dashboard', revision + poll);
  useEffect(() => {
    const timer = setInterval(() => {
        if (!document.hidden) setTick(Date.now());
      }, 60000),
      poller = setInterval(() => {
        if (!document.hidden) setPoll((v) => v + 1);
      }, 30000);
    return () => {
      clearInterval(timer);
      clearInterval(poller);
    };
  }, []);
  const [offset, setOffset] = useState(0);
  useEffect(() => {
    if (data?.server_time) setOffset(new Date(data.server_time).getTime() - Date.now());
  }, [data?.server_time]);
  if (!data) return <State loading={loading} error={error} />;
  const now = DateTime.fromMillis(tick + offset, { zone: ZONE }),
    schedule = lookups?.schedules?.find((s: any) => s.id === user.schedule_id),
    own = data.own;
  const open = own?.id && !own.clock_out,
    completed = own?.work_date === data.date && own.clock_out;
  const worked = open
    ? Math.max(
        0,
        Math.floor((tick + offset - new Date(own.clock_in).getTime()) / 60000) -
          (Math.floor((tick + offset - new Date(own.clock_in).getTime()) / 60000) >=
          own.schedule_snapshot.break_after_minutes
            ? own.schedule_snapshot.break_minutes
            : 0),
      )
    : own?.work_date === data.date
      ? own.worked_minutes
      : 0;
  async function clock(action: string, proof?: string) {
    setBusy(true);
    setActionError('');
    try {
      const record = await post(`/attendance/clock-${action}`, proof ? { proof } : {});
      setData((previous: any) => ({ ...previous, own: record }));
      refresh();
      notify(
        action === 'in'
          ? 'Clock-in recorded using the server time.'
          : 'Clock-out recorded. Your shift is ready for verification.',
      );
    } catch (e: any) {
      setActionError(e.message);
      if (action === 'in') throw e;
    } finally {
      setBusy(false);
    }
  }
  const greeting =
    now.hour < 12 ? 'Good morning' : now.hour < 18 ? 'Good afternoon' : 'Good evening';
  const weeklyMinutes = data.weekly.reduce((sum: number, row: any) => sum + row.worked_minutes, 0);
  return (
    <div className="workspace-overview">
      {proofOpen && (
        <ClockProof onClose={() => setProofOpen(false)} onConfirm={(photo) => clock('in', photo)} />
      )}
      <div className="page-intro workspace-heading">
        <div>
          <span className="heading-eyebrow">
            <i className="workspace-status-dot" />
            WORKSPACE OVERVIEW
          </span>
          <h1>
            {greeting}, {user.name.split(' ')[0]}
            <span className="greeting-period">.</span>
          </h1>
          <p>Here’s a clear view of your people, attendance, and workdays.</p>
        </div>
        <div className="heading-actions">
          <div className="date-pill">
            <CalendarDays size={15} />
            {now.toFormat('ccc, MMM d, yyyy')}
          </div>
          <Link className="button primary workspace-action" to={employee ? '/dtr' : '/attendance'}>
            <CalendarDays size={15} />
            {employee ? 'My records' : 'View attendance'}
            <ArrowUpRight size={14} />
          </Link>
        </div>
      </div>
      {error && <Notice>{error}</Notice>}
      {employee ? (
        <>
          <section className="clock-card">
            <div className="clock-primary">
              <span className="eyebrow">TODAY · ASIA/MANILA</span>
              <LiveClock offset={offset} />
              <p>
                {open
                  ? `Your shift started at ${timeText(own.clock_in)}${own.work_date !== data.date ? ` on ${dateText(own.work_date)}` : ''}.`
                  : completed
                    ? 'Your shift is complete. Thank you for your work today.'
                    : 'Ready when you are. Clock in to start your workday.'}
              </p>
              <div className="clock-actions">
                <button
                  className="button green large"
                  disabled={busy || open || completed}
                  onClick={() => setProofOpen(true)}
                >
                  <Play size={17} />
                  Clock In
                </button>
                <button
                  className="button primary large"
                  disabled={busy || !open}
                  onClick={() => clock('out')}
                >
                  <Square size={16} />
                  Clock Out
                </button>
              </div>
              {actionError && (
                <div className="form-error" role="alert">
                  {actionError}
                </div>
              )}
              <span className="clock-footnote">
                <CheckCircle2 size={14} />
                Attendance is recorded with the server timestamp.
              </span>
            </div>
            <div className="clock-details">
              <Badge status={open ? 'CLOCKED_IN' : completed ? 'PRESENT' : 'NOT_CLOCKED_IN'} />
              <div>
                <span>Working hours today</span>
                <strong>{hours(worked)}</strong>
              </div>
              <div className="clock-schedule">
                <Clock3 size={18} />
                <div>
                  <span>{schedule?.name || 'Schedule not assigned'}</span>
                  <strong>
                    {schedule ? `${schedule.start_time} – ${schedule.end_time}` : 'Contact HR'}
                  </strong>
                </div>
              </div>
              <div className="clock-schedule">
                <Coffee size={18} />
                <span>
                  {schedule?.break_minutes || 0} min break · {schedule?.grace_minutes || 0} min
                  grace period
                </span>
              </div>
            </div>
          </section>
          <div className="summary-grid employee-stats">
            <Stat
              label="Present · last 7 days"
              value={data.weekly.reduce((s: number, r: any) => s + r.present, 0)}
              icon={UserCheck}
            />
            <Stat
              label="Worked · last 7 days"
              value={hours(data.weekly.reduce((s: number, r: any) => s + r.worked_minutes, 0))}
              icon={Clock3}
            />
            <Stat
              label="Late minutes"
              value={data.weekly.reduce((s: number, r: any) => s + r.late_minutes, 0)}
              icon={CalendarDays}
            />
          </div>
        </>
      ) : (
        <div className="summary-grid workspace-kpis">
          {[
            ['Total active employees', data.totals.employees, Users, 'Team members'],
            ['Present today', data.totals.present, UserCheck, 'Attendance recorded'],
            ['Absent today', data.totals.absent, UserX, 'After scheduled shift'],
            ['Late today', data.totals.late, Clock3, 'Past the grace period'],
            ['On leave today', data.totals.on_leave, CalendarDays, 'Approved leave'],
          ].map(([label, value, icon, hint]) => (
            <Stat
              key={label as string}
              label={label as string}
              value={value as number}
              icon={icon as any}
              hint={hint as string}
            />
          ))}
        </div>
      )}
      {!employee && (
        <div className="operations-kpis">
          {[
            ['Currently clocked in', data.totals.clocked_in, 'Active shifts across your workspace'],
            [
              'Pending corrections',
              data.pending_corrections,
              'Attendance requests awaiting review',
            ],
            [
              'Weekly working hours',
              hours(weeklyMinutes),
              'Recorded time over the last seven days',
            ],
          ].map(([label, value, caption]) => (
            <section className="panel finance-kpi" key={String(label)}>
              <span>{label}</span>
              <strong>{value}</strong>
              <p>{caption}</p>
            </section>
          ))}
        </div>
      )}
      <div className="dashboard-workspace-grid">
        <section className="panel activity-card">
          <div className="panel-heading">
            <div>
              <h2>Recent attendance activity</h2>
              <p>The latest updates from your workspace</p>
            </div>
            <Clock3 size={17} />
          </div>
          {data.activity.length ? (
            <ul className="workspace-data-list">
              {data.activity.slice(0, 4).map((record: any) => (
                <li key={record.id}>
                  <span>
                    <Link to="/dtr">
                      {record.name} {record.clock_out ? 'completed a shift' : 'clocked in'}
                    </Link>
                    <small>
                      {record.employee_id} · {timeText(record.clock_out || record.clock_in)}
                    </small>
                  </span>
                  <time dateTime={record.work_date}>{dateText(record.work_date)}</time>
                </li>
              ))}
            </ul>
          ) : (
            <div className="workspace-empty">
              <span className="empty-icon">
                <Clock3 size={22} strokeWidth={1.4} />
              </span>
              <strong>Your workday starts here</strong>
              <p>Clock-ins and completed shifts will appear here.</p>
            </div>
          )}
          <Link className="card-footnote" to="/dtr">
            View all records
            <ArrowUpRight size={13} />
          </Link>
        </section>
        <section className="panel weekly-card">
          <div className="panel-heading">
            <div>
              <h2>{employee ? 'Your weekly attendance' : 'Weekly attendance'}</h2>
              <p>Recorded attendance over the last seven days</p>
            </div>
            <span className="subtle-pill">Last 7 days</span>
          </div>
          <div className="weekly-summary">
            <div>
              <span>
                <i className="dot red" />
                Recorded hours
              </span>
              <strong>{hours(weeklyMinutes)}</strong>
            </div>
            <div>
              <span>
                <i className="dot pale" />
                Days present
              </span>
              <strong>{data.weekly.reduce((sum: number, row: any) => sum + row.present, 0)}</strong>
            </div>
          </div>
          <AttendanceChart data={data.weekly} />
        </section>
        <section className="panel workload-card">
          <div className="panel-heading">
            <div>
              <h2>Daily attendance</h2>
              <p>Recorded presence throughout the week</p>
            </div>
            <Users size={17} />
          </div>
          <ul className="workspace-workload">
            {data.weekly.slice(-5).map((day: any) => (
              <li key={day.date}>
                <span>
                  {DateTime.fromISO(day.date).toFormat('ccc, MMM d')}
                  <strong>{day.present} present</strong>
                </span>
                <div className="workload-track">
                  <i
                    style={{
                      width: day.present
                        ? Math.min(100, (day.present / Math.max(1, data.totals.employees)) * 100) +
                          '%'
                        : '0%',
                    }}
                  />
                </div>
              </li>
            ))}
          </ul>
        </section>
        <section className="panel approvals-card">
          <div className="panel-heading">
            <div>
              <h2>{employee ? 'Your work schedule' : 'Pending approvals'}</h2>
              <p>
                {employee
                  ? 'Your assigned shift and break'
                  : 'Keep your team’s time records accurate'}
              </p>
            </div>
            <ClipboardCheck size={17} />
          </div>
          <div className="workspace-empty">
            <span className="empty-icon">
              {employee ? <CalendarDays size={20} /> : <ClipboardCheck size={20} />}
            </span>
            <strong>
              {employee
                ? schedule?.name || 'No schedule assigned'
                : data.pending_corrections
                  ? `${data.pending_corrections} correction request${data.pending_corrections === 1 ? '' : 's'}`
                  : 'All caught up'}
            </strong>
            <p>
              {employee
                ? schedule
                  ? schedule.start_time +
                    ' – ' +
                    schedule.end_time +
                    ' · ' +
                    schedule.break_minutes +
                    ' min break'
                  : 'Contact HR to assign your schedule.'
                : data.pending_corrections
                  ? 'Attendance corrections are ready for your review.'
                  : 'No correction requests are waiting for review.'}
            </p>
          </div>
          <Link className="card-footnote" to="/requests">
            {employee ? 'My requests' : 'Review requests'}
            <ChevronRight size={13} />
          </Link>
        </section>
        <section className="panel status-card">
          <div className="panel-heading">
            <div>
              <h2>{employee ? 'Your attendance today' : 'Today’s attendance overview'}</h2>
              <p>{employee ? 'Your current workday' : 'A clear view of team attendance'}</p>
            </div>
          </div>
          <div className="status-breakdown">
            <div
              className="ring-visual"
              style={
                {
                  '--progress':
                    Math.min(
                      100,
                      data.totals.employees
                        ? (data.totals.present / data.totals.employees) * 100
                        : 0,
                    ) + '%',
                } as any
              }
            >
              <div>
                <strong>
                  {data.totals.employees
                    ? Math.round((data.totals.present / data.totals.employees) * 100)
                    : 0}
                  %
                </strong>
                <span>present today</span>
              </div>
            </div>
            <div className="overview-legend">
              <span>
                <i className="dot red" />
                Present<strong>{data.totals.present}</strong>
              </span>
              <span>
                <i className="dot pale" />
                Absent<strong>{data.totals.absent}</strong>
              </span>
              <span>
                <i className="dot crimson" />
                On leave<strong>{data.totals.on_leave}</strong>
              </span>
            </div>
          </div>
          <div className="card-footnote">
            <CheckCircle2 size={12} />
            Attendance for {dateText(data.date)}
          </div>
        </section>
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  icon: Icon,
  hint,
}: {
  label: string;
  value: string | number;
  icon: any;
  hint?: string;
}) {
  return (
    <div className="stat-card">
      <div>
        <span>{label}</span>
        <span className="kpi-icon">
          <Icon size={17} strokeWidth={1.7} />
        </span>
      </div>
      <strong>{value}</strong>
      {hint && (
        <small>
          <span aria-hidden="true">—</span>
          {hint}
        </small>
      )}
    </div>
  );
}
function AttendanceChart({ data }: { data: any[] }) {
  const max = Math.max(1, ...data.map((d) => Math.max(d.present, d.absent, d.late)));
  return (
    <div
      className="attendance-chart"
      role="img"
      aria-label={data
        .map((d) => `${d.date}: ${d.present} present, ${d.absent} absent, ${d.late} late`)
        .join('; ')}
    >
      <div className="chart-legend">
        <span>
          <i className="dot red" />
          Present
        </span>
        <span>
          <i className="dot pale" />
          Absent
        </span>
        <span>
          <i className="dot amber" />
          Late indicator
        </span>
      </div>
      <div className="chart-grid">
        <div className="chart-y-labels">
          <span>{max}</span>
          <span>{Math.ceil(max / 2)}</span>
          <span>0</span>
        </div>
        <div className="chart-bars">
          {data.map((d) => (
            <div className="bar-group" key={d.date}>
              <div className="bars">
                {[
                  ['present', 'red'],
                  ['absent', 'pale'],
                  ['late', 'amber'],
                ].map(([key, color]) => (
                  <div
                    className={`bar ${color}`}
                    key={key}
                    style={{ height: d[key] ? `${Math.max(4, (d[key] / max) * 100)}%` : '0%' }}
                    title={`${d[key]} ${key}`}
                  >
                    <span>{d[key] || ''}</span>
                  </div>
                ))}
              </div>
              <span>{DateTime.fromISO(d.date).toFormat('ccc')}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
