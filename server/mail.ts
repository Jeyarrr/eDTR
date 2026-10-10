import nodemailer from 'nodemailer';
import { mkdir, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { config } from './config.js';
export async function sendAccountMail(email: string, link: string, kind: string) {
  if (process.env.SMTP_HOST) {
    const transport = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT || 587),
      secure: Number(process.env.SMTP_PORT) === 465,
      auth: process.env.SMTP_USER
        ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD }
        : undefined,
    });
    await transport.sendMail({
      from: process.env.SMTP_FROM || 'eDTR <noreply@example.com>',
      to: email,
      subject: kind === 'INVITE' ? 'Your eDTR account invitation' : 'Reset your eDTR password',
      text: `${kind === 'INVITE' ? 'Activate your account' : 'Reset your password'} using this link:\n${link}\n\nIf you did not request this, contact your administrator.`,
    });
  } else {
    if (config.production)
      throw new Error('SMTP_HOST must be configured for account recovery in production.');
    const outbox = process.env.MAIL_OUTBOX || '.local/outbox';
    await mkdir(outbox, { recursive: true });
    await writeFile(
      `${outbox}/${randomUUID()}.json`,
      JSON.stringify({ to: email, kind, link }, null, 2),
      { mode: 0o600 },
    );
  }
}
