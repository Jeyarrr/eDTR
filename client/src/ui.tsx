import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import {
  X,
  AlertCircle,
  CheckCircle2,
  Search,
  ChevronLeft,
  ChevronRight,
  Loader2,
} from 'lucide-react';
import { DateTime } from 'luxon';
import { api } from './api';
export const ZONE = 'Asia/Manila';
export const localDate = () => DateTime.now().setZone(ZONE).toISODate()!;
export const dateText = (d: string) => DateTime.fromISO(d, { zone: ZONE }).toFormat('MMM dd, yyyy');
export const timeText = (d: string | null, full = false) =>
  d ? DateTime.fromISO(d, { zone: ZONE }).toFormat(full ? 'MMM dd · hh:mm a' : 'hh:mm a') : '—';
export const hours = (m: number = 0) => `${(m / 60).toFixed(2)} h`;
export const money = (c: number = 0) =>
  new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP' }).format(c / 100);
export const toInputTime = (v: string) =>
  v ? DateTime.fromISO(v, { zone: ZONE }).toFormat("yyyy-MM-dd'T'HH:mm") : '';
export const toUtc = (v: string) => DateTime.fromISO(v, { zone: ZONE }).toUTC().toISO()!;
export function useResource<T = any>(path: string, revision = 0) {
  const [data, setData] = useState<T | null>(null),
    [error, setError] = useState(''),
    [loading, setLoading] = useState(true);
  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError('');
    api<T>(path)
      .then((v) => {
        if (alive) setData(v);
      })
      .catch((e) => {
        if (alive) setError(e.message);
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [path, revision]);
  return { data, error, loading, setData };
}
export function State({
  loading,
  error,
  empty = false,
  label = 'No records yet.',
}: {
  loading?: boolean;
  error?: string;
  empty?: boolean;
  label?: string;
}) {
  if (error)
    return (
      <div className="empty-state error" role="alert">
        <AlertCircle size={28} />
        <strong>Unable to load records</strong>
        <span>{error}</span>
      </div>
    );
  if (loading)
    return (
      <div className="empty-state" role="status">
        <Loader2 className="spin" size={28} />
        <span>Loading your records…</span>
      </div>
    );
  if (empty)
    return (
      <div className="empty-state">
        <Search size={30} />
        <strong>{label}</strong>
        <span>Try another date or update your filters.</span>
      </div>
    );
  return null;
}
export function Badge({ status, children }: { status: string; children?: ReactNode }) {
  return (
    <span className={`badge ${status.toLowerCase()}`}>
      {children || status.replaceAll('_', ' ')}
    </span>
  );
}
export function PageIntro({
  eyebrow,
  title,
  description,
  actions,
}: {
  eyebrow?: string;
  title: string;
  description: string;
  actions?: ReactNode;
}) {
  return (
    <div className="page-intro">
      <div>
        {eyebrow && <span className="eyebrow">{eyebrow}</span>}
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      {actions && <div className="intro-actions">{actions}</div>}
    </div>
  );
}
export function Pagination({
  page,
  total,
  size = 15,
  onChange,
}: {
  page: number;
  total: number;
  size?: number;
  onChange: (page: number) => void;
}) {
  return (
    <div className="pagination">
      <span>
        {total
          ? `${(page - 1) * size + 1}–${Math.min(page * size, total)} of ${total} records`
          : '0 records'}
      </span>
      <div>
        <button
          className="icon-button"
          aria-label="Previous page"
          disabled={page <= 1}
          onClick={() => onChange(page - 1)}
        >
          <ChevronLeft size={18} />
        </button>
        <span>
          Page {page} of {Math.max(1, Math.ceil(total / size))}
        </span>
        <button
          className="icon-button"
          aria-label="Next page"
          disabled={page * size >= total}
          onClick={() => onChange(page + 1)}
        >
          <ChevronRight size={18} />
        </button>
      </div>
    </div>
  );
}
export function Field({
  label,
  children,
  hint,
}: {
  label: string;
  children: ReactNode;
  hint?: string;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
      {hint && <small>{hint}</small>}
    </label>
  );
}
export function Modal({
  title,
  onClose,
  children,
  wide = false,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null),
    labelId = useId();
  useEffect(() => {
    const previous = document.activeElement as HTMLElement;
    ref.current?.showModal();
    return () => {
      previous?.focus();
    };
  }, []);
  return (
    <dialog
      ref={ref}
      aria-labelledby={labelId}
      className={`modal ${wide ? 'wide' : ''}`}
      onCancel={onClose}
      onClick={(e) => {
        if (e.target === ref.current) {
          const r = ref.current.getBoundingClientRect();
          if (
            e.clientX < r.left ||
            e.clientX > r.right ||
            e.clientY < r.top ||
            e.clientY > r.bottom
          )
            onClose();
        }
      }}
    >
      <div className="modal-heading">
        <h2 id={labelId}>{title}</h2>
        <button className="icon-button" aria-label="Close dialog" onClick={onClose}>
          <X size={20} />
        </button>
      </div>
      <div className="modal-body">{children}</div>
    </dialog>
  );
}
export function Form({
  onSubmit,
  children,
  submit = 'Save',
  onCancel,
}: {
  onSubmit: (form: FormData) => Promise<void>;
  children: ReactNode;
  submit?: string;
  onCancel?: () => void;
}) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        const form = new FormData(e.currentTarget);
        setBusy(true);
        setError('');
        try {
          await onSubmit(form);
        } catch (e: any) {
          setError(e.message);
        } finally {
          setBusy(false);
        }
      }}
    >
      {children}
      {error && (
        <div className="form-error" role="alert">
          <AlertCircle size={17} />
          {error}
        </div>
      )}
      <div className="form-actions">
        {onCancel && (
          <button className="button secondary" type="button" onClick={onCancel}>
            Cancel
          </button>
        )}
        <button className="button primary" type="submit" disabled={busy}>
          {busy && <Loader2 size={17} className="spin" />}
          {busy ? 'Saving…' : submit}
        </button>
      </div>
    </form>
  );
}
export function Notice({ children, success = false }: { children: ReactNode; success?: boolean }) {
  return (
    <div className={`notice ${success ? 'success' : ''}`}>
      {success ? <CheckCircle2 size={18} /> : <AlertCircle size={18} />}
      <span>{children}</span>
    </div>
  );
}
export function SearchInput({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="search-field">
      <Search size={18} />
      <input
        aria-label="Search name or ID"
        placeholder="Search name or ID"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </label>
  );
}
