import express, { type Request, type Response, type NextFunction } from 'express';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { rateLimit } from 'express-rate-limit';
import { z } from 'zod';
import bcrypt from 'bcryptjs';
import { randomUUID, randomBytes, timingSafeEqual, createHmac } from 'node:crypto';
import { DateTime } from 'luxon';
import { resolve } from 'node:path';
import { existsSync } from 'node:fs';
import PDFDocument from 'pdfkit';
import ExcelJS from 'exceljs';
import sharp from 'sharp';
import { pool, transaction } from './db.js';
import { config } from './config.js';
import { AppError, today, ZONE } from './domain.js';
import {
  audit,
  hash,
  clock,
  dailyRecords,
  summary,
  requestCorrection,
  reviewCorrection,
  payrollLock,
  createPayroll,
  payrollCalculation,
  adjustPayroll,
  recalculateAdjustment,
} from './service.js';
import { sendAccountMail } from './mail.js';
declare global {
  namespace Express {
    interface Request {
      user?: any;
      session?: any;
    }
  }
}
const app = express();
app.disable('x-powered-by');
if (config.production) app.set('trust proxy', 1);
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:'],
        fontSrc: ["'self'"],
        connectSrc: ["'self'"],
      },
    },
  }),
);
app.use('/api/attendance/clock-in', express.json({ limit: '8mb' }));
app.use(express.json({ limit: '64kb' }));
app.use(cookieParser());
const sessionHash = (token: string) =>
  createHmac('sha256', process.env.SESSION_SECRET || 'edtr-local-development-only')
    .update(token)
    .digest('hex');
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 35,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { error: 'Too many attempts. Please try again in 15 minutes.' },
});
const cookieOptions = {
  httpOnly: true,
  sameSite: 'strict' as const,
  secure: config.production,
  path: '/',
};
const safeUser = (u: any) => ({
  id: u.id,
  employee_id: u.employee_id,
  name: u.name,
  email: u.email,
  username: u.username,
  role: u.role,
  department: u.department,
  position: u.position,
  active: u.active,
  schedule_id: u.schedule_id,
  hourly_rate_cents: u.hourly_rate_cents,
});
async function issueSession(res: Response, userId: string) {
  const token = randomBytes(32).toString('hex'),
    csrf = randomBytes(24).toString('hex');
  await pool.query(
    "INSERT INTO sessions(token_hash,user_id,csrf_token,expires_at) VALUES($1,$2,$3,now()+interval '12 hours')",
    [sessionHash(token), userId, csrf],
  );
  res.cookie('edtr_session', token, { ...cookieOptions, maxAge: 12 * 3600000 });
  return csrf;
}
app.use('/api', async (req, res, next) => {
  res.setHeader('Cache-Control', 'no-store');
  const token = req.cookies.edtr_session;
  if (typeof token === 'string') {
    const row = (
      await pool.query(
        `SELECT s.csrf_token,s.token_hash,u.* FROM sessions s JOIN users u ON u.id=s.user_id
      WHERE s.token_hash=$1 AND s.expires_at>now() AND u.active=true`,
        [sessionHash(token)],
      )
    ).rows[0];
    if (row) {
      req.user = safeUser(row);
      req.session = { csrf_token: row.csrf_token, token_hash: row.token_hash };
    }
  }
  if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
    const origin = req.get('origin');
    const origins = [
      config.appUrl,
      ...(config.production
        ? []
        : [
            `http://127.0.0.1:${config.clientPort}`,
            `http://localhost:${config.clientPort}`,
            `http://localhost:${config.port}`,
            `http://127.0.0.1:${config.port}`,
          ]),
    ];
    if (origin && !origins.includes(origin))
      return res.status(403).json({ error: 'Request origin is not allowed.' });
    if (req.user) {
      const supplied = req.get('x-csrf-token') || '';
      const expected = req.session.csrf_token;
      if (
        supplied.length !== expected.length ||
        !timingSafeEqual(Buffer.from(supplied), Buffer.from(expected))
      )
        return res.status(403).json({ error: 'Refresh your session before making changes.' });
    }
  }
  next();
});
const authenticate = (req: Request, _res: Response, next: NextFunction) =>
  req.user ? next() : next(new AppError(401, 'Please sign in to continue.'));
const manage = (req: Request, _res: Response, next: NextFunction) =>
  ['ADMIN', 'HR'].includes(req.user?.role)
    ? next()
    : next(new AppError(403, 'This action requires an Admin or HR account.'));
const admin = (req: Request, _res: Response, next: NextFunction) =>
  req.user?.role === 'ADMIN'
    ? next()
    : next(new AppError(403, 'Only an administrator can perform this action.'));
const uuid = z.string().uuid();
const date = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((v) => DateTime.fromISO(v).isValid, 'Enter a valid date.');
const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
const password = z
  .string()
  .min(12, 'Use at least 12 characters.')
  .max(128)
  .regex(/[a-z]/, 'Include a lowercase letter.')
  .regex(/[A-Z]/, 'Include an uppercase letter.')
  .regex(/[0-9]/, 'Include a number.');
const reason = z.string().trim().min(10, 'Give a reason of at least 10 characters.').max(1000);
const range = z
  .object({ from: date, to: date })
  .refine((v) => v.to >= v.from, 'End date must be on or after the start.')
  .refine(
    (v) => DateTime.fromISO(v.to).diff(DateTime.fromISO(v.from), 'days').days <= 366,
    'Choose a range of no more than 366 days.',
  );
