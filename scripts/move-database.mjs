import 'dotenv/config';
import pg from 'pg';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { resolve, join } from 'node:path';

const password = process.env.EDTR_TARGET_PASSWORD;
if (!password)
  throw new Error('Run npm.cmd run db:move to enter the PostgreSQL password securely.');
const local = JSON.parse(readFileSync('.local/database.json', 'utf8'));
const sourceUrl = new URL(local.databaseUrl);
const targetUrl = new URL('postgresql://postgres@127.0.0.1:5432/postgres');
targetUrl.password = password;
const source = new pg.Client({ connectionString: sourceUrl.href });
const target = new pg.Client({ connectionString: targetUrl.href, connectionTimeoutMillis: 5000 });
let destination;
const bin = process.env.POSTGRES_BIN || 'C:/Program Files/PostgreSQL/18/bin';
function command(name, url, args) {
  const result = spawnSync(
    join(bin, `${name}.exe`),
    [
      '-h',
      url.hostname,
      '-p',
      url.port,
      '-U',
      decodeURIComponent(url.username),
      '-d',
      url.pathname.slice(1),
      ...args,
    ],
    {
      env: { ...process.env, PGPASSWORD: decodeURIComponent(url.password) },
      encoding: 'utf8',
      windowsHide: true,
    },
  );
  if (result.error || result.status !== 0) throw new Error(result.error?.message || result.stderr);
}
try {
  await target.connect();
  const databases = (await target.query('SELECT datname FROM pg_database')).rows.map(
    (r) => r.datname,
  );
  if (!databases.includes('tastenet') || !databases.includes('techora')) {
    throw new Error('This server does not contain both tastenet and techora. No changes made.');
  }
  if (databases.includes('edtr'))
    throw new Error('An edtr database already exists here. It was not overwritten.');
  await source.connect();
  const backup = resolve('.local', `edtr-migration-${Date.now()}.dump`);
  command('pg_dump', sourceUrl, ['-Fc', '--schema=public', '-f', backup]);
  await target.query('CREATE DATABASE edtr OWNER postgres');
  targetUrl.pathname = '/edtr';
  command('pg_restore', targetUrl, [
    '--no-owner',
    '--no-privileges',
    '--clean',
    '--if-exists',
    '--single-transaction',
    '--exit-on-error',
    backup,
  ]);
  destination = new pg.Client({ connectionString: targetUrl.href });
  await destination.connect();
  for (const { tablename } of (
    await source.query("SELECT tablename FROM pg_tables WHERE schemaname='public'")
  ).rows) {
    const sql = `SELECT count(*) AS count FROM "${tablename.replaceAll('"', '""')}"`;
    const original = (await source.query(sql)).rows[0].count;
    const copied = (await destination.query(sql)).rows[0].count;
    if (original !== copied)
      throw new Error(`Record counts differ for ${tablename}; app configuration has not changed.`);
  }
  const env = existsSync('.env') ? readFileSync('.env', 'utf8') : '';
  const updated = env.replace(/^DATABASE_URL=.*(?:\r?\n|$)/gm, '');
  writeFileSync('.env', `${updated.trimEnd()}\nDATABASE_URL=${targetUrl.href}\n`, { mode: 0o600 });
  console.log('Copied and verified eDTR on PostgreSQL 18, port 5432. App configuration updated.');
  console.log(
    'Refresh Databases in pgAdmin. Restart npm.cmd run dev to use the migrated database.',
  );
  console.log(`Backup retained at ${backup}`);
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
} finally {
  await source.end().catch(() => {});
  await target.end().catch(() => {});
  await destination?.end().catch(() => {});
}
