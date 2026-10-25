import type { ReactNode } from 'react';
import { AlertTriangle, ArrowDown, ArrowUp, Minus } from 'lucide-react';
import { isOutOfRange, VITAL_RANGES } from '@hms/shared';
import { cn, formatDateTime, initials } from '@/lib/utils';
import { Badge } from './ui/badge';
import type { Allergy, Vitals } from '@/types';

export function PatientBanner({
  name,
  mrn,
  age,
  gender,
  bloodGroup,
  phone,
  allergies,
  right,
}: {
  name: string;
  mrn: string;
  age?: number;
  gender?: string;
  bloodGroup?: string;
  phone?: string;
  allergies?: Allergy[];
  right?: ReactNode;
}) {
  return (
    <div className="rounded-lg border border-border bg-surface shadow-card">
      <div className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center">
        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-brand/15 text-base font-semibold text-brand">{initials(name)}</div>
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-lg font-semibold">{name}</h1>
          <div className="mt-0.5 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
            <span className="num font-mono font-medium text-fg">{mrn}</span>
            {age !== undefined && <span>{age} yrs</span>}
            {gender && <span>{gender}</span>}
            {bloodGroup && bloodGroup !== 'Unknown' && <span>Blood {bloodGroup}</span>}
            {phone && <span className="num">{phone}</span>}
          </div>
        </div>
        {right && <div className="flex flex-wrap gap-2">{right}</div>}
      </div>
      <AllergyStrip allergies={allergies} />
    </div>
  );
}

export function AllergyStrip({ allergies }: { allergies?: Allergy[] }) {
  if (!allergies) return null;
  return allergies.length ? (
    <div className="flex flex-wrap items-center gap-2 border-t border-danger/20 bg-danger/[0.06] px-4 py-2 text-xs">
      <AlertTriangle className="h-4 w-4 text-danger" />
      <span className="font-semibold text-danger">Allergies:</span>
      {allergies.map((a) => (
        <Badge key={a._id} tone="danger">
          {a.allergen} · {a.severity}
        </Badge>
      ))}
    </div>
  ) : (
    <div className="border-t border-border px-4 py-2 text-xs text-muted">No known allergies</div>
  );
}

const ROWS: Array<{ key: keyof typeof VITAL_RANGES | 'bp'; label: string; get: (v: Vitals) => number | undefined; fmt?: (v: Vitals) => string }> = [
  { key: 'bp', label: 'Blood pressure', get: (v) => v.systolicBp, fmt: (v) => `${v.systolicBp}/${v.diastolicBp}` },
  { key: 'heartRate', label: 'Heart rate', get: (v) => v.heartRate },
  { key: 'temperatureC', label: 'Temperature', get: (v) => v.temperatureC },
  { key: 'spo2', label: 'SpO₂', get: (v) => v.spo2 },
  { key: 'respiratoryRate', label: 'Resp. rate', get: (v) => v.respiratoryRate },
  { key: 'bmi', label: 'BMI', get: (v) => v.bmi },
  { key: 'painScale', label: 'Pain', get: (v) => v.painScale },
];

const unitOf = (key: string) => (key === 'bp' ? 'mmHg' : VITAL_RANGES[key as keyof typeof VITAL_RANGES]?.unit ?? '');
const abnormal = (key: string, v: Vitals) =>
  key === 'bp' ? isOutOfRange('systolicBp', v.systolicBp) || isOutOfRange('diastolicBp', v.diastolicBp) : isOutOfRange(key as keyof typeof VITAL_RANGES, ROWS.find((r) => r.key === key)!.get(v));

/** Current vs previous reading with trend arrows; abnormal values highlighted. */
export function VitalsComparison({ current, previous }: { current?: Vitals; previous?: Vitals }) {
  if (!current) return <p className="text-sm text-muted">No vitals recorded yet.</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-[11px] uppercase tracking-wide text-muted">
            <th className="py-1.5 pr-3 font-semibold">Measure</th>
            <th className="py-1.5 pr-3 font-semibold">Current</th>
            <th className="py-1.5 pr-3 font-semibold">Previous</th>
            <th className="py-1.5 font-semibold">Trend</th>
          </tr>
        </thead>
        <tbody>
          {ROWS.map((r) => {
            const c = r.get(current);
            const p = previous ? r.get(previous) : undefined;
            if (c === undefined || c === null) return null;
            const diff = p !== undefined && p !== null ? c - p : 0;
            return (
              <tr key={r.key} className="border-t border-border/70">
                <td className="py-1.5 pr-3 text-muted">{r.label}</td>
                <td className={cn('num py-1.5 pr-3 font-medium', abnormal(r.key, current) && 'text-danger')}>
                  {r.fmt ? r.fmt(current) : c} <span className="text-[10px] font-normal text-muted">{unitOf(r.key)}</span>
                  {abnormal(r.key, current) && <AlertTriangle className="ml-1 inline h-3 w-3" />}
                </td>
                <td className="num py-1.5 pr-3 text-muted">{previous ? (r.fmt ? r.fmt(previous) : p ?? '—') : '—'}</td>
                <td className="py-1.5">
                  {!previous ? <span className="text-muted">—</span> : diff > 0 ? <ArrowUp className="h-3.5 w-3.5 text-warn" /> : diff < 0 ? <ArrowDown className="h-3.5 w-3.5 text-info" /> : <Minus className="h-3.5 w-3.5 text-muted" />}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="mt-2 text-[11px] text-muted">
        Recorded {formatDateTime(current.recordedAt)}
        {current.recordedByName ? ` by ${current.recordedByName}` : ''}
      </p>
    </div>
  );
}

export function VitalsHistoryTable({ rows }: { rows: Vitals[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border bg-subtle/60 text-left text-[11px] uppercase tracking-wide text-muted">
            {['Recorded', 'BP', 'HR', 'Temp', 'SpO₂', 'RR', 'Wt', 'Ht', 'BMI', 'Pain', 'By'].map((h) => (
              <th key={h} className="whitespace-nowrap px-3 py-2 font-semibold">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((v) => {
            const bad = (k: string) => (abnormal(k, v) ? 'font-semibold text-danger' : '');
            return (
              <tr key={v._id} className="num border-b border-border/70">
                <td className="whitespace-nowrap px-3 py-2 text-muted">{formatDateTime(v.recordedAt)}</td>
                <td className={cn('px-3 py-2', bad('bp'))}>{v.systolicBp}/{v.diastolicBp}</td>
                <td className={cn('px-3 py-2', bad('heartRate'))}>{v.heartRate}</td>
                <td className={cn('px-3 py-2', bad('temperatureC'))}>{v.temperatureC}</td>
                <td className={cn('px-3 py-2', bad('spo2'))}>{v.spo2}</td>
                <td className={cn('px-3 py-2', bad('respiratoryRate'))}>{v.respiratoryRate ?? '—'}</td>
                <td className="px-3 py-2">{v.weightKg}</td>
                <td className="px-3 py-2">{v.heightCm}</td>
                <td className={cn('px-3 py-2', bad('bmi'))}>{v.bmi ?? '—'}</td>
                <td className={cn('px-3 py-2', bad('painScale'))}>{v.painScale ?? '—'}</td>
                <td className="whitespace-nowrap px-3 py-2 text-muted">{v.recordedByName ?? '—'}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
