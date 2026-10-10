import 'dotenv/config';
import { existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
export function ensureLocalPostgres() {
  if (process.env.DATABASE_URL) return;
  if (process.env.NODE_ENV === 'production') throw new Error('Set DATABASE_URL in production.');
  const dir = resolve('.local');
  mkdirSync(dir, { recursive: true });
  let bin = process.env.POSTGRES_BIN;
  if (!bin && process.platform === 'win32') {
    for (const version of [18, 17, 16, 15, 14]) {
      const candidate = `C:/Program Files/PostgreSQL/${version}/bin`;
      if (existsSync(join(candidate, 'initdb.exe'))) {
        bin = candidate;
        break;
      }
    }
  }
  const exe = (name) =>
    bin ? join(bin, name + (process.platform === 'win32' ? '.exe' : '')) : name;
  const run = (name, args, allowFailure = false) => {
    const r = spawnSync(exe(name), args, {
      encoding: 'utf8',
      windowsHide: true,
      env: { ...process.env, ...(password ? { PGPASSWORD: password } : {}) },
      stdio: name === 'pg_ctl' ? 'ignore' : 'pipe',
    });
    if (!allowFailure && (r.error || r.status !== 0))
      throw new Error(r.error?.message || r.stderr || r.stdout);
    return r;
  };
  const configurationPath = join(dir, 'database.json');
  const port = Number(process.env.LOCAL_POSTGRES_PORT || 5433);
  const password = existsSync(configurationPath)
    ? JSON.parse(readFileSync(configurationPath, 'utf8')).password
    : randomBytes(24).toString('hex');
  const data = join(dir, 'postgres');
  if (!existsSync(join(data, 'PG_VERSION'))) {
    const pwFile = join(dir, 'init-password');
    writeFileSync(pwFile, password, { mode: 0o600 });
    try {
      run('initdb', [
        '-D',
        data,
        '-U',
        'edtr',
        '--auth=scram-sha-256',
        '--pwfile=' + pwFile,
        '--encoding=UTF8',
        '--locale=C',
      ]);
    } finally {
      unlinkSync(pwFile);
    }
  }
  const status = run('pg_ctl', ['-D', data, 'status'], true);
  if (status.status !== 0)
    run('pg_ctl', [
      '-D',
      data,
      '-l',
      join(dir, 'postgres.log'),
      '-o',
      `-p ${port} -h 127.0.0.1`,
      '-w',
      'start',
    ]);
  const connection = ['-h', '127.0.0.1', '-p', String(port), '-U', 'edtr'];
  const exists = run('psql', [
    ...connection,
    '-d',
    'postgres',
    '-Atc',
    "SELECT 1 FROM pg_database WHERE datname='edtr'",
  ]);
  if (exists.stdout.trim() !== '1') run('createdb', [...connection, 'edtr']);
  writeFileSync(
    configurationPath,
    JSON.stringify({
      password,
      databaseUrl: `postgresql://edtr:${password}@127.0.0.1:${port}/edtr`,
    }),
    { mode: 0o600 },
  );
  console.log(`Local PostgreSQL database edtr ready on 127.0.0.1:${port}.`);
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) ===
    resolve(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'))
)
  ensureLocalPostgres();
