/** Pure clinical calculations shared by API (authoritative) and UI (live preview). */

export function calculateBmi(weightKg?: number | null, heightCm?: number | null): number | null {
  if (!weightKg || !heightCm || weightKg <= 0 || heightCm <= 0) return null;
  const m = heightCm / 100;
  return Math.round((weightKg / (m * m)) * 10) / 10;
}

export interface VitalsInput {
  systolicBp?: number | null;
  diastolicBp?: number | null;
  heartRate?: number | null;
  temperatureC?: number | null;
  spo2?: number | null;
  respiratoryRate?: number | null;
  bmi?: number | null;
  painScale?: number | null;
}

export type VitalFlag = 'BP' | 'HR' | 'TEMP' | 'SPO2' | 'RR' | 'BMI' | 'PAIN';

/** Adult reference ranges. Values outside are flagged and highlighted. */
export const VITAL_RANGES = {
  systolicBp: { low: 90, high: 139, unit: 'mmHg' },
  diastolicBp: { low: 60, high: 89, unit: 'mmHg' },
  heartRate: { low: 60, high: 100, unit: 'bpm' },
  temperatureC: { low: 35.0, high: 37.9, unit: '°C' },
  spo2: { low: 95, high: 100, unit: '%' },
  respiratoryRate: { low: 12, high: 20, unit: '/min' },
  bmi: { low: 18.5, high: 29.9, unit: 'kg/m²' },
  painScale: { low: 0, high: 6, unit: '/10' },
} as const;

export function isOutOfRange(key: keyof typeof VITAL_RANGES, value?: number | null): boolean {
  if (value === null || value === undefined) return false;
  const r = VITAL_RANGES[key];
  return value < r.low || value > r.high;
}

export function vitalFlags(v: VitalsInput): VitalFlag[] {
  const flags: VitalFlag[] = [];
  if (isOutOfRange('systolicBp', v.systolicBp) || isOutOfRange('diastolicBp', v.diastolicBp)) flags.push('BP');
  if (isOutOfRange('heartRate', v.heartRate)) flags.push('HR');
  if (isOutOfRange('temperatureC', v.temperatureC)) flags.push('TEMP');
  if (isOutOfRange('spo2', v.spo2)) flags.push('SPO2');
  if (isOutOfRange('respiratoryRate', v.respiratoryRate)) flags.push('RR');
  if (isOutOfRange('bmi', v.bmi)) flags.push('BMI');
  if (isOutOfRange('painScale', v.painScale)) flags.push('PAIN');
  return flags;
}

export function ageFromDob(dob: string | Date, on: Date = new Date()): number {
  const d = typeof dob === 'string' ? new Date(dob) : dob;
  let age = on.getFullYear() - d.getFullYear();
  const m = on.getMonth() - d.getMonth();
  if (m < 0 || (m === 0 && on.getDate() < d.getDate())) age--;
  return age;
}

/** Money is rounded to 2 dp at every step so client previews and server totals match exactly. */
export const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

export interface ReferenceRange {
  refLow?: number | null;
  refHigh?: number | null;
  criticalLow?: number | null;
  criticalHigh?: number | null;
}

/**
 * Flags a numeric lab value against its reference and critical limits.
 * N normal, L/H outside reference, LL/HH outside critical limits. Non-numeric values return 'N'.
 */
export function labFlag(value: string | number | null | undefined, r: ReferenceRange): 'N' | 'L' | 'H' | 'LL' | 'HH' {
  const n = typeof value === 'number' ? value : Number(String(value ?? '').trim());
  if (value === '' || value === null || value === undefined || Number.isNaN(n)) return 'N';
  if (r.criticalLow != null && n < r.criticalLow) return 'LL';
  if (r.criticalHigh != null && n > r.criticalHigh) return 'HH';
  if (r.refLow != null && n < r.refLow) return 'L';
  if (r.refHigh != null && n > r.refHigh) return 'H';
  return 'N';
}

export function formatRange(r: ReferenceRange & { refText?: string | null }) {
  if (r.refText) return r.refText;
  if (r.refLow != null && r.refHigh != null) return `${r.refLow} – ${r.refHigh}`;
  if (r.refLow != null) return `≥ ${r.refLow}`;
  if (r.refHigh != null) return `≤ ${r.refHigh}`;
  return '';
}

export interface BatchStock {
  id: string;
  batchNo: string;
  expiryDate: string | Date;
  quantity: number;
}

/**
 * First-Expiry-First-Out allocation. Expired batches (expiry on or before `asOf`) are never used.
 * Returns the allocation and any shortfall; callers must reject the dispense if shortfall > 0.
 */
export function allocateFefo(batches: BatchStock[], quantity: number, asOf: Date = new Date()) {
  const usable = batches
    .filter((b) => b.quantity > 0 && new Date(b.expiryDate).getTime() > asOf.getTime())
    .sort((a, b) => new Date(a.expiryDate).getTime() - new Date(b.expiryDate).getTime());
  const allocations: Array<{ batchId: string; batchNo: string; expiryDate: string | Date; quantity: number }> = [];
  let remaining = quantity;
  for (const b of usable) {
    if (remaining <= 0) break;
    const take = Math.min(b.quantity, remaining);
    allocations.push({ batchId: b.id, batchNo: b.batchNo, expiryDate: b.expiryDate, quantity: take });
    remaining -= take;
  }
  return { allocations, shortfall: Math.max(0, remaining), available: usable.reduce((s, b) => s + b.quantity, 0) };
}

export interface LineInput {
  quantity: number;
  unitPrice: number;
  discount?: number; // absolute amount per line
  taxRate?: number; // percent
}

export function lineTotals(l: LineInput) {
  const gross = round2(l.quantity * l.unitPrice);
  const discount = round2(Math.min(l.discount ?? 0, gross));
  const taxable = gross - discount;
  const tax = round2((taxable * (l.taxRate ?? 0)) / 100);
  return { gross, discount, tax, total: round2(taxable + tax) };
}
