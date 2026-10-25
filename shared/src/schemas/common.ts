import { z } from 'zod';

export const objectId = z.string().regex(/^[a-f0-9]{24}$/i, 'Invalid id');

/** Calendar date as YYYY-MM-DD (no time zone ambiguity). */
export const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD')
  .refine((s) => !Number.isNaN(Date.parse(s)), 'Invalid date');

export const time24 = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use HH:mm (24h)');

export const phone = z
  .string()
  .trim()
  .regex(/^\+?[0-9][0-9\s-]{8,16}$/, 'Enter a valid phone number');

/** Pakistani CNIC (13 digits, dashes optional) or another national ID / passport (6–20 alphanumerics). */
export const nationalId = z
  .string()
  .trim()
  .transform((s) => s.toUpperCase())
  .refine((s) => /^\d{5}-?\d{7}-?\d$/.test(s) || /^[A-Z0-9]{6,20}$/.test(s), 'Enter a valid CNIC (12345-1234567-1) or ID number')
  .transform((s) => (/^\d{5}-?\d{7}-?\d$/.test(s) ? s.replace(/-/g, '').replace(/^(\d{5})(\d{7})(\d)$/, '$1-$2-$3') : s));

export const email = z.string().trim().toLowerCase().email('Enter a valid email');

export const optionalString = (max = 500) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((v) => (v === '' ? undefined : v));

export const money = z.coerce.number().min(0, 'Cannot be negative').max(100_000_000);

export const paginationQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  sort: z.string().max(50).optional(),
  search: z.string().trim().max(100).optional(),
});
export type PaginationQuery = z.infer<typeof paginationQuery>;

export interface Paged<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
}

export const passwordPolicy = z
  .string()
  .min(10, 'At least 10 characters')
  .max(128)
  .regex(/[a-z]/, 'Needs a lowercase letter')
  .regex(/[A-Z]/, 'Needs an uppercase letter')
  .regex(/\d/, 'Needs a digit')
  .regex(/[^A-Za-z0-9]/, 'Needs a symbol');
