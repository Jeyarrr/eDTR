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
import {
  PageIntro,
  Badge,
  State,
  hours,
  timeText,
  dateText,
  useResource,
  ZONE,
  Notice,
} from '../ui';
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
  return (
    <>
      {proofOpen && (
        <ClockProof onClose={() => setProofOpen(false)} onConfirm={(photo) => clock('in', photo)} />
      )}
      <PageIntro
        eyebrow={employee ? 'YOUR WORKDAY, AT A GLANCE' : 'TODAY’S WORKSPACE'}
        title={`Welcome back, ${user.name.split(' ')[0]}!`}
        description={
          employee
            ? 'Keep track of your time and make every workday count.'
            : 'Here’s what’s happening with your team today.'
        }
        actions={
          <div className="date-pill">
            <CalendarDays size={18} />
            {now.toFormat('cccc, MMMM dd, yyyy')}
          </div>
        }
      />
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
        <div className="summary-grid">
          {[
            ['Total active employees', data.totals.employees, Users, 'Team members'],
            ['Present today', data.totals.present, UserCheck, 'Attendance recorded'],
            ['Absent today', data.totals.absent, UserX, 'After scheduled shift'],
            ['Late today', data.totals.late, Clock3, 'Past the grace period'],
            ['On leave today', data.totals.on_leave, CalendarDays, 'Approved leave'],
            ['Currently clocked in', data.totals.clocked_in, Play, 'Active shifts'],
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
      <div className="dashboard-panels">
        <section className="panel chart-panel">
          <div className="panel-heading">
            <div>
              <h2>{employee ? 'Your weekly attendance' : 'Weekly attendance'}</h2>
              <p>Recorded attendance over the last seven days</p>
            </div>
            <span className="subtle-pill">Last 7 days</span>
          </div>
          <AttendanceChart data={data.weekly} />
        </section>
        <section className="panel overview-panel">
          <div className="panel-heading">
            <div>
              <h2>{employee ? 'Your attendance today' : 'Today’s attendance overview'}</h2>
              <p>
                {employee
                  ? 'Your attendance for the current workday'
                  : 'A quick pulse on your team'}
              </p>
            </div>
          </div>
          <div
            className="ring-visual"
            style={
              {
                '--progress': `${Math.min(100, data.totals.employees ? (data.totals.present / data.totals.employees) * 100 : 0)}%`,
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
              <i className="dot green" />
              Present<strong>{data.totals.present}</strong>
            </span>
            <span>
              <i className="dot red" />
              Absent<strong>{data.totals.absent}</strong>
            </span>
            <span>
              <i className="dot amber" />
              On leave<strong>{data.totals.on_leave}</strong>
            </span>
          </div>
        </section>
      </div>
      {!employee && (
        <Link className="review-banner" to="/requests">
          <div className="review-icon">
            <ClipboardCheck size={23} />
          </div>
          <div>
            <strong>
              {data.pending_corrections
                ? `${data.pending_corrections} correction request${data.pending_corrections === 1 ? '' : 's'} awaiting review`
                : 'All caught up on correction requests'}
            </strong>
            <p>Keep attendance accurate before payroll review.</p>
          </div>
          <span>
            Review requests
            <ChevronRight size={17} />
          </span>
        </Link>
      )}
      <section className="panel">
        <div className="panel-heading">
          <div>
            <h2>Recent attendance activity</h2>
            <p>
              {employee
                ? 'Your latest recorded shifts'
                : 'The latest clock-ins and completed shifts'}
            </p>
          </div>
          <Link className="text-link" to="/dtr">
            View all records
            <ArrowUpRight size={16} />
          </Link>
        </div>
        {!data.activity.length ? (
          <State empty label="No attendance recorded yet." />
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Employee</th>
                  <th>Attendance date</th>
                  <th>Clock in</th>
                  <th>Clock out</th>
                  <th>Status</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {data.activity.map((r: any) => (
                  <tr key={r.id}>
                    <td>
                      <div className="employee-cell">
                        <span className="mini-avatar">
                          {r.name
                            .split(' ')
                            .map((s: string) => s[0])
                            .slice(0, 2)
                            .join('')}
                        </span>
                        <div>
                          <strong>{r.name}</strong>
                          <small>{r.employee_id}</small>
                        </div>
                      </div>
                    </td>
                    <td>{dateText(r.work_date)}</td>
                    <td>{timeText(r.clock_in)}</td>
                    <td>{timeText(r.clock_out, true)}</td>
                    <td>
                      <Badge status={r.clock_out ? 'PRESENT' : 'CLOCKED_IN'} />
                    </td>
                    <td>
                      <Link className="icon-button" to="/dtr" aria-label="View daily records">
                        <ChevronRight size={17} />
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
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
        {Icon === Users ? (
          <img className="stat-asset" src="/assets/total-employees.svg" alt="" />
        ) : (
          <Icon size={22} />
        )}
      </div>
      <strong>{value}</strong>
      {hint && <small>{hint}</small>}
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