const period = z
  .object({ user_id: uuid, start_date: date, end_date: date })
  .refine(
    (v) =>
      v.end_date >= v.start_date &&
      DateTime.fromISO(v.end_date).diff(DateTime.fromISO(v.start_date), 'days').days <= 62,
    'Use a payroll period of no more than 63 days.',
  );
app.get('/api/health', async (_req, res) => {
  await pool.query('SELECT 1');
  res.json({
    status: 'ok',
    database: 'PostgreSQL',
    timezone: ZONE,
    server_time: new Date().toISOString(),
  });
});
app.post('/api/auth/login', authLimiter, async (req, res) => {
  const input = z
    .object({ email: z.string().trim().min(1).max(254), password: z.string().min(1).max(128) })
    .parse(req.body);
  const email =
    !config.production && input.email.toLowerCase() === 'admin' ? 'admin@edtr.local' : input.email;
  const user = (
    await pool.query(
      'SELECT * FROM users WHERE lower(email)=lower($1) OR lower(username)=lower($1)',
      [email],
    )
  ).rows[0];
  const valid = await bcrypt.compare(
    input.password,
    user?.password_hash || '$2b$12$wkeJdxAcza.wIBKWzcMMIu1AKML/u/EuqVxhmNvnjMWrgDbuSPqLS',
  );
  if (!user || !valid || !user.active)
    throw new AppError(
      401,
      'Username or email and password are incorrect, or the account is inactive.',
    );
  if (req.cookies.edtr_session)
    await pool.query('DELETE FROM sessions WHERE token_hash=$1', [
      sessionHash(req.cookies.edtr_session),
    ]);
  const csrf = await issueSession(res, user.id);
  await audit(pool, user.id, 'LOGIN', 'user', user.id);
  res.json({ user: safeUser(user), csrf_token: csrf });
});
app.get('/api/auth/me', authenticate, (req, res) =>
  res.json({ user: req.user, csrf_token: req.session.csrf_token }),
);
app.post('/api/auth/logout', async (req, res) => {
  if (req.session && req.user) {
    await pool.query('DELETE FROM sessions WHERE token_hash=$1', [req.session.token_hash]);
    await audit(pool, req.user.id, 'LOGOUT', 'user', req.user.id);
  }
  res.clearCookie('edtr_session', cookieOptions);
  res.json({ success: true });
});
app.post('/api/auth/forgot-password', authLimiter, async (req, res) => {
  const { email } = z.object({ email: z.string().trim().email() }).parse(req.body);
  const user = (
    await pool.query('SELECT id FROM users WHERE lower(email)=lower($1) AND active=true', [email])
  ).rows[0];
  if (user) {
    const token = randomBytes(32).toString('hex');
    await transaction(async (db) => {
      await db.query(
        "UPDATE recovery_tokens SET used_at=now() WHERE user_id=$1 AND kind='RESET' AND used_at IS NULL",
        [user.id],
      );
      await db.query(
        "INSERT INTO recovery_tokens(id,token_hash,user_id,kind,expires_at) VALUES($1,$2,$3,'RESET',now()+interval '30 minutes')",
        [randomUUID(), hash(token), user.id],
      );
      await audit(db, user.id, 'PASSWORD_RECOVERY_REQUESTED', 'user', user.id);
    });
    await sendAccountMail(email, `${config.appUrl}/reset-password?token=${token}`, 'RESET');
  }
  res.json({ message: 'If an active account matches this email, a recovery link has been sent.' });
});
app.post('/api/auth/reset-password', authLimiter, async (req, res) => {
  const input = z.object({ token: z.string().length(64), password }).parse(req.body);
  const userId = await transaction(async (db) => {
    const token = (
      await db.query(
        'SELECT r.*,u.active FROM recovery_tokens r JOIN users u ON u.id=r.user_id WHERE token_hash=$1 FOR UPDATE OF r',
        [hash(input.token)],
      )
    ).rows[0];
    if (
      !token ||
      token.used_at ||
      !token.active ||
      new Date(token.expires_at).getTime() < Date.now()
    )
      throw new AppError(
        422,
        'This link is invalid or expired. Request a new link from your administrator.',
      );
    await db.query('UPDATE users SET password_hash=$2 WHERE id=$1', [
      token.user_id,
      await bcrypt.hash(input.password, 12),
    ]);
    await db.query(
      'UPDATE recovery_tokens SET used_at=now() WHERE user_id=$1 AND used_at IS NULL',
      [token.user_id],
    );
    await db.query('DELETE FROM sessions WHERE user_id=$1', [token.user_id]);
    await audit(
      db,
      token.user_id,
      token.kind === 'INVITE' ? 'ACCOUNT_ACTIVATED' : 'PASSWORD_RESET',
      'user',
      token.user_id,
    );
    return token.user_id;
  });
  res.json({ success: true, user_id: userId });
});
app.use('/api', authenticate);
app.get('/api/lookups', async (req, res) => {
  const schedules = (await pool.query('SELECT * FROM schedules ORDER BY created_at DESC')).rows;
  const holidays = (await pool.query('SELECT * FROM holidays ORDER BY date')).rows;
  const employees =
    req.user.role === 'EMPLOYEE'
      ? [req.user]
      : (
          await pool.query(
            "SELECT id,employee_id,name,department,position,role,active,schedule_id FROM users WHERE role='EMPLOYEE' ORDER BY employee_id",
          )
        ).rows;
  res.json({
    schedules,
    holidays,
    employees,
    timezone: ZONE,
    server_time: new Date().toISOString(),
  });
});
app.get('/api/dashboard', async (req, res) => {
  const scoped = req.user.role === 'EMPLOYEE' ? req.user.id : undefined;
  const now = new Date(),
    day = today(now),
    from = DateTime.fromISO(day).minus({ days: 6 }).toISODate()!;
  const records = await dailyRecords(pool, from, day, scoped, now),
    current = records.filter((r) => r.work_date === day);
  const active = (
    await pool.query(
      "SELECT count(*)::int AS count FROM users WHERE active=true AND role='EMPLOYEE'",
    )
  ).rows[0].count;
  const activeIds = new Set(
    (await pool.query("SELECT id FROM users WHERE active=true AND role='EMPLOYEE'")).rows.map(
      (r) => r.id,
    ),
  );
  const currentActive = current.filter((r) => scoped || activeIds.has(r.user_id));
  const totals = {
    employees: scoped ? 1 : active,
    present: currentActive.filter((r) => ['PRESENT', 'CLOCKED_IN', 'INCOMPLETE'].includes(r.status))
      .length,
    absent: currentActive.filter((r) => r.status === 'ABSENT').length,
    late: currentActive.filter((r) => r.late_minutes > 0).length,
    on_leave: currentActive.filter((r) => r.status === 'ON_LEAVE').length,
    clocked_in: currentActive.filter((r) => r.status === 'CLOCKED_IN').length,
  };
  const weekly = Array.from({ length: 7 }, (_, i) => {
    const date = DateTime.fromISO(from).plus({ days: i }).toISODate()!;
    const rows = records.filter((r) => r.work_date === date);
    return { date, ...summary(rows), late: rows.filter((r) => r.late_minutes > 0).length };
  });
  const activity = (
    await pool.query(
      `SELECT a.id,a.work_date,a.clock_in,a.clock_out,u.name,u.employee_id FROM attendance a JOIN users u ON u.id=a.user_id WHERE ($1::uuid IS NULL OR a.user_id=$1) ORDER BY COALESCE(a.clock_out,a.clock_in) DESC LIMIT 6`,
      [scoped || null],
    )
  ).rows;
  const pending = scoped
    ? 0
    : (await pool.query("SELECT count(*)::int AS count FROM corrections WHERE status='PENDING'"))
        .rows[0].count;
  const own = (
    await pool.query(
      `SELECT a.*,s.name AS schedule_name FROM users u LEFT JOIN schedules s ON u.schedule_id=s.id LEFT JOIN LATERAL
    (SELECT * FROM attendance WHERE user_id=u.id ORDER BY (clock_out IS NULL) DESC,work_date DESC LIMIT 1) a ON true WHERE u.id=$1`,
      [req.user.id],
    )
  ).rows[0];
  res.json({
    totals,
    weekly,
    activity,
    pending_corrections: pending,
    current: currentActive,
    own,
    server_time: now.toISOString(),
    date: day,
  });
});
app.post('/api/attendance/clock-in', async (req, res) => {
  const { proof } = z.object({ proof: z.string().max(7500000) }).parse(req.body);
  const match = /^data:image\/(jpeg|png);base64,([A-Za-z0-9+/]+={0,2})$/.exec(proof);
  if (!match) throw new AppError(422, 'Upload a JPG or PNG photo for clock-in proof.');
  const bytes = Buffer.from(match[2], 'base64');
  if (bytes.length > 5 * 1024 * 1024) throw new AppError(422, 'Photo must be 5 MB or smaller.');
  let image: Buffer;
  try {
    const input = sharp(bytes, { limitInputPixels: 25000000 });
    const metadata = await input.metadata();
    if (!['jpeg', 'png'].includes(metadata.format || '')) throw new Error('Unsupported image');
    image = await input
      .rotate()
      .resize({ width: 1200, height: 1200, fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 85 })
      .toBuffer();
  } catch {
    throw new AppError(422, 'This photo could not be read. Choose a valid JPG or PNG.');
  }
  const row = await transaction(async (db) => {
    const record = await clock(db, req.user.id, 'in');
    await db.query('INSERT INTO attendance_proofs(attendance_id,image) VALUES($1,$2)', [
      record.id,
      image,
    ]);
    return record;
  });
  res.status(201).json(row);
});
app.get('/api/attendance/:id/proof', async (req, res) => {
  const id = z.string().uuid().parse(req.params.id);
  const row = (
    await pool.query(
      'SELECT p.*,a.user_id FROM attendance_proofs p JOIN attendance a ON a.id=p.attendance_id WHERE attendance_id=$1',
      [id],
    )
  ).rows[0];
  if (!row || (req.user.role === 'EMPLOYEE' && row.user_id !== req.user.id))
    throw new AppError(404, 'Photo proof not found.');
  res.set('Cache-Control', 'private, no-store').type(row.mime_type).send(row.image);
});
app.post('/api/attendance/clock-out', async (req, res) =>
  res.json(await transaction((db) => clock(db, req.user.id, 'out'))),
);
async function filteredRecords(req: Request) {
  const { from, to } = range.parse({
    from: req.query.from || today(),
    to: req.query.to || today(),
  });
  const scope =
    req.user.role === 'EMPLOYEE'
      ? req.user.id
      : req.query.user_id
        ? uuid.parse(req.query.user_id)
        : undefined;
  const all = await dailyRecords(pool, from, to, scope);
  const search = String(req.query.search || '').toLowerCase();
  const filtered = all.filter(
    (r) =>
      (!search || `${r.name} ${r.employee_id}`.toLowerCase().includes(search)) &&
      (!req.query.department || r.department === req.query.department) &&
      (!req.query.status || r.status === req.query.status),
  );
  return { from, to, all, filtered };
}
app.get('/api/attendance', async (req, res) => {
  const { filtered } = await filteredRecords(req);
  const page = z.coerce
      .number()
      .int()
      .min(1)
      .max(10000)
      .parse(req.query.page || 1),
    pageSize = z.coerce
      .number()
      .int()
      .min(1)
      .max(100)
      .parse(req.query.page_size || 15);
  res.json({
    records: filtered.slice((page - 1) * pageSize, page * pageSize),
    total: filtered.length,
    page,
    page_size: pageSize,
    summary: summary(filtered),
  });
});
app.post('/api/attendance/:id/verify', manage, async (req, res) => {
  const id = uuid.parse(req.params.id);
  const input = z
    .object({ approved_overtime_minutes: z.coerce.number().int().min(0).default(0) })
    .parse(req.body);
  await transaction(async (db) => {
    await payrollLock(db);
    const row = (await db.query('SELECT * FROM attendance WHERE id=$1 FOR UPDATE', [id])).rows[0];
    if (!row?.clock_out) throw new AppError(422, 'Only completed attendance can be verified.');
    if (row.user_id === req.user.id)
      throw new AppError(403, 'Another reviewer must verify your attendance.');
    if (input.approved_overtime_minutes > row.overtime_minutes)
      throw new AppError(422, 'Approved overtime cannot exceed recorded overtime.');
    if (
      (
        await db.query(
          "SELECT 1 FROM corrections WHERE user_id=$1 AND work_date=$2 AND status='PENDING'",
          [row.user_id, row.work_date],
        )
      ).rowCount
    )
      throw new AppError(409, 'Review the pending correction before verifying this record.');
    await db.query(
      'UPDATE attendance SET verified=true,verified_by=$2,verified_at=now(),approved_overtime_minutes=$3,version=version+1 WHERE id=$1',
      [id, req.user.id, input.approved_overtime_minutes],
    );
    await audit(db, req.user.id, 'ATTENDANCE_VERIFIED', 'attendance', id, {
      original_overtime_minutes: row.approved_overtime_minutes,
      approved_overtime_minutes: input.approved_overtime_minutes,
    });
  });
  res.json({ success: true });
});
const correctionInput = z.object({
  user_id: uuid.optional(),
  work_date: date,
  requested_in: z.iso.datetime({ offset: true }),
  requested_out: z.iso.datetime({ offset: true }),
  reason,
});
app.post('/api/corrections', async (req, res) =>
  res
    .status(201)
    .json(
      await transaction((db) => requestCorrection(db, req.user, correctionInput.parse(req.body))),
    ),
);
app.get('/api/corrections', async (req, res) => {
  const scope = req.user.role === 'EMPLOYEE' ? req.user.id : null;
  res.json(
    (
      await pool.query(
        `SELECT c.*,u.name,u.employee_id,reviewer.name AS reviewer_name FROM corrections c JOIN users u ON u.id=c.user_id LEFT JOIN users reviewer ON reviewer.id=c.reviewer_id WHERE ($1::uuid IS NULL OR c.user_id=$1) ORDER BY c.created_at DESC LIMIT 500`,
        [scope],
      )
    ).rows,
  );
});
const decision = z.object({ status: z.enum(['APPROVED', 'REJECTED']), note: reason });
app.post('/api/corrections/:id/review', manage, async (req, res) => {
  const input = decision.parse(req.body);
  await transaction((db) =>
    reviewCorrection(db, req.user, uuid.parse(req.params.id), input.status, input.note),
  );
  res.json({ success: true });
});
app.get('/api/leaves', async (req, res) =>
  res.json(
    (
      await pool.query(
        `SELECT l.*,u.name,u.employee_id FROM leaves l JOIN users u ON u.id=l.user_id WHERE ($1::uuid IS NULL OR l.user_id=$1) ORDER BY l.created_at DESC LIMIT 500`,
        [req.user.role === 'EMPLOYEE' ? req.user.id : null],
      )
    ).rows,
  ),
);
app.post('/api/leaves', async (req, res) => {
  const input = z
    .object({ user_id: uuid.optional(), start_date: date, end_date: date, reason })
    .refine((v) => v.end_date >= v.start_date, 'End date must follow the start date.')
    .parse(req.body);
  const userId = req.user.role === 'EMPLOYEE' ? req.user.id : input.user_id || req.user.id;
  const id = randomUUID();
  await transaction(async (db) => {
    await payrollLock(db);
    const overlaps = (
      await db.query(
        "SELECT 1 FROM leaves WHERE user_id=$1 AND status IN ('PENDING','APPROVED') AND start_date <= $3 AND end_date >= $2",
        [userId, input.start_date, input.end_date],
      )
    ).rowCount;
    if (overlaps) throw new AppError(409, 'A leave request already overlaps these dates.');
    await db.query(
      'INSERT INTO leaves(id,user_id,start_date,end_date,reason) VALUES($1,$2,$3,$4,$5)',
      [id, userId, input.start_date, input.end_date, input.reason],
    );
    await audit(db, req.user.id, 'LEAVE_REQUESTED', 'leave', id, input);
  });
  res.status(201).json({ id });
});
app.post('/api/leaves/:id/review', manage, async (req, res) => {
  const input = decision.parse(req.body),
    id = uuid.parse(req.params.id);
  await transaction(async (db) => {
    await payrollLock(db);
    const leave = (await db.query('SELECT * FROM leaves WHERE id=$1 FOR UPDATE', [id])).rows[0];
    if (!leave || leave.status !== 'PENDING')
      throw new AppError(409, 'This leave is missing or has already been reviewed.');
    if (leave.user_id === req.user.id)
      throw new AppError(403, 'Another reviewer must review your own leave.');
    if (
      input.status === 'APPROVED' &&
      (
        await db.query(
          'SELECT 1 FROM attendance WHERE user_id=$1 AND work_date BETWEEN $2 AND $3',
          [leave.user_id, leave.start_date, leave.end_date],
        )
      ).rowCount
    )
      throw new AppError(409, 'Attendance already exists on a requested leave date.');
    await db.query('UPDATE leaves SET status=$2,reviewer_id=$3,review_note=$4 WHERE id=$1', [
      id,
      input.status,
      req.user.id,
      input.note,
    ]);
    await audit(db, req.user.id, `LEAVE_${input.status}`, 'leave', id, {
      ...input,
      start_date: leave.start_date,
      end_date: leave.end_date,
    });
  });
  res.json({ success: true });
});
app.get('/api/employees', manage, async (req, res) =>
  res.json(
    (
      await pool.query(
        `SELECT u.id,u.employee_id,u.name,u.email,u.role,u.department,u.position,u.active,u.schedule_id,u.hourly_rate_cents,u.employment_from,s.name AS schedule_name FROM users u LEFT JOIN schedules s ON s.id=u.schedule_id WHERE ($1='ADMIN' OR u.role='EMPLOYEE') ORDER BY u.employee_id`,
        [req.user.role],
      )
    ).rows,
  ),
);
const employeeInput = z.object({
  employee_id: z
    .string()
    .trim()
    .regex(/^[A-Z][A-Z0-9-]{2,19}$/, 'Use a consistent employee ID, for example M01.'),
  name: z.string().trim().min(2).max(100),
  email: z
    .string()
    .trim()
    .email()
    .transform((v) => v.toLowerCase()),
  role: z.enum(['ADMIN', 'HR', 'EMPLOYEE']),
  department: z.string().trim().min(2).max(80),
  position: z.string().trim().min(2).max(80),
  schedule_id: uuid,
  hourly_rate_cents: z.coerce.number().int().min(0).max(10000000),
});
app.post('/api/employees', manage, async (req, res) => {
  const input = employeeInput.parse(req.body);
  if (req.user.role !== 'ADMIN' && input.role !== 'EMPLOYEE')
    throw new AppError(403, 'HR may only create employee accounts.');
  const id = randomUUID(),
    token = randomBytes(32).toString('hex');
  await transaction(async (db) => {
    await payrollLock(db);
    await db.query(
      `INSERT INTO users(id,employee_id,name,email,password_hash,role,department,position,schedule_id,hourly_rate_cents) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [
        id,
        input.employee_id,
        input.name,
        input.email,
        await bcrypt.hash(randomBytes(32).toString('hex'), 12),
        input.role,
        input.department,
        input.position,
        input.schedule_id,
        input.hourly_rate_cents,
      ],
    );
    await db.query('INSERT INTO employment_periods(user_id,start_date) VALUES($1,$2)', [
      id,
      today(),
    ]);
    await db.query(
      'INSERT INTO schedule_assignments(id,user_id,schedule_id,effective_from) VALUES($1,$2,$3,$4)',
      [randomUUID(), id, input.schedule_id, today()],
    );
    await db.query(
      "INSERT INTO recovery_tokens(id,token_hash,user_id,kind,expires_at) VALUES($1,$2,$3,'INVITE',now()+interval '48 hours')",
      [randomUUID(), hash(token), id],
    );
    await audit(db, req.user.id, 'EMPLOYEE_CREATED', 'user', id, input);
  });
  const link = `${config.appUrl}/reset-password?token=${token}`;
  await sendAccountMail(input.email, link, 'INVITE');
  res.status(201).json({ id, invitation_link: link });
});
app.put('/api/employees/:id', manage, async (req, res) => {
  const input = employeeInput.parse(req.body),
    id = uuid.parse(req.params.id);
  await transaction(async (db) => {
    await payrollLock(db);
    const existing = (await db.query('SELECT * FROM users WHERE id=$1 FOR UPDATE', [id])).rows[0];
    if (!existing) throw new AppError(404, 'Employee not found.');
    if (req.user.role !== 'ADMIN' && (existing.role !== 'EMPLOYEE' || input.role !== 'EMPLOYEE'))
      throw new AppError(403, 'HR may only edit employee accounts.');
    if (id === req.user.id && input.role !== existing.role)
      throw new AppError(422, 'You cannot change your own access role.');
    await db.query(
      'UPDATE users SET employee_id=$2,name=$3,email=$4,role=$5,department=$6,position=$7,schedule_id=$8,hourly_rate_cents=$9 WHERE id=$1',
      [
        id,
        input.employee_id,
        input.name,
        input.email,
        input.role,
        input.department,
        input.position,
        input.schedule_id,
        input.hourly_rate_cents,
      ],
    );
    if (existing.schedule_id !== input.schedule_id) {
      const effective = today();
      await db.query(
        'UPDATE schedule_assignments SET effective_to=$2::date-1 WHERE user_id=$1 AND effective_to IS NULL AND effective_from < $2',
        [id, effective],
      );
      await db.query(
        'INSERT INTO schedule_assignments(id,user_id,schedule_id,effective_from) VALUES($1,$2,$3,$4) ON CONFLICT(user_id,effective_from) DO UPDATE SET schedule_id=EXCLUDED.schedule_id',
        [randomUUID(), id, input.schedule_id, effective],
      );
    }
    await db.query('DELETE FROM sessions WHERE user_id=$1', [id]);
    await audit(db, req.user.id, 'EMPLOYEE_UPDATED', 'user', id, {
      before: safeUser(existing),
      after: input,
    });
  });
  res.json({ success: true });
});
app.post('/api/employees/:id/status', manage, async (req, res) => {
  const { active } = z.object({ active: z.boolean() }).parse(req.body),
    id = uuid.parse(req.params.id);
  if (id === req.user.id) throw new AppError(422, 'You cannot deactivate your own account.');
  await transaction(async (db) => {
    await payrollLock(db);
    const target = (await db.query('SELECT * FROM users WHERE id=$1 FOR UPDATE', [id])).rows[0];
    if (!target) throw new AppError(404, 'Employee not found.');
    if (req.user.role === 'HR' && target.role !== 'EMPLOYEE')
      throw new AppError(403, 'HR may only change employee status.');
    if (
      !active &&
      (await db.query('SELECT 1 FROM attendance WHERE user_id=$1 AND clock_out IS NULL', [id]))
        .rowCount
    )
      throw new AppError(
        409,
        'Resolve the open attendance shift before deactivating this employee.',
      );
    if (target.active === active) throw new AppError(409, 'The account already has this status.');
    if (active) {
      await db.query(
        'INSERT INTO employment_periods(user_id,start_date) VALUES($1,$2) ON CONFLICT(user_id,start_date) DO UPDATE SET end_date=NULL',
        [id, today()],
      );
    } else {
      await db.query(
        'INSERT INTO employment_periods(user_id,start_date) VALUES($1,$2) ON CONFLICT DO NOTHING',
        [id, target.employment_from],
      );
      await db.query(
        'UPDATE employment_periods SET end_date=$2 WHERE user_id=$1 AND end_date IS NULL',
        [id, today()],
      );
    }
    await db.query(
      'UPDATE users SET active=$2,employment_to=CASE WHEN $2 THEN NULL ELSE $3::date END WHERE id=$1',
      [id, active, today()],
    );
    await db.query('DELETE FROM sessions WHERE user_id=$1', [id]);
    await audit(
      db,
      req.user.id,
      active ? 'EMPLOYEE_ACTIVATED' : 'EMPLOYEE_DEACTIVATED',
      'user',
      id,
    );
  });
  res.json({ success: true });
});
const scheduleInput = z.object({
  name: z.string().trim().min(2).max(100),
  start_time: time,
  end_time: time,
  grace_minutes: z.coerce.number().int().min(0).max(120),
  break_minutes: z.coerce.number().int().min(0).max(240),
  break_after_minutes: z.coerce.number().int().min(0).max(1440),
  work_days: z.array(z.number().int().min(1).max(7)).min(1).max(7),
});
app.post('/api/schedules', manage, async (req, res) => {
  const input = scheduleInput.parse(req.body),
    id = randomUUID();
  await transaction(async (db) => {
    await db.query(
      'INSERT INTO schedules(id,name,start_time,end_time,grace_minutes,break_minutes,break_after_minutes,work_days) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',
      [
        id,
        input.name,
        input.start_time,
        input.end_time,
        input.grace_minutes,
        input.break_minutes,
        input.break_after_minutes,
        input.work_days,
      ],
    );
    await audit(db, req.user.id, 'SCHEDULE_CREATED', 'schedule', id, input);
  });
  res.status(201).json({ id });
});
app.post('/api/holidays', manage, async (req, res) => {
  const input = z.object({ date, name: z.string().trim().min(2).max(100) }).parse(req.body);
  if (input.date < today())
    throw new AppError(422, 'Configure holidays for today or a future date.');
  await transaction(async (db) => {
    await db.query(
      'INSERT INTO holidays(date,name) VALUES($1,$2) ON CONFLICT(date) DO UPDATE SET name=EXCLUDED.name',
      [input.date, input.name],
    );
    await audit(db, req.user.id, 'HOLIDAY_CONFIGURED', 'holiday', input.date, input);
  });
  res.json({ success: true });
});
app.delete('/api/holidays/:date', manage, async (req, res) => {
  const day = date.parse(req.params.date);
  if (day < today()) throw new AppError(422, 'Past holiday configuration is preserved.');
  await transaction(async (db) => {
    await db.query('DELETE FROM holidays WHERE date=$1', [day]);
    await audit(db, req.user.id, 'HOLIDAY_REMOVED', 'holiday', day);
  });
  res.json({ success: true });
});
app.get('/api/payroll/policy', manage, async (_req, res) =>
  res.json((await pool.query('SELECT * FROM payroll_policy WHERE id=1')).rows[0]),
);
app.put('/api/payroll/policy', admin, async (req, res) => {
  const input = z
    .object({
      overtime_multiplier: z.coerce.number().min(1).max(5),
      contribution_cents: z.coerce.number().int().min(0),
      other_deduction_cents: z.coerce.number().int().min(0),
      other_earnings_cents: z.coerce.number().int().min(0),
    })
    .parse(req.body);
  await transaction(async (db) => {
    await payrollLock(db);
    await db.query(
      'UPDATE payroll_policy SET overtime_multiplier=$1,contribution_cents=$2,other_deduction_cents=$3,other_earnings_cents=$4,updated_at=now() WHERE id=1',
      [
        input.overtime_multiplier,
        input.contribution_cents,
        input.other_deduction_cents,
        input.other_earnings_cents,
      ],
    );
    await audit(db, req.user.id, 'PAYROLL_POLICY_UPDATED', 'policy', '1', input);
  });
  res.json({ success: true });
});
app.get('/api/payroll', async (req, res) =>
  res.json(
    (
      await pool.query(
        `SELECT p.*,u.name,u.employee_id FROM payroll p JOIN users u ON u.id=p.user_id WHERE ($1::uuid IS NULL OR (p.user_id=$1 AND p.status IN ('APPROVED','PAID'))) ORDER BY p.created_at DESC LIMIT 500`,
        [req.user.role === 'EMPLOYEE' ? req.user.id : null],
      )
    ).rows,
  ),
);
app.post('/api/payroll/calculate', manage, async (req, res) =>
  res
    .status(201)
    .json({ id: await transaction((db) => createPayroll(db, req.user, period.parse(req.body))) }),
);
app.post('/api/payroll/:id/adjust', admin, async (req, res) =>
  res.status(201).json({
    id: await transaction((db) =>
      adjustPayroll(
        db,
        req.user,
        uuid.parse(req.params.id),
        z.object({ reason }).parse(req.body).reason,
      ),
    ),
  }),
);
app.post('/api/payroll/:id/recalculate-adjustment', admin, async (req, res) => {
  await transaction((db) => recalculateAdjustment(db, req.user, uuid.parse(req.params.id)));
  res.json({ success: true });
});
app.post('/api/payroll/:id/status', manage, async (req, res) => {
  const id = uuid.parse(req.params.id),
    { status } = z.object({ status: z.enum(['FOR_REVIEW', 'APPROVED', 'PAID']) }).parse(req.body);
  if (['APPROVED', 'PAID'].includes(status) && req.user.role !== 'ADMIN')
    throw new AppError(403, 'Only an administrator can approve or mark payroll as paid.');
  await transaction(async (db) => {
    await payrollLock(db);
    const row = (await db.query('SELECT * FROM payroll WHERE id=$1 FOR UPDATE', [id])).rows[0];
    if (!row) throw new AppError(404, 'Payroll not found.');
    if (row.user_id === req.user.id)
      throw new AppError(403, 'Another administrator must approve your payroll.');
    if (!(
      (row.status === 'DRAFT' && status === 'FOR_REVIEW') ||
      (row.status === 'FOR_REVIEW' && status === 'APPROVED') ||
      (row.status === 'APPROVED' && status === 'PAID')
    ))
      throw new AppError(409, 'Follow the payroll flow: Draft → For Review → Approved → Paid.');
    if (status !== 'PAID') {
      const current = await payrollCalculation(db, row.user_id, row.start_date, row.end_date);
      if (current.fingerprint !== row.attendance_fingerprint)
        throw new AppError(
          409,
          'Attendance or pay policy changed. Recalculate the draft before review or approval.',
        );
    }
    await db.query(
      "UPDATE payroll SET status=$2,approved_by=CASE WHEN $2='APPROVED' THEN $3 ELSE approved_by END,approved_at=CASE WHEN $2='APPROVED' THEN now() ELSE approved_at END,paid_at=CASE WHEN $2='PAID' THEN now() ELSE paid_at END WHERE id=$1",
      [id, status, req.user.id],
    );
    await audit(db, req.user.id, `PAYROLL_${status}`, 'payroll', id, {
      net_cents: row.calculation.net_cents,
    });
  });
  res.json({ success: true });
});
app.get('/api/audit', manage, async (req, res) => {
  const page = z.coerce
    .number()
    .int()
    .min(1)
    .parse(req.query.page || 1);
  const total = (await pool.query('SELECT count(*)::int AS total FROM audit_logs')).rows[0].total;
  const records = (
    await pool.query(
      `SELECT a.*,u.name AS actor_name FROM audit_logs a LEFT JOIN users u ON u.id=a.actor_id ORDER BY a.created_at DESC,a.id DESC LIMIT 30 OFFSET $1`,
      [(page - 1) * 30],
    )
  ).rows;
  res.json({ records, total, page });
});
const timeText = (v: any) =>
  v ? DateTime.fromJSDate(new Date(v), { zone: ZONE }).toFormat('MMM dd, yyyy hh:mm a') : '—';
const money = (v: number) => `PHP ${(v / 100).toFixed(2)}`;
app.get('/api/reports/dtr/:format', async (req, res) => {
  const format = z.enum(['pdf', 'xlsx']).parse(req.params.format);
  const { from, to, filtered } = await filteredRecords(req);
  const totals = summary(filtered);
  if (format === 'xlsx') {
    const book = new ExcelJS.Workbook();
    book.creator = 'eDTR';
    const sheet = book.addWorksheet('Daily time records');
    sheet.columns = [
      { header: 'Date', key: 'work_date', width: 15 },
      { header: 'Employee ID', key: 'employee_id', width: 16 },
      { header: 'Employee', key: 'name', width: 28 },
      { header: 'Scheduled In', key: 'scheduled_in', width: 27 },
      { header: 'Time In', key: 'clock_in', width: 27 },
      { header: 'Time Out', key: 'clock_out', width: 27 },
      { header: 'Hours', key: 'hours', width: 12 },
      { header: 'Late Minutes', key: 'late_minutes', width: 16 },
      { header: 'Approved OT Hours', key: 'ot', width: 20 },
      { header: 'Status', key: 'status', width: 20 },
      { header: 'Verified', key: 'verified', width: 12 },
      { header: 'Remarks', key: 'remarks', width: 40 },
    ];
    for (const r of filtered)
      sheet.addRow({
        ...r,
        scheduled_in: timeText(r.scheduled_in),
        clock_in: timeText(r.clock_in),
        clock_out: timeText(r.clock_out),
        hours: r.worked_minutes / 60,
        ot: r.approved_overtime_minutes / 60,
        verified: r.verified ? 'Yes' : 'No',
      });
    sheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
    sheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD53F3F' } };
    sheet.views = [{ state: 'frozen', ySplit: 1 }];
    sheet.autoFilter = { from: 'A1', to: 'L1' };
    const totalsSheet = book.addWorksheet('Summary');
    totalsSheet.addRow(['Period', `${from} to ${to}`]);
    for (const [key, value] of Object.entries(totals)) totalsSheet.addRow([key, value]);
    totalsSheet.columns.forEach((c) => (c.width = 28));
    res.attachment(`eDTR-${from}-${to}.xlsx`);
    await book.xlsx.write(res);
    res.end();
  } else {
    res.attachment(`eDTR-${from}-${to}.pdf`);
    const doc = new PDFDocument({ size: 'A4', layout: 'landscape', margin: 30 });
    doc.pipe(res);
    const heading = () => {
      doc.fillColor('#d53f3f').fontSize(20).text('eDTR | Daily Time Record');
      doc
        .fillColor('#333')
        .fontSize(10)
        .text(`${from} to ${to} | Asia/Manila | ${filtered.length} records`)
        .moveDown();
    };
    heading();
    const headers = [
      'Date',
      'ID / Employee',
      'Time In',
      'Time Out',
      'Hours',
      'Late',
      'OT',
      'Status',
    ];
    const xs = [30, 100, 265, 410, 555, 605, 650, 700];
    const row = (values: string[], bold = false) => {
      const y = doc.y;
      doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(8);
      values.forEach((v, i) =>
        doc.text(v, xs[i], y, {
          width: i === 1 ? 160 : i === 2 || i === 3 ? 140 : 80,
          lineBreak: false,
        }),
      );
      doc.y = y + 25;
    };
    row(headers, true);
    for (const r of filtered) {
      if (doc.y > 530) {
        doc.addPage();
        heading();
        row(headers, true);
      }
      row([
        r.work_date,
        `${r.employee_id} ${r.name}`,
        timeText(r.clock_in),
        timeText(r.clock_out),
        (r.worked_minutes / 60).toFixed(2),
        String(r.late_minutes),
        (r.approved_overtime_minutes / 60).toFixed(2),
        r.status,
      ]);
    }
    if (doc.y > 480) {
      doc.addPage();
      heading();
    }
    doc
      .moveDown()
      .fontSize(10)
      .text(
        `Scheduled days: ${totals.scheduled_days} | Present: ${totals.present} | Absent: ${totals.absent} | Leave: ${totals.on_leave} | Worked hours: ${(totals.worked_minutes / 60).toFixed(2)}`,
        30,
        doc.y,
      );
    doc.end();
  }
});
app.get('/api/payroll/:id/payslip', async (req, res) => {
  const row = (
    await pool.query(
      'SELECT p.*,u.name,u.employee_id,u.department FROM payroll p JOIN users u ON u.id=p.user_id WHERE p.id=$1',
      [uuid.parse(req.params.id)],
    )
  ).rows[0];
  if (!row) throw new AppError(404, 'Payslip not found.');
  if (req.user.role === 'EMPLOYEE' && row.user_id !== req.user.id)
    throw new AppError(403, 'You may only access your own payslips.');
  if (!['APPROVED', 'PAID'].includes(row.status))
    throw new AppError(422, 'Payslips are available after payroll approval.');
  res.attachment(`eDTR-payslip-${row.employee_id}-${row.start_date}.pdf`);
  const doc = new PDFDocument({ size: 'A4', margin: 48 });
  doc.pipe(res);
  const c = row.calculation;
  doc
    .fillColor('#d53f3f')
    .fontSize(28)
    .text('eDTR')
    .fontSize(14)
    .text(row.adjustment_of ? 'Payroll adjustment payslip' : 'Employee payslip')
    .moveDown();
  doc
    .fillColor('#222')
    .fontSize(12)
    .text(`${row.name} · ${row.employee_id}`)
    .text(row.department)
    .text(`Period: ${row.start_date} to ${row.end_date}`)
    .text(`Status: ${row.status}`)
    .moveDown();
  for (const [label, value] of [
    ['Base earnings', c.base_cents],
    ['Approved overtime', c.overtime_cents],
    ['Other earnings', c.other_earnings_cents],
    ['Gross pay', c.gross_cents],
    ['Configured contributions', c.contribution_cents],
    ['Other deductions', c.other_deduction_cents],
    ['Total deductions', c.deductions_cents],
    ['Net pay', c.net_cents],
  ])
    doc
      .fontSize(12)
      .text(`${label}: ${money(Number(value))}`)
      .moveDown(0.4);
  doc.moveDown().fontSize(9).text(c.method);
  if (row.adjustment_reason) doc.moveDown().text(`Adjustment reason: ${row.adjustment_reason}`);
  doc.end();
});
app.use('/api', (_req, _res, next) => next(new AppError(404, 'API route not found.')));
if (existsSync(resolve('dist/index.html'))) {
  app.use(express.static(resolve('dist')));
  app.get('/{*path}', (_req, res) => res.sendFile(resolve('dist/index.html')));
}
app.use((error: any, _req: Request, res: Response, _next: NextFunction) => {
  if (error instanceof z.ZodError)
    return res.status(422).json({
      error: error.issues[0]?.message || 'Check your input.',
      fields: error.issues.map((i) => ({ field: i.path.join('.'), message: i.message })),
    });
  if (error.code === '23505')
    return res.status(409).json({
      error:
        'This record already exists. Check for duplicate employee IDs, email addresses, or requests.',
    });
  if (error.code === '23503')
    return res.status(422).json({ error: 'The selected employee or schedule no longer exists.' });
  if (error instanceof AppError) return res.status(error.status).json({ error: error.message });
  console.error('API error:', error.message);
  res.status(500).json({ error: 'The request could not be completed. Please try again.' });
});
export default app;
