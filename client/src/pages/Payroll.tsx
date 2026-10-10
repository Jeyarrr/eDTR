import { useState } from 'react';
import { DateTime } from 'luxon';
import {
  Calculator,
  Download,
  Settings2,
  ArrowRight,
  ShieldCheck,
  Banknote,
  RotateCcw,
} from 'lucide-react';
import { useApp } from '../App';
import { post, put } from '../api';
import {
  Badge,
  dateText,
  Field,
  Form,
  hours,
  localDate,
  Modal,
  money,
  Notice,
  PageIntro,
  Pagination,
  SearchInput,
  State,
  useResource,
} from '../ui';
import { Summary } from './Attendance';
export function PayrollPage() {
  const { user, lookups, revision, refresh, notify } = useApp(),
    manager = user.role !== 'EMPLOYEE';
  const { data, error, loading } = useResource<any[]>('/payroll', revision);
  const [calculate, setCalculate] = useState(false),
    [selected, setSelected] = useState<any>(null),
    [transition, setTransition] = useState<any>(null),
    [adjust, setAdjust] = useState<any>(null),
    [policy, setPolicy] = useState(false),
    [search, setSearch] = useState(''),
    [page, setPage] = useState(1),
    [filter, setFilter] = useState('');
  const records = (data || []).filter(
    (r) =>
      (!filter || r.status === filter) &&
      `${r.name} ${r.employee_id}`.toLowerCase().includes(search.toLowerCase()),
  );
  const approved = (data || []).filter((r) => ['APPROVED', 'PAID'].includes(r.status)),
    drafts = (data || []).filter((r) => ['DRAFT', 'FOR_REVIEW'].includes(r.status));
  return (
    <>
      <PageIntro
        eyebrow={
          manager ? 'VERIFIED ATTENDANCE → REVIEW → APPROVAL' : 'YOUR EARNINGS, CLEARLY RECORDED'
        }
        title={manager ? 'Payroll management' : 'My payslips'}
        description={
          manager
            ? 'Turn verified time records into accurate, auditable payroll.'
            : 'View approved payroll and download your payslips.'
        }
        actions={
          manager && (
            <>
              {user.role === 'ADMIN' && (
                <button className="button secondary" onClick={() => setPolicy(true)}>
                  <Settings2 size={17} />
                  Pay policy
                </button>
              )}
              <button className="button primary" onClick={() => setCalculate(true)}>
                <Calculator size={17} />
                Calculate payroll
              </button>
            </>
          )
        }
      />
      {manager && (
        <div className="payroll-flow">
          <span>
            <ShieldCheck size={17} />
            Verified attendance
          </span>
          <ArrowRight size={15} />
          <span>Calculation</span>
          <ArrowRight size={15} />
          <span>Review & approval</span>
          <ArrowRight size={15} />
          <span>
            <Banknote size={17} />
            Payslip
          </span>
        </div>
      )}
      <div className="dtr-summary payroll-summary">
        <Summary
          label="Approved net pay"
          value={money(approved.reduce((s, r) => s + r.calculation.net_cents, 0))}
        />
        <Summary label="Pending review" value={drafts.length} />
        <Summary label="Approved records" value={approved.length} />
        <Summary label="Paid records" value={approved.filter((r) => r.status === 'PAID').length} />
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
          <label className="filter-field">
            <span>Payroll status</span>
            <select
              aria-label="Payroll status filter"
              value={filter}
              onChange={(e) => {
                setFilter(e.target.value);
                setPage(1);
              }}
            >
              <option value="">All status</option>
              {['DRAFT', 'FOR_REVIEW', 'APPROVED', 'PAID'].map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
          </label>
          <span className="filter-hint">PHP · Amounts use verified worked minutes</span>
        </div>
        {error || !data ? (
          <State error={error} loading={loading} />
        ) : !records.length ? (
          <State empty label={manager ? 'No payroll records yet.' : 'No approved payslips yet.'} />
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Employee</th>
                  <th>Pay period</th>
                  <th>Verified days / Hours</th>
                  <th>Gross pay</th>
                  <th>Deductions</th>
                  <th>Net pay</th>
                  <th>Status</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {records.slice((page - 1) * 15, page * 15).map((r) => (
                  <tr key={r.id}>
                    <td>
                      <strong>{r.name}</strong>
                      <small className="cell-small">
                        {r.employee_id}
                        {r.adjustment_of ? ' · Adjustment' : ''}
                      </small>
                    </td>
                    <td>
                      {dateText(r.start_date)}
                      <small className="cell-small">to {dateText(r.end_date)}</small>
                    </td>
                    <td>
                      {r.calculation.verified_days} days
                      <small className="cell-small">{hours(r.calculation.worked_minutes)}</small>
                    </td>
                    <td>{money(r.calculation.gross_cents)}</td>
                    <td>{money(r.calculation.deductions_cents)}</td>
                    <td>
                      <strong className="net-pay">{money(r.calculation.net_cents)}</strong>
                    </td>
                    <td>
                      <Badge status={r.status} />
                    </td>
                    <td>
                      <button className="button mini blue" onClick={() => setSelected(r)}>
                        View
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <Pagination page={page} total={records.length} onChange={setPage} />
      </section>
      {manager && (
        <Notice>
          Payroll uses verified, complete attendance only. Absences, lateness, and undertime already
          reduce hourly earnings; they are not deducted a second time.
        </Notice>
      )}
      {calculate && (
        <Modal title="Calculate payroll" onClose={() => setCalculate(false)}>
          <Notice>
            Complete attendance verification and review pending corrections before calculating a
            finished pay period.
          </Notice>
          <Form
            submit="Calculate draft payroll"
            onCancel={() => setCalculate(false)}
            onSubmit={async (form) => {
              await post('/payroll/calculate', Object.fromEntries(form));
              refresh();
              notify('Payroll draft calculated from verified attendance.');
              setCalculate(false);
            }}
          >
            <Field label="Employee">
              <select name="user_id" required>
                {lookups?.employees?.map((e: any) => (
                  <option key={e.id} value={e.id}>
                    {e.employee_id} · {e.name}
                  </option>
                ))}
              </select>
            </Field>
            <div className="form-grid">
              <Field label="Period start">
                <input
                  name="start_date"
                  type="date"
                  required
                  defaultValue={DateTime.now().minus({ months: 1 }).startOf('month').toISODate()!}
                />
              </Field>
              <Field label="Period end">
                <input
                  name="end_date"
                  type="date"
                  max={DateTime.fromISO(localDate()).minus({ days: 1 }).toISODate()!}
                  required
                  defaultValue={DateTime.now().minus({ months: 1 }).endOf('month').toISODate()!}
                />
              </Field>
            </div>
          </Form>
        </Modal>
      )}
      {selected && (
        <Modal
          title={selected.adjustment_of ? 'Payroll adjustment' : 'Payroll record'}
          onClose={() => setSelected(null)}
          wide
        >
          <div className="record-title">
            <Banknote size={30} />
            <div>
              <h3>{selected.name}</h3>
              <p>
                {selected.employee_id} · {dateText(selected.start_date)} –{' '}
                {dateText(selected.end_date)}
              </p>
            </div>
            <Badge status={selected.status} />
          </div>
          <div className="detail-grid">
            <Summary label="Hourly rate" value={money(selected.calculation.rate_cents)} />
            <Summary
              label="Verified attendance"
              value={`${selected.calculation.verified_days} days · ${hours(selected.calculation.worked_minutes)}`}
            />
            <Summary
              label="Days absent / leave"
              value={`${selected.calculation.absent_days} / ${selected.calculation.leave_days}`}
            />
            <Summary
              label="Approved overtime"
              value={hours(selected.calculation.approved_overtime_minutes)}
            />
          </div>
          <div className="pay-breakdown">
            {[
              ['Base earnings', selected.calculation.base_cents],
              ['Approved overtime pay', selected.calculation.overtime_cents],
              ['Other earnings', selected.calculation.other_earnings_cents],
              ['Gross pay', selected.calculation.gross_cents],
              ['Configured contributions', selected.calculation.contribution_cents],
              ['Other deductions', selected.calculation.other_deduction_cents],
              ['Total deductions', selected.calculation.deductions_cents],
              ['Net pay', selected.calculation.net_cents],
            ].map(([label, value]) => (
              <div className={label === 'Net pay' ? 'pay-total' : ''} key={String(label)}>
                <span>{label}</span>
                <strong>{money(Number(value))}</strong>
              </div>
            ))}
          </div>
          <Notice>{selected.calculation.method}</Notice>
          {selected.adjustment_reason && (
            <p className="review-note">Adjustment reason: {selected.adjustment_reason}</p>
          )}
          <div className="form-actions wrap">
            {['APPROVED', 'PAID'].includes(selected.status) && (
              <a className="button secondary" href={`/api/payroll/${selected.id}/payslip`}>
                <Download size={16} />
                Download payslip
              </a>
            )}
            {manager &&
              selected.status === 'DRAFT' &&
              (!selected.adjustment_of || user.role === 'ADMIN') && (
                <button
                  className="button secondary"
                  onClick={async () => {
                    try {
                      if (selected.adjustment_of) {
                        await post(`/payroll/${selected.id}/recalculate-adjustment`);
                      } else {
                        await post('/payroll/calculate', {
                          user_id: selected.user_id,
                          start_date: selected.start_date,
                          end_date: selected.end_date,
                        });
                      }
                      refresh();
                      setSelected(null);
                      notify('Payroll recalculated.');
                    } catch (e: any) {
                      notify(e.message);
                    }
                  }}
                >
                  <RotateCcw size={16} />
                  Recalculate
                </button>
              )}
            {manager && selected.status === 'DRAFT' && (
              <button
                className="button primary"
                onClick={() => {
                  setTransition({ ...selected, next: 'FOR_REVIEW' });
                  setSelected(null);
                }}
              >
                Submit for review
                <ArrowRight size={16} />
              </button>
            )}
            {user.role === 'ADMIN' && selected.status === 'FOR_REVIEW' && (
              <button
                className="button primary"
                onClick={() => {
                  setTransition({ ...selected, next: 'APPROVED' });
                  setSelected(null);
                }}
              >
                Approve payroll
              </button>
            )}
            {user.role === 'ADMIN' && selected.status === 'APPROVED' && (
              <button
                className="button primary"
                onClick={() => {
                  setTransition({ ...selected, next: 'PAID' });
                  setSelected(null);
                }}
              >
                Mark as paid
              </button>
            )}
            {user.role === 'ADMIN' &&
              ['APPROVED', 'PAID'].includes(selected.status) &&
              !selected.adjustment_of && (
                <button
                  className="button primary"
                  onClick={() => {
                    setAdjust(selected);
                    setSelected(null);
                  }}
                >
                  Create adjustment
                </button>
              )}
          </div>
        </Modal>
      )}
      {transition && (
        <Modal
          title={
            transition.next === 'FOR_REVIEW'
              ? 'Submit payroll for review'
              : transition.next === 'APPROVED'
                ? 'Approve payroll'
                : 'Confirm payroll payment'
          }
          onClose={() => setTransition(null)}
        >
          <Notice>
            {transition.next === 'APPROVED'
              ? 'Approval locks this payroll snapshot. Later changes require a separate authorized adjustment.'
              : transition.next === 'PAID'
                ? 'Mark this record as paid only after the payment has been completed.'
                : 'Attendance and pay policy are checked again before submission.'}
          </Notice>
          <div className="detail-grid">
            <Summary label="Employee" value={transition.name} />
            <Summary label="Net pay" value={money(transition.calculation.net_cents)} />
          </div>
          <Form
            submit={
              transition.next === 'FOR_REVIEW'
                ? 'Submit for review'
                : transition.next === 'APPROVED'
                  ? 'Approve payroll'
                  : 'Confirm paid'
            }
            onCancel={() => setTransition(null)}
            onSubmit={async () => {
              await post(`/payroll/${transition.id}/status`, { status: transition.next });
              refresh();
              notify('Payroll status updated and recorded in the audit history.');
              setTransition(null);
            }}
          >
            <span />
          </Form>
        </Modal>
      )}
      {adjust && (
        <Modal title="Create authorized payroll adjustment" onClose={() => setAdjust(null)}>
          <Notice>
            The original payroll is preserved. The adjustment contains the difference between
            recalculated earnings and previously approved amounts.
          </Notice>
          <Form
            submit="Calculate adjustment"
            onCancel={() => setAdjust(null)}
            onSubmit={async (form) => {
              await post(`/payroll/${adjust.id}/adjust`, { reason: form.get('reason') });
              refresh();
              notify('Adjustment draft created. Review and approve it separately.');
              setAdjust(null);
            }}
          >
            <Field label="Reason for adjustment">
              <textarea name="reason" required minLength={10} rows={4} />
            </Field>
          </Form>
        </Modal>
      )}
      {policy && <PolicyModal onClose={() => setPolicy(false)} />}
    </>
  );
}
function PolicyModal({ onClose }: { onClose: () => void }) {
  const { revision, refresh, notify } = useApp(),
    { data, error, loading } = useResource('/payroll/policy', revision);
  return (
    <Modal title="Configure payroll policy" onClose={onClose}>
      <Notice>
        Set the organization’s approved policy. Contributions and deductions are configurable
        amounts per payroll period, with no assumed government rates.
      </Notice>
      {!data ? (
        <State error={error} loading={loading} />
      ) : (
        <Form
          submit="Save pay policy"
          onCancel={onClose}
          onSubmit={async (form) => {
            await put('/payroll/policy', {
              overtime_multiplier: Number(form.get('overtime_multiplier')),
              contribution_cents: Math.round(Number(form.get('contributions')) * 100),
              other_deduction_cents: Math.round(Number(form.get('deductions')) * 100),
              other_earnings_cents: Math.round(Number(form.get('earnings')) * 100),
            });
            refresh();
            notify('Pay policy saved. Recalculate existing drafts before approval.');
            onClose();
          }}
        >
          <Field label="Approved overtime multiplier">
            <input
              name="overtime_multiplier"
              type="number"
              min={1}
              max={5}
              step="0.01"
              required
              defaultValue={data.overtime_multiplier}
            />
          </Field>
          <div className="form-grid">
            <Field label="Contributions per period (PHP)">
              <input
                name="contributions"
                type="number"
                min={0}
                step="0.01"
                required
                defaultValue={data.contribution_cents / 100}
              />
            </Field>
            <Field label="Other deductions per period (PHP)">
              <input
                name="deductions"
                type="number"
                min={0}
                step="0.01"
                required
                defaultValue={data.other_deduction_cents / 100}
              />
            </Field>
            <Field label="Other earnings per period (PHP)">
              <input
                name="earnings"
                type="number"
                min={0}
                step="0.01"
                required
                defaultValue={data.other_earnings_cents / 100}
              />
            </Field>
          </div>
        </Form>
      )}
    </Modal>
  );
}
