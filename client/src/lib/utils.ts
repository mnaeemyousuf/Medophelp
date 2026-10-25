import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export const cn = (...inputs: ClassValue[]) => twMerge(clsx(inputs));

export const todayIso = () => new Date().toLocaleDateString('en-CA');

export function formatDate(d?: string | Date | null, opts: Intl.DateTimeFormatOptions = { day: '2-digit', month: 'short', year: 'numeric' }) {
  if (!d) return '—';
  const date = typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d) ? new Date(`${d}T00:00:00`) : new Date(d);
  return date.toLocaleDateString('en-GB', opts);
}

export function formatDateTime(d?: string | Date | null) {
  if (!d) return '—';
  return new Date(d).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
}

export function formatTime(d?: string | Date | null) {
  if (!d) return '—';
  return new Date(d).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
}

export function money(n: number | undefined | null, currency = 'PKR') {
  // Whole amounts stay "PKR 1,500"; fractional ones always show two decimals ("PKR 3,212.50").
  const v = n ?? 0;
  const digits = Number.isInteger(v) ? 0 : 2;
  return `${currency} ${v.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;
}

export function minutesSince(d?: string | Date | null) {
  if (!d) return 0;
  return Math.max(0, Math.round((Date.now() - new Date(d).getTime()) / 60_000));
}

/** "AppointmentStatus" style identifiers to words: WaitingForDoctor → Waiting for doctor */
export const humanize = (s: string) => s.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/^./, (c) => c.toUpperCase()).replace(/ ([A-Z])(?=[a-z])/g, (_, c) => ` ${c.toLowerCase()}`);

export const initials = (name: string) =>
  name
    .replace(/^Dr\.\s*/, '')
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p[0])
    .join('')
    .toUpperCase();
