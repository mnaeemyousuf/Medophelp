import { Writable } from 'node:stream';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import pino from 'pino';
import type { Express } from 'express';
import { connectDb, disconnectDb } from '../src/core/db';
import { seed } from '../src/seed/seed';
import { createApp } from '../src/app';
import { LOG_REDACTION } from '../src/core/logger';
import { PASSWORD } from './helpers';

/** Closes two traceability gaps: remember-me session lifetime (R-04.5) and log redaction (R-30.3). */
let app: Express;

beforeAll(async () => {
  await connectDb(process.env.MONGODB_URI!);
  await seed(PASSWORD);
  app = createApp();
});

afterAll(async () => {
  await disconnectDb();
});

const refreshCookie = (res: request.Response) => ([] as string[]).concat(res.headers['set-cookie'] ?? []).find((c) => c.startsWith('hms_rt='));

describe('Remember me', () => {
  const login = (rememberMe: boolean) =>
    request(app).post('/api/auth/login').set('X-Requested-With', 'hms').send({ email: 'reception@hospital.com', password: PASSWORD, rememberMe });

  it('without “Remember me” the refresh cookie ends with the browser session', async () => {
    const res = await login(false).expect(204);
    const c = refreshCookie(res)!;
    expect(c).toBeDefined();
    expect(c).not.toMatch(/Expires=/i);
    expect(c).not.toMatch(/Max-Age=/i);
    expect(c).toMatch(/HttpOnly/i);
    expect(c).toMatch(/SameSite=Strict/i);
  });

  it('with “Remember me” the refresh cookie persists for REFRESH_TOKEN_TTL_DAYS', async () => {
    const res = await login(true).expect(204);
    const c = refreshCookie(res)!;
    const expires = new Date(/Expires=([^;]+)/i.exec(c)![1]).getTime();
    const days = (expires - Date.now()) / 86_400_000;
    const ttl = Number(process.env.REFRESH_TOKEN_TTL_DAYS ?? 7);
    expect(days).toBeGreaterThan(ttl - 0.01);
    expect(days).toBeLessThanOrEqual(ttl + 0.01);
    expect(c).toMatch(/HttpOnly/i);
  });
});

describe('Log redaction', () => {
  it('credentials and patient identifiers never reach the log output', () => {
    const lines: string[] = [];
    const sink = new Writable({ write(chunk, _enc, cb) { lines.push(chunk.toString()); cb(); } });
    const log = pino({ redact: LOG_REDACTION }, sink);
    const secrets = { password: 'Sup3r$ecret!', cnic: '42101-5550123-4', phone: '+92 300 1112223', email: 'zara.demo@example.com', dateOfBirth: '1990-01-01', token: 'tok_abcdef' };
    log.info({ patient: { name: 'Zara Demo', ...secrets }, req: { headers: { cookie: 'hms_at=abc; hms_rt=def', authorization: 'Bearer xyz' } } }, 'patient registered');
    log.info({ user: { email: secrets.email, passwordHash: '$2a$12$hash' } }, 'login');
    log.info({ data: { patient: { cnic: secrets.cnic, phone: secrets.phone } } }, 'nested'); // two levels down
    log.info({ cnic: secrets.cnic, email: secrets.email }, 'top level');
    const out = lines.join('');
    for (const v of [...Object.values(secrets), 'hms_at=abc', 'Bearer xyz', '$2a$12$hash']) expect(out).not.toContain(v);
    expect(out).toContain('[redacted]');
    expect(out).toContain('Zara Demo'); // non-sensitive fields stay readable
  });
});
