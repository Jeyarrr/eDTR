CREATE TABLE IF NOT EXISTS schedules (
  id uuid PRIMARY KEY, name text NOT NULL, start_time text NOT NULL, end_time text NOT NULL,
  grace_minutes integer NOT NULL DEFAULT 5 CHECK (grace_minutes BETWEEN 0 AND 120),
  break_minutes integer NOT NULL DEFAULT 60 CHECK (break_minutes BETWEEN 0 AND 240),
  break_after_minutes integer NOT NULL DEFAULT 360 CHECK (break_after_minutes >= 0),
  work_days integer[] NOT NULL DEFAULT '{1,2,3,4,5}', created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS users (
  id uuid PRIMARY KEY, employee_id text UNIQUE NOT NULL, name text NOT NULL,
  email text UNIQUE NOT NULL, password_hash text NOT NULL, role text NOT NULL CHECK (role IN ('ADMIN','HR','EMPLOYEE')),
  department text NOT NULL, position text NOT NULL, active boolean NOT NULL DEFAULT true,
  schedule_id uuid REFERENCES schedules(id), hourly_rate_cents integer NOT NULL DEFAULT 10000 CHECK (hourly_rate_cents >= 0),
  employment_from date NOT NULL DEFAULT (now() AT TIME ZONE 'Asia/Manila')::date,
  employment_to date, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS schedule_assignments (
  id uuid PRIMARY KEY, user_id uuid NOT NULL REFERENCES users(id), schedule_id uuid NOT NULL REFERENCES schedules(id),
  effective_from date NOT NULL, effective_to date, UNIQUE(user_id, effective_from)
);
CREATE TABLE IF NOT EXISTS employment_periods (
  user_id uuid NOT NULL REFERENCES users(id), start_date date NOT NULL, end_date date,
  PRIMARY KEY(user_id,start_date), CHECK(end_date IS NULL OR end_date >= start_date)
);
INSERT INTO employment_periods(user_id,start_date,end_date)
SELECT id,employment_from,employment_to FROM users ON CONFLICT DO NOTHING;
CREATE TABLE IF NOT EXISTS sessions (
  token_hash text PRIMARY KEY, user_id uuid NOT NULL REFERENCES users(id), csrf_token text NOT NULL,
  expires_at timestamptz NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS recovery_tokens (
  id uuid PRIMARY KEY, token_hash text UNIQUE NOT NULL, user_id uuid NOT NULL REFERENCES users(id),
  kind text NOT NULL CHECK (kind IN ('RESET','INVITE')), expires_at timestamptz NOT NULL,
  used_at timestamptz, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS attendance (
  id uuid PRIMARY KEY, user_id uuid NOT NULL REFERENCES users(id), work_date date NOT NULL,
  clock_in timestamptz NOT NULL, clock_out timestamptz,
  schedule_snapshot jsonb NOT NULL, worked_minutes integer NOT NULL DEFAULT 0 CHECK (worked_minutes >= 0),
  late_minutes integer NOT NULL DEFAULT 0 CHECK (late_minutes >= 0),
  overtime_minutes integer NOT NULL DEFAULT 0 CHECK (overtime_minutes >= 0),
  approved_overtime_minutes integer NOT NULL DEFAULT 0 CHECK (approved_overtime_minutes >= 0 AND approved_overtime_minutes <= overtime_minutes),
  verified boolean NOT NULL DEFAULT false, verified_by uuid REFERENCES users(id), verified_at timestamptz,
  remarks text NOT NULL DEFAULT '', version integer NOT NULL DEFAULT 1, UNIQUE(user_id, work_date),
  CHECK (clock_out IS NULL OR clock_out > clock_in)
);
CREATE UNIQUE INDEX IF NOT EXISTS attendance_one_open ON attendance(user_id) WHERE clock_out IS NULL;
CREATE TABLE IF NOT EXISTS attendance_proofs (
  attendance_id uuid PRIMARY KEY REFERENCES attendance(id),
  image bytea NOT NULL, mime_type text NOT NULL DEFAULT 'image/jpeg',
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE users ADD COLUMN IF NOT EXISTS username text;
CREATE UNIQUE INDEX IF NOT EXISTS users_username_unique ON users(lower(username)) WHERE username IS NOT NULL;
CREATE TABLE IF NOT EXISTS leaves (
  id uuid PRIMARY KEY, user_id uuid NOT NULL REFERENCES users(id), start_date date NOT NULL, end_date date NOT NULL,
  reason text NOT NULL, status text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','APPROVED','REJECTED')),
  reviewer_id uuid REFERENCES users(id), review_note text, created_at timestamptz NOT NULL DEFAULT now(), CHECK(end_date >= start_date)
);
CREATE TABLE IF NOT EXISTS holidays (
  date date PRIMARY KEY, name text NOT NULL
);
CREATE TABLE IF NOT EXISTS corrections (
  id uuid PRIMARY KEY, user_id uuid NOT NULL REFERENCES users(id), work_date date NOT NULL,
  attendance_id uuid REFERENCES attendance(id), original jsonb NOT NULL,
  requested_in timestamptz NOT NULL, requested_out timestamptz NOT NULL, reason text NOT NULL,
  status text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','APPROVED','REJECTED')),
  reviewer_id uuid REFERENCES users(id), review_note text, reviewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(), CHECK(requested_out > requested_in)
);
CREATE UNIQUE INDEX IF NOT EXISTS corrections_one_pending ON corrections(user_id, work_date) WHERE status = 'PENDING';
CREATE TABLE IF NOT EXISTS payroll_policy (
  id integer PRIMARY KEY DEFAULT 1 CHECK(id = 1), overtime_multiplier numeric(5,2) NOT NULL DEFAULT 1.25 CHECK(overtime_multiplier >= 1),
  contribution_cents integer NOT NULL DEFAULT 0 CHECK(contribution_cents >= 0),
  other_deduction_cents integer NOT NULL DEFAULT 0 CHECK(other_deduction_cents >= 0),
  other_earnings_cents integer NOT NULL DEFAULT 0 CHECK(other_earnings_cents >= 0),
  updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO payroll_policy(id) VALUES(1) ON CONFLICT DO NOTHING;
CREATE TABLE IF NOT EXISTS payroll (
  id uuid PRIMARY KEY, user_id uuid NOT NULL REFERENCES users(id), start_date date NOT NULL, end_date date NOT NULL,
  status text NOT NULL DEFAULT 'DRAFT' CHECK(status IN ('DRAFT','FOR_REVIEW','APPROVED','PAID')),
  calculation jsonb NOT NULL, attendance_fingerprint text NOT NULL,
  adjustment_of uuid REFERENCES payroll(id), adjustment_reason text,
  approved_by uuid REFERENCES users(id), approved_at timestamptz, paid_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(), CHECK(end_date >= start_date)
);
CREATE UNIQUE INDEX IF NOT EXISTS payroll_unique_period ON payroll(user_id,start_date,end_date) WHERE adjustment_of IS NULL;
CREATE TABLE IF NOT EXISTS audit_logs (
  id bigserial PRIMARY KEY, actor_id uuid REFERENCES users(id), action text NOT NULL, entity_type text NOT NULL,
  entity_id text NOT NULL, details jsonb NOT NULL DEFAULT '{}', created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS attendance_date_idx ON attendance(work_date);
CREATE INDEX IF NOT EXISTS audit_time_idx ON audit_logs(created_at DESC);
