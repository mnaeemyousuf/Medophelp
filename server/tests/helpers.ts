import request from 'supertest';
import type { Express } from 'express';

export const PASSWORD = 'Test@Pass12345';

/** A signed-in browser-like session: keeps cookies and sends the CSRF header on writes. */
export async function signIn(app: Express, email: string, password = PASSWORD) {
  const agent = request.agent(app);
  const res = await agent.post('/api/auth/login').set('X-Requested-With', 'hms').send({ email, password });
  if (res.status !== 204) throw new Error(`login ${email} failed: ${res.status} ${JSON.stringify(res.body)}`);
  return {
    agent,
    get: (url: string) => agent.get(url),
    post: (url: string, body?: object) => agent.post(url).set('X-Requested-With', 'hms').send(body ?? {}),
    put: (url: string, body?: object) => agent.put(url).set('X-Requested-With', 'hms').send(body ?? {}),
    patch: (url: string, body?: object) => agent.patch(url).set('X-Requested-With', 'hms').send(body ?? {}),
    del: (url: string) => agent.delete(url).set('X-Requested-With', 'hms'),
  };
}
export type Session = Awaited<ReturnType<typeof signIn>>;

export const localToday = () => new Date().toLocaleDateString('en-CA');

/**
 * The n-th free slot today for a doctor, asked from the API itself, so tests never collide with
 * seeded appointments whatever the time of day.
 */
export async function freeSlot(session: Session, doctorId: string, n = 0) {
  const res = await session.get(`/api/appointments/availability?doctorId=${doctorId}&date=${localToday()}`);
  const free = (res.body.slots as Array<{ time: string; available: boolean }>).filter((s) => s.available);
  if (free.length <= n) throw new Error('No free slots left today for the test doctor');
  return free[n].time;
}
