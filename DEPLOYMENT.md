# Deploy VioTech eDTR to Vercel and Supabase

## Architecture

- Vercel serves the React/Vite build from `dist` and forwards `/api/*` to `api/index.ts` (Express on Node.js 24).
- Supabase provides PostgreSQL. Existing application sessions, roles, payroll, and photo proof remain in PostgreSQL. This app does not use Supabase Auth or the browser Data API, so it needs no Supabase anon/service-role API keys.
- The schema enables row-level security on all application tables without browser-access policies. The trusted Express backend connects as the Supabase `postgres` table owner. Never put database credentials in a `VITE_*` variable.
- Migrations run separately, never on a function cold start or during the Vercel build.

## 1. Create the Supabase database

Create a **new Supabase project** for production. In **Connect**, copy both connection strings:

| Variable              | Connection                                                                         |
| --------------------- | ---------------------------------------------------------------------------------- |
| `DATABASE_URL`        | Transaction pooler, port `6543`, for Vercel requests                               |
| `DIRECT_DATABASE_URL` | Session pooler, port `5432`, for setup and administrator creation on your computer |

Both target the Supabase `postgres` database; the pooler username typically includes the project reference. Use the exact host/username shown by Supabase. URL-encode special characters in your database password. The session pooler also works from IPv4-only computers.

Set `DATABASE_SSL=true`. TLS certificate verification stays enabled. If your endpoint requires the Supabase root certificate, download it from your project database settings and set `DATABASE_SSL_CA` to its PEM text (literal `\n` separators are supported). Do not use `rejectUnauthorized=false`. With `DATABASE_SSL=true`, connection-string SSL query parameters are removed so they cannot override the verified TLS settings.

## 2. Prepare production configuration locally

Create `.env.production.local` in the project root. Git and Vercel uploads ignore this file. Do not replace the local-development `.env`.

```dotenv
NODE_ENV=production
DATABASE_URL=YOUR_SUPABASE_TRANSACTION_POOLER_URI
DIRECT_DATABASE_URL=YOUR_SUPABASE_SESSION_POOLER_URI
DATABASE_SSL=true
APP_URL=https://YOUR-VERCEL-PROJECT.vercel.app
SESSION_SECRET=GENERATE_A_RANDOM_SECRET
SMTP_HOST=YOUR_MAIL_PROVIDER_HOST
SMTP_PORT=587
SMTP_USER=YOUR_MAIL_USERNAME
SMTP_PASSWORD=YOUR_MAIL_PASSWORD
SMTP_FROM=VioTech IT Solutions <attendance@YOUR_DOMAIN>
ADMIN_EMAIL=YOUR_REAL_ADMIN_EMAIL
ADMIN_NAME=YOUR_ADMIN_NAME
ADMIN_PASSWORD=YOUR_STRONG_ADMIN_PASSWORD
```

Generate the session secret:

```powershell
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

The administrator password must have at least 12 characters, including uppercase, lowercase, and a number. Use a verified sender with your SMTP provider. SMTP port 587 uses STARTTLS; 465 uses implicit TLS.

Apply the schema and create the first administrator:

```powershell
npm ci
$env:DOTENV_CONFIG_PATH = '.env.production.local'
npm run db:setup
npm run admin:create
npm run deploy:check
Remove-Item Env:DOTENV_CONFIG_PATH
```

`db:setup` and `admin:create` prefer `DIRECT_DATABASE_URL`; the deployment check tests `DATABASE_URL`, the same transaction-pooler connection used at runtime. The check validates required tables, RLS, the backend database role, an active administrator, and absence of active demo accounts. It does not send a test email.

Do **not** run `db:seed` in production. The simple debug accounts are intended only for local development; production seeding is blocked. Create real employees with User Management invitations. The first administrator signs in with their email.

## 3. Import the repository into Vercel

Import `Jeyarrr/eDTR`. Use:

| Setting          | Value                         |
| ---------------- | ----------------------------- |
| Root directory   | Repository root, not `client` |
| Framework preset | Vite                          |
| Node.js version  | 24.x                          |
| Build command    | `npm run build`               |
| Output directory | `dist`                        |

The checked-in `vercel.json` configures the API function, SPA routing, security headers, and PDF font data. Do not replace it with a rewrite that sends API requests to `index.html`.

Add these **server-side Production environment variables** in Vercel:

- `NODE_ENV=production`
- `DATABASE_URL` (transaction-pooler connection)
- `DATABASE_SSL=true`
- `DATABASE_SSL_CA` if needed
- `APP_URL` (the exact HTTPS origin users will visit, without a path)
- `SESSION_SECRET`
- `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_FROM`

Do not add `ADMIN_PASSWORD` or `DIRECT_DATABASE_URL` to Vercel. They are needed only by your local setup commands. Choose a function region near the Supabase database in Vercel's project settings.

Deploy, then ensure `APP_URL` matches the assigned/custom domain and redeploy after any environment changes. A different origin is intentionally rejected for form submissions. Use a separate test database for Preview deployments and configure their `APP_URL` explicitly; do not automatically share production credentials with previews.

## 4. Verify the live deployment

1. Open `/api/health`; expect `status: ok` and `database: PostgreSQL`.
2. Open `/login` directly and refresh another application route to verify SPA routing.
3. Sign in with the new administrator, open Profile/Settings, log out, and confirm refreshing stays signed out.
4. Invite an employee and verify actual email delivery. Test password recovery.
5. Assign a schedule appropriate for the current workday. Test clock-in with a JPG/PNG, clock-out, and photo review through the authorized record details. Test camera permission on HTTPS.
6. Generate PDF/Excel DTR exports and a payslip. The API function explicitly includes PDFKit font files.

## Limits and maintenance

- Photos are limited to **3 MB before base64 encoding**, keeping requests below Vercel's 4.5 MB function limit. Photo proof is resized and stored in PostgreSQL, not a local filesystem. Camera permission is required only for capture; upload remains available.
- Very large PDF/Excel exports can exceed Vercel's response/time limits. Use shorter date ranges or employee filters for large teams. Bulk asynchronous reports/storage are not implemented.
- Database pools are small on Vercel and attached to Fluid Compute lifecycle management. Queries use unnamed parameters, compatible with Supabase transaction pooling.
- Login/recovery throttling uses database counters across instances. Periodically remove expired rate-limit rows, expired sessions, and old used recovery tokens as part of database maintenance; do not remove attendance/audit history.
- Back up the Supabase database and define a photo-retention policy appropriate for the organization.
- Production email requires an SMTP provider; there is no filesystem mail outbox on Vercel.
- To reproduce production locally, run `npm run build`, then `npm start` with suitable production variables. The production cookie requires HTTPS in the browser.

## Reference documentation

- [Vite and API functions on Vercel](https://vercel.com/docs/frameworks/frontend/vite)
- [Vercel function limits](https://vercel.com/docs/functions/limitations)
- [Vercel database pool lifecycle](https://vercel.com/docs/functions/functions-api-reference/vercel-functions-package)
- [Supabase PostgreSQL connections](https://supabase.com/docs/guides/database/connecting-to-postgres)
- [Supabase row-level security](https://supabase.com/docs/guides/database/postgres/row-level-security)
