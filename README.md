# eDTR — Electronic Daily Time Record

A digital Daily Time Record system for **VioTech I.T. Solutions**, covering employee timekeeping, photo proof, attendance management, and payroll.

Built with the PERN stack: PostgreSQL 18, Express 5, React 19 with TypeScript, and Node.js. The interface follows the provided [Figma file](https://www.figma.com/design/yxsAkeMsJ3ISN71R1Sz2ix/Attendance-Tracking-System-Design?node-id=0-1), using the VioTech red, black, and white palette with sidebar, rounded panels, table layouts, and authentication layout. Transparent light/dark logos and the required navigation assets are served locally. Original logo source files are preserved in `Images/`.

## Deployment

See [DEPLOYMENT.md](DEPLOYMENT.md) for Vercel + Supabase setup, production environment variables, schema initialization, administrator creation, and live verification. Cloud credentials are not included.

## Run locally

Requires Node.js 24.x and PostgreSQL. The current project uses the `edtr` database on the PostgreSQL 18 server at **127.0.0.1:5432**, alongside `tastenet` and `techora`, through `DATABASE_URL` in your local `.env`. On a fresh checkout, set that connection before setup. If `DATABASE_URL` is empty, development setup creates an isolated local cluster on **5433** instead.

```powershell
npm install
npm run db:setup
npm run db:seed
npm run dev
```

Open **http://127.0.0.1:5173**. The API runs on **http://127.0.0.1:3001**. Demo seeding is explicit and repeatable: an empty database gets fictional history and sample accounts; an existing database gets only missing sample accounts. Existing passwords, account status, attendance, and payroll are preserved. Demo employees and historical attendance are fictional. Dashboard, DTR, and payroll totals are calculated from database records.

Keep the development terminal open. Stop the app with **Ctrl+C**; if Windows asks `Terminate batch job (Y/N)?`, enter **Y**. In PowerShell you can use `npm.cmd run dev` if script execution policy blocks `npm`.

The launcher checks both ports before setting up the database. Starting it again while eDTR is running prints the existing app URL. If another service owns a required port, stop that service in its terminal and retry. The launcher shuts down its API and frontend together when either process exits. To choose different ports, set `PORT` (API) and `VITE_PORT` (frontend) in `.env`; set `APP_URL` to the frontend URL when overriding the public address used in email links.

| Account       | Username / email | Password |
| ------------- | ---------------- | -------- |
| Administrator | admin            | admin    |
| HR            | HRAlex           | hralex   |
| Employee      | raymondsantiago  | Raymond  |
| Employee      | georgeanthony    | George   |
| Employee      | syrentortal      | Syren    |

To use another PostgreSQL instance, copy `.env.example` to `.env` and set `DATABASE_URL`. `POSTGRES_BIN` and `LOCAL_POSTGRES_PORT` customize local bootstrap. The bootstrap can also use PostgreSQL binaries on PATH on Linux/macOS, running as a non-root user.

## View the database in pgAdmin

For the configured PostgreSQL 18 instance on port **5432**, right-click **Databases > Refresh** and expand **edtr > Schemas > public > Tables**.

Only when using the optional isolated fallback on **5433**, register `eDTR Local` with host `127.0.0.1`, database/user `edtr`, and the password from `.local/database.json`.

## Workflows

- **Employees:** live Manila clock; own clock-in/out; current schedule; daily DTR table and monthly calendar; correction and leave requests; approved payslips; PDF and Excel DTR export.
- **Admin/HR:** attendance summary and chart; date, employee, department, and status filters; attendance verification and explicit overtime approval; employee invitations, profiles, rates, schedules, and account activation; correction and leave reviews; schedules and holidays; audit logs.
- **Payroll:** calculate a draft from verified, completed attendance → submit for review → administrator approval → mark as paid → download payslip. Approved snapshots are immutable. Administrators can create a separate adjustment with a reason; it follows its own approval flow.
- **Account access:** admin invitations; no public privileged registration; expiring single-use recovery links; session revocation after password changes and account deactivation.

Without SMTP in development, account emails are written to **`.local/outbox/*.json`**. Open the newest file to use its invitation/recovery link. Invitation creation also returns the link to the authorized administrator. In production configure `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, and `SMTP_FROM`.

## Attendance and payroll rules

- Clock requests use **PostgreSQL server timestamps**. Device-supplied timestamps are ignored. Data uses `timestamptz` and UTC ISO values; UI and reports use **Asia/Manila**.
- Transactions lock the employee and database constraints prevent duplicate daily records or multiple open shifts. Clock-out requires an open shift. Overdue shifts longer than 36 hours require a correction.
- For an overnight shift, the attendance date is the date the scheduled shift starts. Clock-ins before the previous overnight shift ends plus four hours are associated with that shift date.
- A recorded shift is Present, Clocked In, or Incomplete. Lateness is a separate indicator. A missing scheduled record becomes Absent after the scheduled shift ends. Rest days, configured holidays, and approved leave are excluded from absence.
- Break minutes are deducted once elapsed shift duration reaches the schedule’s configured threshold. Late minutes are recorded as the full minutes after scheduled start when lateness exceeds the configured grace period. Schedule snapshots preserve past recorded shift calculations.
- Corrections preserve original values and record the requester, reason, reviewer, requested times, and review note. Reviewers cannot approve their own requests or verify their own attendance. Stale or overlapping corrections are blocked.
- Payroll uses the configured **hourly rate**, verified regular worked minutes capped at scheduled net minutes, and explicitly approved overtime. Absence, late time, and undertime are already reflected in hourly earnings, with no second deduction. Configured contributions, other earnings, and other deductions are amounts **per payroll period**.
- Overtime multipliers and contribution/deduction amounts are organizational settings. No statutory contribution table, holiday premium, automatic paid leave, or government policy is assumed. Configure and validate organizational policies before real payroll use.
- Payroll periods must be complete (end before today), at most 63 days long, and non-overlapping per employee. Missing clock-outs, unverified records, and pending corrections block payroll calculation. Attendance/policy fingerprints prevent approving stale calculations.
- Deactivation disables access while retaining historical records. Past records remain in reports. Schedule changes apply from today and create assignment history; schedule definitions themselves are preserved as versions.

## Structure

```text
client/src/          React pages, shared forms, theme, navigation, and CSS tokens
client/public/assets/ Local logos and Figma assets
server/app.ts       Express API, authentication, authorization, and exports
server/service.ts   Transactional attendance, correction, reporting, and payroll logic
server/domain.ts    Timezone, shift, break, lateness, and payroll calculations
server/schema.sql   Relational schema, constraints, and indexes
scripts/            Local PostgreSQL setup, demo seed, development launcher
tests/              Domain/API tests and Playwright browser checks
```

Opaque sessions use HttpOnly, SameSite cookies backed by PostgreSQL, CSRF tokens, request-origin checks, bcrypt passwords, validation, login/recovery rate limits, and role-scoped queries. Employees can access only their own private records. Employee records are deactivated rather than deleted.

## Verification

```powershell
npm test
npm run build
npm run test:e2e
```

API tests create and remove an isolated test schema in the configured PostgreSQL instance. Browser tests require the app running at port 5173 and demo seed data, and use installed Microsoft Edge. For another browser, edit `playwright.config.ts`. Screenshots and traces go to ignored `test-results/`.

## Production configuration

Provide `DATABASE_URL`, `SESSION_SECRET` (at least 32 characters), `APP_URL`, `NODE_ENV=production`, and SMTP settings. Use HTTPS behind a trusted reverse proxy. Build with `npm run build`, migrate with `npm run db:setup`, and serve with `npm start`. Express serves the built React application from `dist`. Set `PORT` and `HOST` for hosting. PostgreSQL backups, deployment, organizational payroll policies, and mail credentials must be configured for the target environment. Do not seed demonstration accounts into a production database.

For a fresh production database, use `npm run admin:create` with the environment variables `ADMIN_EMAIL`, `ADMIN_NAME`, and `ADMIN_PASSWORD` to create the first administrator. The command requires a strong password and refuses to create another administrator when one already exists.

## Design corrections applied

The Figma sample exposed clock controls on admin rows, treated Late as an exclusive attendance status, mixed `MO1`/`M01`, offered destructive employee deletion, left dashboard charts disconnected from data, and showed payroll totals that did not reconcile. The implementation moves clock controls to the employee dashboard, uses consistent IDs and separate late indicators, replaces deletion with deactivation, renders actual attendance charts, and calculates auditable payroll. Missing employee DTR, correction approvals, schedule configuration, audit history, and payroll adjustment interfaces are included.

Local debug administrator: sign in with username `admin` and password `admin`. The username shortcut is available only in development.

The interface uses transparent VioTech logo assets, bold italic headings inspired by its lettering, hover states, and gentle logo/sidebar/button pulses. System reduced-motion preferences disable animations. Login, recovery, and shared employee/management screens use VioTech branding.

Clock-in requires a camera photo or JPG/PNG upload (3 MB maximum). The server decodes the image, removes metadata, resizes it, and stores it in PostgreSQL with the attendance record. Employees can view their own proof; Admin/HR can review it in daily record details. Historical attendance without a photo remains available. Camera access requires localhost or HTTPS and browser permission; upload works when a camera is unavailable.

Click the account name to open Profile, Settings, or Logout. Appearance settings switch light/dark mode.

## Local configuration and maintenance

- `.env`, `.env.*`, `.local/`, generated builds, test output, dependencies, and logs are ignored by Git. `.env.example` contains placeholders and is safe to commit.
- `npm run db:setup` applies the schema without clearing records.
- `npm run db:seed` adds missing sample accounts; it never resets existing passwords. Credentials in the table are the defaults for newly created demo accounts.
- Use Profile > Settings for appearance and the account menu for Logout.
- Sample employees follow weekday schedules. On weekends or holidays, clock-in requires an appropriate assigned schedule.
- The second-by-second clock renders independently. Dashboard data polls every 30 seconds only while visible. Motion uses transforms and opacity, and respects reduced-motion preferences.
