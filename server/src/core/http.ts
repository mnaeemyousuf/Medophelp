import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { Types } from 'mongoose';
import { NotFoundError, ValidationError } from './errors';

/** Wraps an async handler so rejections reach the error middleware. */
export const ah =
  (fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>): RequestHandler =>
  (req, res, next) =>
    fn(req, res, next).catch(next);

export const oid = (id: string | Types.ObjectId) => (typeof id === 'string' ? new Types.ObjectId(id) : id);

export function orNotFound<T>(value: T, what: string): NonNullable<T> {
  if (value === null || value === undefined) throw new NotFoundError(what);
  return value as NonNullable<T>;
}

/** Timestamps are added by the base plugin, so schema type inference does not see them. */
export const createdAtOf = (doc: unknown) => (doc as { createdAt: Date }).createdAt;

/** Parses "YYYY-MM-DD" into a UTC midnight Date (dates are calendar dates, not instants). */
export const dateOnly = (s: string) => new Date(`${s}T00:00:00.000Z`);
export const toDateString = (d: Date) => d.toISOString().slice(0, 10);
/** Today's calendar date in the server's local time zone (set TZ, e.g. TZ=Asia/Karachi). */
export const todayString = () => new Date().toLocaleDateString('en-CA');

export const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export interface PageArgs {
  page: number;
  pageSize: number;
}
export const skipOf = ({ page, pageSize }: PageArgs) => (page - 1) * pageSize;

/**
 * Translates `?sort=key` / `?sort=-key` into a Mongo sort. Only whitelisted keys are accepted (so
 * clients cannot sort on unindexed or sensitive fields); `_id` breaks ties for stable paging.
 */
export function sortBy(sort: string | undefined, allowed: Record<string, string>, fallback: Record<string, 1 | -1>): Record<string, 1 | -1> {
  if (!sort) return fallback;
  const desc = sort.startsWith('-');
  const field = allowed[desc ? sort.slice(1) : sort];
  if (!field) throw new ValidationError({ sort: [`Sort by one of: ${Object.keys(allowed).join(', ')} (prefix "-" for descending)`] });
  return { [field]: desc ? -1 : 1, _id: 1 };
}
