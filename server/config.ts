import 'dotenv/config';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
const localPath = resolve('.local/database.json');
const production = process.env.NODE_ENV === 'production';
const local =
  !production && !process.env.DATABASE_URL && existsSync(localPath)
    ? JSON.parse(readFileSync(localPath, 'utf8'))
    : {};
const appUrl =
  process.env.APP_URL || (production ? '' : `http://localhost:${process.env.VITE_PORT || 5173}`);
if (production) {
  let url: URL;
  try {
    url = new URL(appUrl);
  } catch {
    throw new Error('Production requires APP_URL with the HTTPS address of this deployment.');
  }
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    url.pathname !== '/' ||
    url.search ||
    url.hash
  )
    throw new Error('APP_URL must be an HTTPS origin without a path, query, or credentials.');
}
export const config = {
  production,
  databaseUrl: process.env.DATABASE_URL || local.databaseUrl,
  appUrl: appUrl.replace(/\/$/, ''),
  clientPort: Number(process.env.VITE_PORT || 5173),
  port: Number(process.env.PORT || 3001),
  host: process.env.HOST || (process.env.NODE_ENV === 'production' ? '0.0.0.0' : '127.0.0.1'),
};
if (
  config.production &&
  (!process.env.DATABASE_URL ||
    !process.env.SESSION_SECRET ||
    process.env.SESSION_SECRET.length < 32)
) {
  throw new Error('Production requires DATABASE_URL and SESSION_SECRET (at least 32 characters).');
}
