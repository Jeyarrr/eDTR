import { useEffect, useState } from 'react';
import { DateTime } from 'luxon';
import {
  CalendarDays,
  Download,
  FileSpreadsheet,
  LayoutGrid,
  List,
  SlidersHorizontal,
  Check,
  Pencil,
  Clock3,
  CheckCircle2,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import { useApp } from '../App';
import { post, query } from '../api';
import {
  Badge,
  dateText,
  Field,
  Form,
  hours,
  localDate,
  Modal,
  Notice,
  PageIntro,
  Pagination,
  SearchInput,
  State,
  timeText,
  toInputTime,
  toUtc,
  useResource,
  ZONE,
} from '../ui';
export function AttendancePage({ history = false }: { history?: boolean }) {
  const { user, revision, lookups, refresh, notify } = useApp(),
    manager = user.role !== 'EMPLOYEE';
  const [from, setFrom] = useState(
      history ? DateTime.now().setZone(ZONE).startOf('month').toISODate()! : localDate(),
    ),
    [to, setTo] = useState(localDate()),
    [search, setSearch] = useState(''),
    [department, setDepartment] = useState(''),
    [status, setStatus] = useState(''),
    [employee, setEmployee] = useState(''),
    [page, setPage] = useState(1),
    [calendar, setCalendar] = useState(false),
    [selected, setSelected] = useState<any>(null),
    [verify, setVerify] = useState<any>(null);
  useEffect(() => {
    setFrom(history ? DateTime.now().setZone(ZONE).startOf('month').toISODate()! : localDate());
    setTo(localDate());
    setPage(1);
    setCalendar(false);
  }, [history]);
  useEffect(() => setPage(1), [from, to, search, department, status, employee]);
  const filters = { from, to, search, department, status, user_id: employee };
  const calendarTo = DateTime.fromISO(from).endOf('month').toISODate()!;
  const { data, error, loading } = useResource(
    `/attendance?${query({ ...filters, ...(calendar ? { to: calendarTo < to ? calendarTo : to } : {}), page, page_size: calendar ? 100 : 15 })}`,
    revision,
  );
  const s = data?.summary;
  return (
    <>
      <PageIntro
        eyebrow={history ? 'DAILY TIME RECORDS' : 'ATTENDANCE MONITORING'}
        title={
          history
            ? manager
              ? 'Employee daily time records'
              : 'My daily time records'
            : manager
              ? 'Team attendance'
              : 'My attendance'
        }
        description={
          history
            ? 'Every workday, with the detail behind the totals.'
            : 'Track attendance, review completed shifts, and resolve missing records.'
        }
        actions={
          <>
            {!manager && !history && (
              <Link className="button primary" to="/">
                <Clock3 size={17} />
                Go to time clock
              </Link>
            )}
            <a className="button secondary" href={`/api/reports/dtr/pdf?${query(filters)}`}>
              <Download size={16} />
              PDF
            </a>
            <a className="button secondary" href={`/api/reports/dtr/xlsx?${query(filters)}`}>
              <FileSpreadsheet size={16} />
              Excel
            </a>
          </>
        }
      />
      {history && s && (
        <div className="dtr-summary">
          <Summary label="Scheduled days" value={s.scheduled_days} />
          <Summary label="Days present" value={s.present} />
          <Summary label="Days absent" value={s.absent} />
          <Summary label="Approved leave" value={s.on_leave} />
          <Summary label="Worked hours" value={hours(s.worked_minutes)} />
          <Summary label="Late minutes" value={s.late_minutes} />
          <Summary label="Approved overtime" value={hours(s.approved_overtime_minutes)} />
        </div>
      )}
      <section className="data-panel">
        <div className="filter-bar">
          <SearchInput value={search} onChange={setSearch} />
          <label className="filter-field">
            <span>From date</span>
            <input
              type="date"
              aria-label="From date"
              value={from}
              max={to}
              onChange={(e) => setFrom(e.target.value)}
            />
          </label>
          <label className="filter-field">
            <span>To date</span>
            <input
              type="date"
              aria-label="To date"
              value={to}
              min={from}
              onChange={(e) => setTo(e.target.value)}
            />
          </label>
          <label className="filter-field">
            <span>Attendance status</span>
            <select
              aria-label="Attendance status"
              value={status}
              onChange={(e) => setStatus(e.target.value)}
            >
              <option value="">All status</option>
              {[
                'PRESENT',
                'ABSENT',
                'ON_LEAVE',
                'CLOCKED_IN',
                'INCOMPLETE',
                'NOT_CLOCKED_IN',
                'REST_DAY',
                'HOLIDAY',
              ].map((s) => (
                <option key={s} value={s}>
                  {s.replaceAll('_', ' ')}
                </option>
              ))}
            </select>
          </label>
          {manager && (
            <>
              <label className="filter-field">
                <span>Department</span>
                <select
                  aria-label="Department filter"
                  value={department}
                  onChange={(e) => setDepartment(e.target.value)}
                >
                  <option value="">All departments</option>
                  {[
                    ...new Set<string>((lookups?.employees || []).map((e: any) => e.department)),
                  ].map((d) => (
                    <option key={d}>{d}</option>
                  ))}
                </select>
              </label>
              <label className="filter-field">
                <span>Employee</span>
                <select
                  aria-label="Employee filter"
                  value={employee}
                  onChange={(e) => setEmployee(e.target.value)}
                >
                  <option value="">All employees</option>
                  {lookups?.employees?.map((e: any) => (
                    <option key={e.id} value={e.id}>
                      {e.employee_id} · {e.name}
                    </option>
                  ))}
                </select>
              </label>
            </>
          )}
        </div>
        <div className="table-title">
          <div>
            <CalendarDays size={18} />
            <strong>{from === to ? dateText(from) : `${dateText(from)} – ${dateText(to)}`}</strong>
            <span className="subtle-pill">Asia/Manila</span>
          </div>
          {history && (
            <div className="segmented">
              <button
                aria-label="Table view"
                className={!calendar ? 'selected' : ''}
                onClick={() => setCalendar(false)}
              >
                <List size={17} />
              </button>
              <button
                aria-label="Calendar view"
                className={calendar ? 'selected' : ''}
                onClick={() => {
                  if (manager && !employee) {
                    notify('Select an employee to view their monthly DTR calendar.');
                    return;
                  }
                  setPage(1);
                  setCalendar(true);
                }}
              >
                <LayoutGrid size={17} />
              </button>
            </div>
          )}
        </div>
        {error || !data ? (
          <State error={error} loading={loading} />
        ) : calendar ? (
          <DtrCalendar records={data.records} from={from} onSelect={setSelected} />
        ) : !data.records.length ? (
          <State empty />
        ) : (
          <div className="table-wrap">
            <table className="attendance-table">
              <thead>
                <tr>
                  {history && <th>Date</th>}
                  <th>Employee</th>
                  <th>Schedule</th>
                  <th>Time In</th>
                  <th>Time Out</th>
                  <th>Hours</th>
                  {history && <th>Approved OT</th>}
                  <th>Status</th>
                  <th>Verification</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {data.records.map((r: any) => (
                  <tr key={`${r.user_id}-${r.work_date}`}>
                    {history && <td>{dateText(r.work_date)}</td>}
                    <td>
                      <div className="employee-cell">
                        <div>
                          <strong>{r.name}</strong>
                          <small>
                            {r.employee_id} · {r.department}
                          </small>
                        </div>
                      </div>
                    </td>
                    <td>
                      <strong className="plain-strong">
                        {r.schedule_snapshot.start_time} – {r.schedule_snapshot.end_time}
                      </strong>
                      <small className="cell-small">{r.schedule_snapshot.name}</small>
                    </td>
                    <td>{timeText(r.clock_in)}</td>
                    <td>
                      {timeText(
                        r.clock_out,
                        r.clock_out &&
                          DateTime.fromISO(r.clock_out, { zone: ZONE }).toISODate() !== r.work_date,
                      )}
                    </td>
                    <td>{r.id ? hours(r.worked_minutes) : '—'}</td>
                    {history && <td>{hours(r.approved_overtime_minutes)}</td>}
                    <td>
                      <div className="status-stack">
                        <Badge status={r.status} />
                        {r.late_minutes > 0 && (
                          <span className="late-indicator">
                            <Clock3 size={12} />
                            {r.late_minutes} min late
                          </span>
                        )}
                      </div>
                    </td>
                    <td>
                      {r.verified ? (
                        <span className="verified-label">
                          <CheckCircle2 size={15} />
                          Verified
                        </span>
                      ) : r.clock_out ? (
                        <span className="muted">For review</span>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td>
                      <div className="row-actions">
                        {manager && r.clock_out && !r.verified && (
                          <button className="button mini green" onClick={() => setVerify(r)}>
                            <Check size={13} />
                            Verify
                          </button>
                        )}
                        <button
                          className="button mini secondary"
                          aria-label={`View ${r.name} on ${r.work_date}`}
                          onClick={() => setSelected(r)}
                        >
                          View
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {data && !calendar && <Pagination page={page} total={data.total} onChange={setPage} />}
      </section>
      {manager && (
        <p className="page-note">
          <SlidersHorizontal size={15} />
          Employees record their own time. Administrative changes require a reason and an approval
          record.
        </p>
      )}
      {selected && <RecordModal record={selected} onClose={() => setSelected(null)} />}
      {verify && (
        <Modal title="Verify completed attendance" onClose={() => setVerify(null)}>
          <p className="modal-description">
            {verify.name} · {dateText(verify.work_date)}
          </p>
          <Notice>
            Verify the recorded times before payroll. Overtime is paid only when explicitly
            approved.
          </Notice>
          <Form
            submit="Verify attendance"
            onCancel={() => setVerify(null)}
            onSubmit={async (form) => {
              await post(`/attendance/${verify.id}/verify`, {
                approved_overtime_minutes: Number(form.get('overtime')),
              });
              refresh();
              notify('Attendance verified and ready for payroll.');
              setVerify(null);
            }}
          >
            <div className="detail-grid">
              <Summary label="Clock in" value={timeText(verify.clock_in, true)} />
              <Summary label="Clock out" value={timeText(verify.clock_out, true)} />
              <Summary label="Worked hours" value={hours(verify.worked_minutes)} />
              <Summary label="Recorded overtime" value={hours(verify.overtime_minutes)} />
            </div>
            <Field label="Approved overtime (minutes)">
              <input
                name="overtime"
                type="number"
                min={0}
                max={verify.overtime_minutes}
                defaultValue={verify.approved_overtime_minutes}
                required
              />
            </Field>
          </Form>
        </Modal>
      )}
    </>
  );
}
export function Summary({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="summary-item">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}
function RecordModal({ record: r, onClose }: { record: any; onClose: () => void }) {
  const [correcting, setCorrecting] = useState(false);
  const { user } = useApp();
  if (correcting) return <CorrectionModal record={r} onClose={onClose} />;
  return (
    <Modal title="Daily attendance record" onClose={onClose}>
      <div className="record-title">
        <span className="mini-avatar">
          {r.name
            .split(' ')
            .map((s: string) => s[0])
            .slice(0, 2)
            .join('')}
        </span>
        <div>
          <h3>{r.name}</h3>
          <p>
            {r.employee_id} · {dateText(r.work_date)}
          </p>
        </div>
        <Badge status={r.status} />
      </div>
      <div className="attendance-timeline">
        <div>
          <i />
          <span>
            Scheduled start<strong>{timeText(r.scheduled_in)}</strong>
          </span>
        </div>
        <div>
          <i />
          <span>
            Clock in<strong>{timeText(r.clock_in, true)}</strong>
          </span>
        </div>
        <div>
          <i />
          <span>
            Clock out<strong>{timeText(r.clock_out, true)}</strong>
          </span>
        </div>
      </div>
      <div className="detail-grid">
        <Summary label="Hours worked" value={hours(r.worked_minutes)} />
        <Summary label="Late minutes" value={r.late_minutes} />
        <Summary label="Approved overtime" value={hours(r.approved_overtime_minutes)} />
        <Summary label="Verification" value={r.verified ? 'Verified' : 'Pending'} />
      </div>
      {r.has_proof && (
        <div>
          <h3>Clock-in photo proof</h3>
          <img
            className="proof-preview"
            src={`/api/attendance/${r.id}/proof`}
            alt="Clock-in photo proof"
          />
        </div>
      )}
      {r.remarks && <Notice>{r.remarks}</Notice>}
      <p className="page-note">
        Break policy: {r.schedule_snapshot.break_minutes} minutes after{' '}
        {r.schedule_snapshot.break_after_minutes} minutes of elapsed time.
      </p>
      {r.work_date <= localDate() && !['ON_LEAVE', 'REST_DAY', 'HOLIDAY'].includes(r.status) && (
        <div className="form-actions">
          <button className="button primary" onClick={() => setCorrecting(true)}>
            <Pencil size={16} />
            {user.role === 'EMPLOYEE' ? 'Request a correction' : 'Submit correction for review'}
          </button>
        </div>
      )}
    </Modal>
  );
}
export function CorrectionModal({ record: r, onClose }: { record: any; onClose: () => void }) {
  const { refresh, notify } = useApp();
  return (
    <Modal title="Request an attendance correction" onClose={onClose}>
      <p className="modal-description">
        {r.name} · {r.employee_id} · {dateText(r.work_date)}
      </p>
      <Notice>
        Original times are preserved. Your requested change requires an authorized reviewer’s
        approval.
      </Notice>
      <div className="detail-grid">
        <Summary label="Original clock in" value={timeText(r.clock_in, true)} />
        <Summary label="Original clock out" value={timeText(r.clock_out, true)} />
      </div>
      <Form
        submit="Submit request"
        onCancel={onClose}
        onSubmit={async (form) => {
          await post('/corrections', {
            user_id: r.user_id,
            work_date: r.work_date,
            requested_in: toUtc(String(form.get('clock_in'))),
            requested_out: toUtc(String(form.get('clock_out'))),
            reason: form.get('reason'),
          });
          refresh();
          notify('Correction request submitted for review.');
          onClose();
        }}
      >
        <div className="form-grid">
          <Field label="Requested clock in (Asia/Manila)">
            <input
              name="clock_in"
              type="datetime-local"
              required
              defaultValue={toInputTime(r.clock_in || r.scheduled_in)}
            />
          </Field>
          <Field label="Requested clock out (Asia/Manila)">
            <input
              name="clock_out"
              type="datetime-local"
              required
              defaultValue={toInputTime(r.clock_out || r.scheduled_out)}
            />
          </Field>
        </div>
        <Field
          label="Reason for correction"
          hint="Explain what happened so the reviewer can verify the change."
        >
          <textarea
            name="reason"
            required
            minLength={10}
            maxLength={1000}
            rows={4}
            placeholder="For example: I forgot to clock out after finishing my shift…"
          />
        </Field>
      </Form>
    </Modal>
  );
}
function DtrCalendar({
  records,
  from,
  onSelect,
}: {
  records: any[];
  from: string;
  onSelect: (r: any) => void;
}) {
  const month = DateTime.fromISO(from, { zone: ZONE }).startOf('month'),
    offset = month.weekday - 1;
  return (
    <div className="calendar-view">
      <p className="calendar-caption">
        {month.toFormat('MMMM yyyy')} · Only records in your selected filters are shown.
      </p>
      <div className="calendar-grid">
        {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d) => (
          <strong className="calendar-day-name" key={d}>
            {d}
          </strong>
        ))}
        {Array.from({ length: offset }, (_, i) => (
          <div key={`empty-${i}`} className="calendar-day muted-day" />
        ))}
        {Array.from({ length: month.daysInMonth || 30 }, (_, i) => {
          const date = month.plus({ days: i }).toISODate()!,
            dayRecords = records.filter((r) => r.work_date === date);
          return (
            <div className={`calendar-day ${date === localDate() ? 'today' : ''}`} key={date}>
              <span>{i + 1}</span>
              {dayRecords.slice(0, 3).map((r) => (
                <button className="calendar-record" key={r.user_id} onClick={() => onSelect(r)}>
                  <Badge status={r.status} />
                  <small>
                    {r.employee_id} · {hours(r.worked_minutes)}
                  </small>
                </button>
              ))}
              {dayRecords.length > 3 && <small>+{dayRecords.length - 3} more records</small>}
            </div>
          );
        })}
      </div>
    </div>
  );
}
