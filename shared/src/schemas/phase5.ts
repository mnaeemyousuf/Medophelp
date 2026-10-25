import { z } from 'zod';
import type { Permission } from '../permissions';
import { CONSENT_METHODS, CONSENT_TYPES } from '../enums';
import { isoDate, objectId, optionalString, time24 } from './common';

// ── Medication reminders ────────────────────────────────────────────────────
export const doseActionSchema = z.object({
  status: z.enum(['Taken', 'Skipped']),
  note: optionalString(300),
});

export const doseTimesSchema = z.object({
  times: z.array(time24).min(1).max(24).refine((t) => new Set(t).size === t.length, 'Times must be different'),
});

export const stopScheduleSchema = z.object({ reason: z.string().trim().min(3, 'Give a reason').max(300) });

// ── Patient consent & communication preferences ─────────────────────────────
export const recordConsentSchema = z.object({
  type: z.enum(CONSENT_TYPES),
  granted: z.boolean(),
  method: z.enum(CONSENT_METHODS).default('Verbal'),
  note: optionalString(300),
});
export type RecordConsentInput = z.infer<typeof recordConsentSchema>;
/** Types a patient may change themselves in the portal (communication preferences only). */
export const SELF_SERVICE_CONSENTS = ['SmsMessages', 'EmailMessages', 'PushNotifications'] as const;

// ── Reports ─────────────────────────────────────────────────────────────────
export type ReportFilter = 'dateRange' | 'department' | 'doctor';

export interface ReportDefinition {
  key: string;
  title: string;
  category: 'Clinical' | 'Financial' | 'Pharmacy & stores' | 'HR';
  description: string;
  /** Visible to users with any of these permissions. */
  anyOf: Permission[];
  filters: ReportFilter[];
}

const clinical: Permission[] = ['reports.clinical'];
const financial: Permission[] = ['reports.financial'];
const hr: Permission[] = ['reports.hr'];

export const REPORTS: ReportDefinition[] = [
  { key: 'patient-inflow', title: 'Patient inflow', category: 'Clinical', description: 'Daily registrations and visits by type', anyOf: clinical, filters: ['dateRange', 'department'] },
  { key: 'demographics', title: 'Patient demographics', category: 'Clinical', description: 'Patients seen by age band and gender', anyOf: clinical, filters: ['dateRange', 'department'] },
  { key: 'opd-ipd', title: 'OPD / IPD statistics', category: 'Clinical', description: 'Visits, admissions, discharges and average length of stay by department', anyOf: clinical, filters: ['dateRange', 'department'] },
  { key: 'doctor-appointments', title: 'Doctor appointments', category: 'Clinical', description: 'Appointments per doctor with completion, cancellation and no-show rates', anyOf: clinical, filters: ['dateRange', 'department', 'doctor'] },
  { key: 'lab-tat', title: 'Lab turnaround time', category: 'Clinical', description: 'Average and 90th-percentile hours from order to verified result, per test', anyOf: [...clinical, 'lab.manage'], filters: ['dateRange', 'department'] },
  { key: 'er-response', title: 'Emergency response time', category: 'Clinical', description: 'Door-to-triage and door-to-doctor minutes by triage level, and dispositions', anyOf: [...clinical, 'emergency.view'], filters: ['dateRange'] },
  { key: 'medication-adherence', title: 'Medication adherence', category: 'Clinical', description: 'Doses taken, missed and skipped per patient on active schedules', anyOf: [...clinical, 'medication.manage'], filters: ['dateRange', 'department', 'doctor'] },
  { key: 'revenue-department', title: 'Revenue by department', category: 'Financial', description: 'Billed, collected and outstanding amounts by department', anyOf: financial, filters: ['dateRange', 'department'] },
  { key: 'revenue-doctor', title: 'Revenue by doctor', category: 'Financial', description: 'Consultation revenue and patient counts per doctor', anyOf: financial, filters: ['dateRange', 'department', 'doctor'] },
  { key: 'outstanding', title: 'Outstanding payments', category: 'Financial', description: 'Open invoices with ageing buckets', anyOf: [...financial, 'billing.view'], filters: ['dateRange', 'department'] },
  { key: 'insurance-claims', title: 'Insurance claims', category: 'Financial', description: 'Claims by insurer and status with approved and paid amounts', anyOf: [...financial, 'insurance.manage'], filters: ['dateRange', 'department'] },
  { key: 'pharmacy-stock', title: 'Pharmacy stock', category: 'Pharmacy & stores', description: 'Stock on hand, value and reorder status per item', anyOf: [...financial, 'inventory.view'], filters: [] },
  { key: 'medicine-expiry', title: 'Medicine expiry', category: 'Pharmacy & stores', description: 'Batches expired or expiring in the next 90 days, or expiring within a chosen date range', anyOf: [...financial, 'inventory.view'], filters: ['dateRange'] },
  { key: 'purchases', title: 'Purchase report', category: 'Pharmacy & stores', description: 'Purchase orders and receipts by supplier', anyOf: [...financial, 'purchasing.manage', 'purchasing.approve'], filters: ['dateRange'] },
  { key: 'staff-attendance', title: 'Staff attendance', category: 'HR', description: 'Present, late, absent and leave days per employee', anyOf: [...hr, 'hr.attendance'], filters: ['dateRange', 'department'] },
  { key: 'payroll-summary', title: 'Payroll summary', category: 'HR', description: 'Gross, deductions, tax and net per processed run and department', anyOf: [...hr, 'payroll.manage', 'payroll.approve'], filters: ['dateRange', 'department'] },
  { key: 'leave-summary', title: 'Leave summary', category: 'HR', description: 'Approved leave days by type and department', anyOf: [...hr, 'hr.leave.approve'], filters: ['dateRange', 'department'] },
];

export const REPORT_KEYS = REPORTS.map((r) => r.key) as [string, ...string[]];

export const reportQuerySchema = z
  .object({
    from: isoDate.optional(),
    to: isoDate.optional(),
    departmentId: objectId.optional(),
    doctorId: objectId.optional(),
    format: z.enum(['json', 'xlsx', 'pdf', 'csv']).default('json'),
  })
  .refine((q) => !q.from || !q.to || q.from <= q.to, { path: ['to'], message: 'End date is before start date' });
export type ReportQuery = z.infer<typeof reportQuerySchema>;

/** Uniform tabular result every report returns, so one renderer and one exporter serve all. */
export interface ReportColumn {
  key: string;
  label: string;
  type?: 'text' | 'number' | 'money' | 'percent' | 'date';
}
export interface ReportResult {
  key: string;
  title: string;
  subtitle: string;
  columns: ReportColumn[];
  rows: Array<Record<string, string | number | null>>;
  totals?: Record<string, string | number | null>;
  chart?: { type: 'bar' | 'line' | 'pie'; x: string; series: string[] };
  generatedAt: string;
}
