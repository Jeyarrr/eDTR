import 'dotenv/config';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
const localPath = resolve('.local/database.json');
const local = existsSync(localPath) ? JSON.parse(readFileSync(localPath, 'utf8')) : {};
export const config = {
  production: process.env.NODE_ENV === 'production',
  databaseUrl: process.env.DATABASE_URL || local.databaseUrl,
  appUrl: process.env.APP_URL || `http://localhost:${process.env.VITE_PORT || 5173}`,
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
