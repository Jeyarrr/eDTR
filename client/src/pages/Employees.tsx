import { useState } from 'react';
import { Plus, UserRound, ShieldCheck, Copy, Pencil } from 'lucide-react';
import { useApp } from '../App';
import { post, put } from '../api';
import {
  Badge,
  Field,
  Form,
  money,
  Modal,
  Notice,
  PageIntro,
  Pagination,
  SearchInput,
  State,
  useResource,
} from '../ui';
import { Summary } from './Attendance';
export function EmployeesPage() {
  const { revision, user, refresh, notify } = useApp(),
    { data, error, loading } = useResource<any[]>('/employees', revision);
  const [search, setSearch] = useState(''),
    [page, setPage] = useState(1),
    [editing, setEditing] = useState<any>(null),
    [view, setView] = useState<any>(null),
    [status, setStatus] = useState<any>(null),
    [invitation, setInvitation] = useState('');
  const rows = (data || []).filter((e) =>
    `${e.name} ${e.employee_id} ${e.department}`.toLowerCase().includes(search.toLowerCase()),
  );
  return (
    <>
      <PageIntro
        eyebrow="PEOPLE & ACCESS"
        title="User management"
        description="Keep employee profiles, schedules, and access up to date."
        actions={
          <button className="button primary" onClick={() => setEditing({})}>
            <Plus size={17} />
            Add employee
          </button>
        }
      />
      <div className="employee-welcome">
        <div>
          <span className="eyebrow">YOUR TEAM, CONNECTED</span>
          <h2>A clear record starts with the right people.</h2>
          <p>
            {data?.filter((e) => e.active && e.role === 'EMPLOYEE').length || 0} active employees ·
            Accounts are created by invitation.
          </p>
        </div>
      </div>
      <section className="data-panel">
        <div className="filter-bar">
          <SearchInput
            value={search}
            onChange={(v) => {
              setSearch(v);
              setPage(1);
            }}
          />
          <span className="filter-hint">
            <ShieldCheck size={17} />
            Employee history is preserved when access is deactivated.
          </span>
        </div>
        {error || !data ? (
          <State loading={loading} error={error} />
        ) : !rows.length ? (
          <State empty />
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Employee</th>
                  <th>Department / Position</th>
                  <th>Email</th>
                  <th>Schedule</th>
                  <th>Role</th>
                  <th>Status</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {rows.slice((page - 1) * 15, page * 15).map((e) => (
                  <tr key={e.id}>
                    <td>
                      <div className="employee-cell">
                        <span className="mini-avatar">
                          {e.name
                            .split(' ')
                            .map((n: string) => n[0])
                            .slice(0, 2)
                            .join('')}
                        </span>
                        <div>
                          <strong>{e.name}</strong>
                          <small>{e.employee_id}</small>
                        </div>
                      </div>
                    </td>
                    <td>
                      {e.department}
                      <small className="cell-small">{e.position}</small>
                    </td>
                    <td>{e.email}</td>
                    <td>{e.schedule_name || 'Not assigned'}</td>
                    <td>
                      <span className="role-tag">{e.role}</span>
                    </td>
                    <td>
                      <Badge status={e.active ? 'ACTIVE' : 'INACTIVE'} />
                    </td>
                    <td>
                      <div className="row-actions">
                        <button className="button mini blue" onClick={() => setView(e)}>
                          View
                        </button>
                        <button className="button mini amber" onClick={() => setEditing(e)}>
                          Edit
                        </button>
                        {e.id !== user.id && (
                          <button className="button mini secondary" onClick={() => setStatus(e)}>
                            {e.active ? 'Deactivate' : 'Activate'}
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <Pagination page={page} total={rows.length} onChange={setPage} />
      </section>
      {editing && (
        <EmployeeForm
          employee={editing}
          onClose={() => setEditing(null)}
          onInvite={setInvitation}
        />
      )}
      {view && (
        <Modal title="Employee profile" onClose={() => setView(null)}>
          <div className="record-title">
            <UserRound size={32} />
            <div>
              <h3>{view.name}</h3>
              <p>
                {view.employee_id} · {view.email}
              </p>
            </div>
            <Badge status={view.active ? 'ACTIVE' : 'INACTIVE'} />
          </div>
          <div className="detail-grid">
            <Summary label="Department" value={view.department} />
            <Summary label="Position" value={view.position} />
            <Summary label="Schedule" value={view.schedule_name || 'Not assigned'} />
            <Summary label="Account role" value={view.role} />
            <Summary label="Hourly rate" value={money(view.hourly_rate_cents)} />
            <Summary label="Employment start" value={view.employment_from} />
          </div>
          <div className="form-actions">
            <button
              className="button primary"
              onClick={() => {
                setView(null);
                setEditing(view);
              }}
            >
              <Pencil size={16} />
              Edit profile
            </button>
          </div>
        </Modal>
      )}
      {status && (
        <Modal
          title={`${status.active ? 'Deactivate' : 'Activate'} employee`}
          onClose={() => setStatus(null)}
        >
          <Notice>
            {status.active
              ? `This will disable ${status.name}’s access and end their scheduled attendance from today. Attendance and payroll history will remain available.`
              : `This will restore ${status.name}’s access and scheduled attendance.`}
          </Notice>
          <Form
            submit={status.active ? 'Deactivate employee' : 'Activate employee'}
            onCancel={() => setStatus(null)}
            onSubmit={async () => {
              await post(`/employees/${status.id}/status`, { active: !status.active });
              refresh();
              notify('Employee account status updated.');
              setStatus(null);
            }}
          >
            <p className="modal-description">
              {status.name} · {status.employee_id}
            </p>
          </Form>
        </Modal>
      )}
      {invitation && (
        <Modal title="Employee invitation created" onClose={() => setInvitation('')}>
          <Notice success>
            The employee can use this private link to set their password. It expires after 48 hours.
          </Notice>
          <Field label="Account invitation link">
            <input readOnly value={invitation} />
          </Field>
          <button
            className="button primary"
            onClick={async () => {
              await navigator.clipboard.writeText(invitation);
              notify('Invitation link copied.');
            }}
          >
            <Copy size={16} />
            Copy invitation link
          </button>
        </Modal>
      )}
    </>
  );
}
function EmployeeForm({
  employee: e,
  onClose,
  onInvite,
}: {
  employee: any;
  onClose: () => void;
  onInvite: (link: string) => void;
}) {
  const { user, lookups, refresh, notify } = useApp();
  return (
    <Modal title={e.id ? 'Edit employee' : 'Add employee'} onClose={onClose} wide>
      <Notice>
        {e.id
          ? 'Schedule changes apply from today. Existing attendance retains its original schedule.'
          : 'An invitation will let the employee create their own password. Public registration is disabled.'}
      </Notice>
      <Form
        onCancel={onClose}
        submit={e.id ? 'Save changes' : 'Create invitation'}
        onSubmit={async (form) => {
          const input = Object.fromEntries(form);
          const payload = {
            ...input,
            hourly_rate_cents: Math.round(Number(form.get('hourly_rate')) * 100),
          };
          if (e.id) await put(`/employees/${e.id}`, payload);
          else {
            const result = await post('/employees', payload);
            onInvite(result.invitation_link);
          }
          refresh();
          notify(e.id ? 'Employee profile updated.' : 'Employee created and invitation prepared.');
          onClose();
        }}
      >
        <div className="form-grid">
          <Field label="Employee ID">
            <input
              name="employee_id"
              defaultValue={e.employee_id}
              placeholder="M04"
              pattern="[A-Z][A-Z0-9-]{2,19}"
              required
            />
          </Field>
          <Field label="Full name">
            <input name="name" defaultValue={e.name} required minLength={2} maxLength={100} />
          </Field>
          <Field label="Work email">
            <input name="email" type="email" defaultValue={e.email} required />
          </Field>
          <Field label="Department">
            <input name="department" defaultValue={e.department} required minLength={2} />
          </Field>
          <Field label="Position">
            <input name="position" defaultValue={e.position} required minLength={2} />
          </Field>
          <Field label="Work schedule">
            <select
              name="schedule_id"
              defaultValue={e.schedule_id || lookups?.schedules?.[0]?.id}
              required
            >
              {lookups?.schedules?.map((s: any) => (
                <option value={s.id} key={s.id}>
                  {s.name} · {s.start_time} – {s.end_time}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Account role">
            <select
              name="role"
              defaultValue={e.role || 'EMPLOYEE'}
              disabled={user.role !== 'ADMIN'}
            >
              <option value="EMPLOYEE">Employee</option>
              {user.role === 'ADMIN' && (
                <>
                  <option value="HR">HR</option>
                  <option value="ADMIN">Administrator</option>
                </>
              )}
            </select>
            {user.role !== 'ADMIN' && <input type="hidden" name="role" value="EMPLOYEE" />}
          </Field>
          <Field label="Hourly pay rate (PHP)">
            <input
              name="hourly_rate"
              type="number"
              min={0}
              step="0.01"
              defaultValue={(e.hourly_rate_cents ?? 10000) / 100}
              required
            />
          </Field>
        </div>
      </Form>
    </Modal>
  );
}
