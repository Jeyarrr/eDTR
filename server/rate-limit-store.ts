import type { Store, Options } from 'express-rate-limit';
import { createHash } from 'node:crypto';
import type { DB } from './db.js';

// Shared across Vercel instances; never stores raw IP addresses.
export class PostgresRateLimitStore implements Store {
  localKeys = false;
  private windowMs = 900000;
  constructor(private db: DB) {}
  init(options: Options) {
    this.windowMs = options.windowMs;
  }
  private key(value: string) {
    return createHash('sha256')
      .update('auth:' + value)
      .digest('hex');
  }
  async increment(key: string) {
    const result = await this.db.query(
      `INSERT INTO auth_rate_limits(key,hits,reset_at)
      VALUES($1,1,clock_timestamp()+$2*interval '1 millisecond')
      ON CONFLICT(key) DO UPDATE SET
      hits=CASE WHEN auth_rate_limits.reset_at<=clock_timestamp() THEN 1 ELSE auth_rate_limits.hits+1 END,
      reset_at=CASE WHEN auth_rate_limits.reset_at<=clock_timestamp() THEN clock_timestamp()+$2*interval '1 millisecond' ELSE auth_rate_limits.reset_at END
      RETURNING hits,reset_at`,
      [this.key(key), this.windowMs],
    );
    return { totalHits: result.rows[0].hits, resetTime: result.rows[0].reset_at };
  }
  async decrement(key: string) {
    await this.db.query('UPDATE auth_rate_limits SET hits=GREATEST(0,hits-1) WHERE key=$1', [
      this.key(key),
    ]);
  }
  async resetKey(key: string) {
    await this.db.query('DELETE FROM auth_rate_limits WHERE key=$1', [this.key(key)]);
  }
}
