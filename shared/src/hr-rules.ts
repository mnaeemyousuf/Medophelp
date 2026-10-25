import { round2 } from './clinical-rules';

/** ISO weekday 1=Mon … 7=Sun for a YYYY-MM-DD date (calendar date, no time zone drift). */
export function isoWeekday(date: string) {
  const d = new Date(`${date}T00:00:00Z`).getUTCDay();
  return d === 0 ? 7 : d;
}

/** Inclusive list of calendar dates between two YYYY-MM-DD dates. */
export function datesBetween(from: string, to: string) {
  const out: string[] = [];
  for (let t = Date.parse(`${from}T00:00:00Z`); t <= Date.parse(`${to}T00:00:00Z`); t += 86_400_000) out.push(new Date(t).toISOString().slice(0, 10));
  return out;
}

/** Working days in a range, excluding weekly-off days and listed holidays. */
export function workingDaysBetween(from: string, to: string, weeklyOff: number[] = [7], holidays: string[] = []) {
  return datesBetween(from, to).filter((d) => !weeklyOff.includes(isoWeekday(d)) && !holidays.includes(d)).length;
}

/** First and last date of a YYYY-MM period. */
export function periodRange(period: string) {
  const [y, m] = period.split('-').map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { from: `${period}-01`, to: `${period}-${String(last).padStart(2, '0')}` };
}

export const toMin = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
};

export interface ShiftRules {
  workStart: string; // HH:mm
  workEnd: string;
  graceMinutes: number;
  halfDayMinutes: number; // worked less than this = half day
}

/**
 * Classifies a day from clock-in/out times (minutes after midnight, local).
 * Late = arrived after start + grace; overtime = minutes worked beyond the scheduled day.
 */
export function evaluateDay(clockInMin: number, clockOutMin: number | null, rules: ShiftRules) {
  const start = toMin(rules.workStart);
  const end = toMin(rules.workEnd);
  const lateMinutes = Math.max(0, clockInMin - (start + rules.graceMinutes));
  if (clockOutMin === null) return { status: lateMinutes ? 'Late' : 'Present', lateMinutes, earlyLeaveMinutes: 0, workedMinutes: 0, overtimeMinutes: 0 } as const;
  const workedMinutes = Math.max(0, clockOutMin - clockInMin);
  const earlyLeaveMinutes = Math.max(0, end - clockOutMin);
  const overtimeMinutes = Math.max(0, workedMinutes - (end - start));
  const status = workedMinutes < rules.halfDayMinutes ? 'HalfDay' : lateMinutes > 0 ? 'Late' : 'Present';
  return { status, lateMinutes, earlyLeaveMinutes, workedMinutes, overtimeMinutes } as const;
}

export interface PayInputs {
  basic: number;
  allowances: Array<{ name: string; amount: number }>;
  deductions: Array<{ name: string; amount: number }>;
  taxPercent: number;
  overtimeRatePerHour: number;
  overtimeHours: number;
  bonus: number;
  otherDeduction: number;
  workingDays: number;
  unpaidLeaveDays: number;
  absentDays: number;
}

/**
 * Monthly pay. Unpaid leave and unexcused absence are deducted at the daily basic rate and reduce
 * the taxable amount; tax applies to the rest of gross.
 */
export function computePay(p: PayInputs) {
  const allowanceTotal = round2(p.allowances.reduce((s, a) => s + a.amount, 0));
  const overtimePay = round2(p.overtimeHours * p.overtimeRatePerHour);
  const gross = round2(p.basic + allowanceTotal + overtimePay + p.bonus);
  const dailyRate = p.workingDays > 0 ? p.basic / p.workingDays : 0;
  const unpaidLeaveDeduction = round2(dailyRate * p.unpaidLeaveDays);
  const absenceDeduction = round2(dailyRate * p.absentDays);
  const taxable = Math.max(0, gross - unpaidLeaveDeduction - absenceDeduction);
  const tax = round2((taxable * p.taxPercent) / 100);
  const fixedDeductions = round2(p.deductions.reduce((s, d) => s + d.amount, 0));
  const totalDeductions = round2(fixedDeductions + p.otherDeduction + unpaidLeaveDeduction + absenceDeduction + tax);
  return { allowanceTotal, overtimePay, gross, unpaidLeaveDeduction, absenceDeduction, taxable: round2(taxable), tax, fixedDeductions, totalDeductions, net: round2(Math.max(0, gross - totalDeductions)) };
}
