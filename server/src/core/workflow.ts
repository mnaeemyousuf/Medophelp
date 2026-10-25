import { canTransition, nextStates, type Workflow } from '@hms/shared';
import { ConflictError } from './errors';

/** Throws 409 for any status move not listed in the workflow's transition table. */
export function assertTransition<S extends string>(wf: Workflow<S>, from: S, to: S) {
  if (!canTransition(wf, from, to)) {
    const allowed = nextStates(wf, from);
    throw new ConflictError(
      `${wf.name} cannot move from ${from} to ${to}.${allowed.length ? ` Allowed: ${allowed.join(', ')}.` : ''}`,
      'invalid_transition',
    );
  }
}

export const toMinutes = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
};
export const fromMinutes = (mins: number) => `${String(Math.floor(mins / 60)).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}`;
