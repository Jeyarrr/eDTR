import { useState } from 'react';
import { CalendarDays, Plus, ArrowRight, ClipboardCheck } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useApp } from '../App';
import { post } from '../api';
import {
  Badge,
  dateText,
  Field,
  Form,
  localDate,
  Modal,
  Notice,
  PageIntro,
  State,
  timeText,
  useResource,
} from '../ui';
export function RequestsPage() {
  const { user, revision, lookups, refresh, notify } = useApp(),
    manager = user.role !== 'EMPLOYEE';
  const corrections = useResource<any[]>('/corrections', revision),
    leaves = useResource<any[]>('/leaves', revision);
  const [tab, setTab] = useState('corrections'),
    [filter, setFilter] = useState(''),
    [review, setReview] = useState<any>(null),
    [leaveForm, setLeaveForm] = useState(false),
    [detail, setDetail] = useState<any>(null);
  const resource = tab === 'corrections' ? corrections : leaves,
    rows = resource.data?.filter((r) => !filter || r.status === filter) || [];
  const pending = (resource.data || []).filter((r) => r.status === 'PENDING').length;
  return (
    <>
      <PageIntro
        eyebrow="ATTENDANCE ACCURACY"
        title={manager ? 'Requests & approvals' : 'My requests'}
        description="A transparent process for corrections and time away."
        actions={
          <button className="button primary" onClick={() => setLeaveForm(true)}>
            <Plus size={17} />
            Request leave
          </button>
        }
      />
      <div className="request-tabs">
        <div className="tabs">
          <button
            className={tab === 'corrections' ? 'active' : ''}
            onClick={() => setTab('corrections')}
          >
            <ClipboardCheck size={17} />
            Attendance corrections
            <span>{corrections.data?.filter((r) => r.status === 'PENDING').length || 0}</span>
          </button>
          <button className={tab === 'leaves' ? 'active' : ''} onClick={() => setTab('leaves')}>
            <CalendarDays size={17} />
            Leave requests
            <span>{leaves.data?.filter((r) => r.status === 'PENDING').length || 0}</span>
          </button>
        </div>
        <select
          aria-label="Request status"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        >
          <option value="">All requests</option>
          <option>PENDING</option>
          <option>APPROVED</option>
          <option>REJECTED</option>
        </select>
      </div>
      {tab === 'corrections' && (
        <Notice>
          To request a correction, open a daily record in{' '}
          <Link to="/dtr">{manager ? 'Employee Log' : 'My DTR'}</Link>. Both original and requested
          times are kept in the review history.
        </Notice>
      )}
      <section className="panel">
        <div className="panel-heading">
          <div>
            <h2>{tab === 'corrections' ? 'Attendance correction requests' : 'Leave requests'}</h2>
            <p>
              {pending} awaiting review · {resource.data?.length || 0} total requests
            </p>
          </div>
        </div>
        {resource.error || !resource.data ? (
          <State loading={resource.loading} error={resource.error} />
        ) : !rows.length ? (
          <State empty label="No requests to show." />
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Employee</th>
                  <th>{tab === 'corrections' ? 'Attendance date' : 'Leave period'}</th>
                  <th>Reason</th>
                  <th>Submitted</th>
                  <th>Status</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td>
                      <strong>{r.name}</strong>
                      <small className="cell-small">{r.employee_id}</small>
                    </td>
                    <td>
                      {tab === 'corrections'
                        ? dateText(r.work_date)
                        : `${dateText(r.start_date)} – ${dateText(r.end_date)}`}
                    </td>
                    <td className="reason-cell">{r.reason}</td>
                    <td>{timeText(r.created_at, true)}</td>
                    <td>
                      <Badge status={r.status} />
                    </td>
                    <td>
                      <div className="row-actions">
                        <button
                          className="button mini secondary"
                          onClick={() => setDetail({ ...r, kind: tab })}
                        >
                          View
                        </button>
                        {manager && r.status === 'PENDING' && r.user_id !== user.id && (
                          <button
                            className="button mini blue"
                            onClick={() => setReview({ ...r, kind: tab })}
                          >
                            Review
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
      </section>
      {detail && (
        <Modal
          title={detail.kind === 'corrections' ? 'Correction history' : 'Leave request'}
          onClose={() => setDetail(null)}
          wide
        >
          <RequestDetails request={detail} />
          {detail.review_note && (
            <div className="review-note">
              <strong>Reviewer’s note</strong>
              <p>{detail.review_note}</p>
              <small>
                {detail.reviewer_name || 'Authorized reviewer'}
                {detail.reviewed_at ? ` · ${timeText(detail.reviewed_at, true)}` : ''}
              </small>
            </div>
          )}
          {manager && detail.status === 'PENDING' && detail.user_id !== user.id && (
            <div className="form-actions">
              <button
                className="button primary"
                onClick={() => {
                  setReview(detail);
                  setDetail(null);
                }}
              >
                Review request
                <ArrowRight size={16} />
              </button>
            </div>
          )}
        </Modal>
      )}
      {review && (
        <Modal title="Review attendance request" onClose={() => setReview(null)} wide>
          <RequestDetails request={review} />
          <Form
            submit="Submit decision"
            onCancel={() => setReview(null)}
            onSubmit={async (form) => {
              await post(`/${review.kind}/${review.id}/review`, {
                status: form.get('status'),
                note: form.get('note'),
              });
              refresh();
              notify(
                'Request reviewed. The decision and original values are saved in the audit history.',
              );
              setReview(null);
            }}
          >
            <div className="form-grid">
              <Field label="Decision">
                <select name="status" required>
                  <option value="APPROVED">Approve request</option>
                  <option value="REJECTED">Reject request</option>
                </select>
              </Field>
            </div>
            <Field
              label="Review note"
              hint="Explain your decision for the employee and audit record."
            >
              <textarea name="note" minLength={10} maxLength={1000} rows={3} required />
            </Field>
          </Form>
        </Modal>
      )}
      {leaveForm && (
        <Modal title="Request leave" onClose={() => setLeaveForm(false)}>
          <Form
            submit="Submit leave request"
            onCancel={() => setLeaveForm(false)}
            onSubmit={async (form) => {
              await post('/leaves', Object.fromEntries(form));
              refresh();
              notify('Leave request submitted. It will appear in attendance after approval.');
              setLeaveForm(false);
            }}
          >
            {manager && (
              <Field label="Employee">
                <select name="user_id" required>
                  {lookups?.employees
                    ?.filter((e: any) => e.active)
                    .map((e: any) => (
                      <option value={e.id} key={e.id}>
                        {e.employee_id} · {e.name}
                      </option>
                    ))}
                </select>
              </Field>
            )}
            <div className="form-grid">
              <Field label="From date">
                <input name="start_date" type="date" required defaultValue={localDate()} />
              </Field>
              <Field label="To date">
                <input name="end_date" type="date" required defaultValue={localDate()} />
              </Field>
            </div>
            <Field label="Reason for leave">
              <textarea name="reason" required minLength={10} maxLength={1000} rows={4} />
            </Field>
            <Notice>
              Leave requires an authorized reviewer’s approval. The configured hourly policy pays
              verified working time; leave is not automatically paid.
            </Notice>
          </Form>
        </Modal>
      )}
    </>
  );
}
function RequestDetails({ request: r }: { request: any }) {
  return (
    <>
      <div className="record-title">
        <ClipboardCheck size={30} />
        <div>
          <h3>{r.name}</h3>
          <p>
            {r.employee_id} ·{' '}
            {r.kind === 'corrections'
              ? dateText(r.work_date)
              : `${dateText(r.start_date)} – ${dateText(r.end_date)}`}
          </p>
        </div>
        <Badge status={r.status} />
      </div>
      {r.kind === 'corrections' && (
        <div className="correction-comparison">
          <div>
            <span className="eyebrow">ORIGINAL RECORD</span>
            <p>
              Clock in<strong>{timeText(r.original.clock_in, true)}</strong>
            </p>
            <p>
              Clock out<strong>{timeText(r.original.clock_out, true)}</strong>
            </p>
          </div>
          <ArrowRight size={22} />
          <div>
            <span className="eyebrow">REQUESTED CORRECTION</span>
            <p>
              Clock in<strong>{timeText(r.requested_in, true)}</strong>
            </p>
            <p>
              Clock out<strong>{timeText(r.requested_out, true)}</strong>
            </p>
          </div>
        </div>
      )}
      <div className="review-note">
        <strong>Reason for request</strong>
        <p>{r.reason}</p>
      </div>
    </>
  );
}
