import { useState } from 'react';
import { Plus, CalendarClock, Coffee, Clock3, CalendarDays } from 'lucide-react';
import { useApp } from '../App';
import { api, post } from '../api';
import {
  Field,
  Form,
  localDate,
  Modal,
  Notice,
  PageIntro,
  Pagination,
  State,
  timeText,
  dateText,
  useResource,
} from '../ui';
export function SchedulesPage() {
  const { lookups, refresh, notify } = useApp(),
    [create, setCreate] = useState(false),
    [holiday, setHoliday] = useState(false),
    [remove, setRemove] = useState<any>(null);
  return (
    <>
      <PageIntro
        eyebrow="WORKDAY CONFIGURATION"
        title="Work schedules"
        description="Define clear start times, breaks, grace periods, and rest days."
        actions={
          <button className="button primary" onClick={() => setCreate(true)}>
            <Plus size={17} />
            Create schedule
          </button>
        }
      />
      <Notice>
        Schedules are kept as versions to preserve historical calculations. Create a new schedule
        and assign it from User Management when a policy changes.
      </Notice>
      <div className="schedule-grid">
        {lookups?.schedules?.map((s: any) => (
          <section className="panel schedule-card" key={s.id}>
            <div className="schedule-icon">
              <CalendarClock size={24} />
            </div>
            <h2>{s.name}</h2>
            <strong className="shift-hours">
              {s.start_time} – {s.end_time}
            </strong>
            {s.end_time <= s.start_time && <span className="subtle-pill">Overnight shift</span>}
            <ul>
              <li>
                <Clock3 size={16} />
                {s.grace_minutes} minute grace period
              </li>
              <li>
                <Coffee size={16} />
                {s.break_minutes} minute break after {s.break_after_minutes} minutes
              </li>
              <li>
                <CalendarDays size={16} />
                {s.work_days
                  .map((d: number) => ['', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'][d])
                  .join(', ')}
              </li>
            </ul>
          </section>
        ))}
      </div>
      <section className="panel">
        <div className="panel-heading">
          <div>
            <h2>Holiday calendar</h2>
            <p>Configured holidays are excluded from scheduled workdays.</p>
          </div>
          <button className="button secondary" onClick={() => setHoliday(true)}>
            <Plus size={16} />
            Add holiday
          </button>
        </div>
        {!lookups?.holidays?.length ? (
          <State empty label="No holidays configured." />
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Holiday</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {lookups.holidays.map((h: any) => (
                  <tr key={h.date}>
                    <td>{dateText(h.date)}</td>
                    <td>{h.name}</td>
                    <td>
                      {h.date >= localDate() ? (
                        <button className="button mini secondary" onClick={() => setRemove(h)}>
                          Remove
                        </button>
                      ) : (
                        <span className="muted">Historical</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      {create && (
        <Modal title="Create work schedule" onClose={() => setCreate(false)} wide>
          <Form
            submit="Create schedule"
            onCancel={() => setCreate(false)}
            onSubmit={async (form) => {
              const input = Object.fromEntries(form);
              await post('/schedules', {
                ...input,
                grace_minutes: Number(input.grace_minutes),
                break_minutes: Number(input.break_minutes),
                break_after_minutes: Number(input.break_after_minutes),
                work_days: form.getAll('work_days').map(Number),
              });
              refresh();
              notify('Schedule created. Assign it to employees in User Management.');
              setCreate(false);
            }}
          >
            <Field label="Schedule name">
              <input name="name" required minLength={2} placeholder="Regular day shift" />
            </Field>
            <div className="form-grid">
              <Field label="Shift start">
                <input name="start_time" type="time" required defaultValue="08:00" />
              </Field>
              <Field label="Shift end">
                <input name="end_time" type="time" required defaultValue="17:00" />
              </Field>
              <Field label="Grace period (minutes)">
                <input
                  name="grace_minutes"
                  type="number"
                  min={0}
                  max={120}
                  required
                  defaultValue={5}
                />
              </Field>
              <Field label="Break duration (minutes)">
                <input
                  name="break_minutes"
                  type="number"
                  min={0}
                  max={240}
                  required
                  defaultValue={60}
                />
              </Field>
              <Field label="Deduct break after elapsed minutes">
                <input
                  name="break_after_minutes"
                  type="number"
                  min={0}
                  max={1440}
                  required
                  defaultValue={360}
                />
              </Field>
            </div>
            <fieldset className="weekday-fieldset">
              <legend>Scheduled workdays</legend>
              {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d, i) => (
                <label key={d}>
                  <input type="checkbox" name="work_days" value={i + 1} defaultChecked={i < 5} />
                  {d}
                </label>
              ))}
            </fieldset>
            <Notice>
              An end time before or equal to the start time defines an overnight shift. Late minutes
              are recorded after the grace period; payroll uses worked minutes to avoid duplicate
              deductions.
            </Notice>
          </Form>
        </Modal>
      )}
      {holiday && (
        <Modal title="Configure holiday" onClose={() => setHoliday(false)}>
          <Form
            onCancel={() => setHoliday(false)}
            submit="Save holiday"
            onSubmit={async (form) => {
              await post('/holidays', Object.fromEntries(form));
              refresh();
              notify('Holiday calendar updated.');
              setHoliday(false);
            }}
          >
            <Field label="Holiday date">
              <input
                type="date"
                name="date"
                min={localDate()}
                required
                defaultValue={localDate()}
              />
            </Field>
            <Field label="Holiday name">
              <input name="name" required minLength={2} />
            </Field>
          </Form>
        </Modal>
      )}
      {remove && (
        <Modal title="Remove configured holiday" onClose={() => setRemove(null)}>
          <Notice>
            {remove.name} on {dateText(remove.date)} will become a scheduled workday for applicable
            schedules.
          </Notice>
          <Form
            submit="Remove holiday"
            onCancel={() => setRemove(null)}
            onSubmit={async () => {
              await api(`/holidays/${remove.date}`, { method: 'DELETE' });
              refresh();
              notify('Holiday removed.');
              setRemove(null);
            }}
          >
            <span />
          </Form>
        </Modal>
      )}
    </>
  );
}
export function AuditPage() {
  const { revision } = useApp(),
    [page, setPage] = useState(1),
    [detail, setDetail] = useState<any>(null),
    { data, error, loading } = useResource(`/audit?page=${page}`, revision);
  return (
    <>
      <PageIntro
        eyebrow="ACCOUNTABILITY & HISTORY"
        title="Audit logs"
        description="A permanent record of timekeeping, account changes, and approvals."
      />
      <section className="panel">
        <div className="panel-heading">
          <div>
            <h2>System activity</h2>
            <p>Events are recorded with the server timestamp.</p>
          </div>
        </div>
        {error || !data ? (
          <State error={error} loading={loading} />
        ) : !data.records.length ? (
          <State empty />
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Timestamp · Asia/Manila</th>
                  <th>Actor</th>
                  <th>Event</th>
                  <th>Record type</th>
                  <th>Details</th>
                </tr>
              </thead>
              <tbody>
                {data.records.map((r: any) => (
                  <tr key={r.id}>
                    <td>{timeText(r.created_at, true)}</td>
                    <td>{r.actor_name || 'System'}</td>
                    <td>
                      <span className="audit-event">{r.action.replaceAll('_', ' ')}</span>
                    </td>
                    <td>{r.entity_type}</td>
                    <td>
                      <button className="button mini secondary" onClick={() => setDetail(r)}>
                        View details
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {data && <Pagination page={page} size={30} total={data.total} onChange={setPage} />}
      </section>
      {detail && (
        <Modal title="Audit event details" onClose={() => setDetail(null)} wide>
          <p className="modal-description">
            {detail.action.replaceAll('_', ' ')} · {timeText(detail.created_at, true)}
          </p>
          <p>Recorded by {detail.actor_name || 'System'}</p>
          <pre className="audit-details">{JSON.stringify(detail.details, null, 2)}</pre>
          <small className="muted">Record reference: {detail.entity_id}</small>
        </Modal>
      )}
    </>
  );
}
