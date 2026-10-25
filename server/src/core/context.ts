import { AsyncLocalStorage } from 'node:async_hooks';
import type { ClientSession, Types } from 'mongoose';

export interface RequestContext {
  userId?: Types.ObjectId;
  userName?: string;
  roles: string[];
  permissions: Set<string>;
  hospitalId?: Types.ObjectId;
  patientId?: Types.ObjectId;
  doctorId?: Types.ObjectId;
  nurseId?: Types.ObjectId;
  /** HR employee record of the signed-in staff member (self-service). */
  employeeId?: Types.ObjectId;
  ip?: string;
  /** Active transaction session; picked up by audit and numbering so they join the transaction. */
  session?: ClientSession;
  /** Seeder / system jobs bypass the hospital scope. */
  system?: boolean;
}

const storage = new AsyncLocalStorage<RequestContext>();

export const runWithContext = <T>(ctx: RequestContext, fn: () => T): T => storage.run(ctx, fn);

export const ctx = (): RequestContext | undefined => storage.getStore();

export function requireCtx(): RequestContext {
  const c = storage.getStore();
  if (!c) throw new Error('No request context');
  return c;
}

export function currentHospitalId(): Types.ObjectId {
  const id = storage.getStore()?.hospitalId;
  if (!id) throw new Error('No hospital in request context');
  return id;
}

export const can = (permission: string) => storage.getStore()?.permissions.has(permission) ?? false;

/** Runs fn without hospital scoping (login lookups, seeding, background jobs). Use sparingly. */
export function asSystem<T>(fn: () => T): T {
  const parent = storage.getStore();
  return storage.run({ roles: [], permissions: new Set(), ...parent, system: true }, fn);
}
