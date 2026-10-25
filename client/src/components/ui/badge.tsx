import type { ReactNode } from 'react';
import { cn, humanize } from '@/lib/utils';

export type Tone = 'neutral' | 'brand' | 'info' | 'ok' | 'warn' | 'danger' | 'violet';

const tones: Record<Tone, string> = {
  neutral: 'bg-subtle text-muted ring-border',
  brand: 'bg-brand/10 text-brand ring-brand/25',
  info: 'bg-info/10 text-info ring-info/25',
  ok: 'bg-ok/10 text-ok ring-ok/25',
  warn: 'bg-warn/10 text-warn ring-warn/30',
  danger: 'bg-danger/10 text-danger ring-danger/25',
  violet: 'bg-violet-500/10 text-violet-600 ring-violet-500/25 dark:text-violet-300',
};

export function Badge({ tone = 'neutral', children, className, dot }: { tone?: Tone; children: ReactNode; className?: string; dot?: boolean }) {
  return (
    <span className={cn('inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset', tones[tone], className)}>
      {dot && <span className="h-1.5 w-1.5 rounded-full bg-current" />}
      {children}
    </span>
  );
}

/** One place that maps every workflow status to a colour, so badges are consistent app-wide. */
const STATUS_TONE: Record<string, Tone> = {
  Scheduled: 'neutral',
  Confirmed: 'info',
  CheckedIn: 'violet',
  NurseAssessment: 'warn',
  WaitingForDoctor: 'brand',
  InConsultation: 'info',
  Completed: 'ok',
  Cancelled: 'danger',
  NoShow: 'danger',
  Draft: 'neutral',
  Issued: 'info',
  PartiallyPaid: 'warn',
  Paid: 'ok',
  Refunded: 'violet',
  Active: 'brand',
  PartiallyDispensed: 'warn',
  Dispensed: 'ok',
  Open: 'brand',
  Closed: 'neutral',
  // Laboratory
  Ordered: 'neutral',
  SamplePending: 'warn',
  SampleCollected: 'violet',
  InProgress: 'info',
  Verified: 'ok',
  // Purchasing
  PendingApproval: 'warn',
  Approved: 'info',
  PartiallyReceived: 'violet',
  Received: 'ok',
  // Emergency
  Registered: 'neutral',
  Triaged: 'warn',
  InTreatment: 'info',
  Admitted: 'violet',
  Discharged: 'ok',
  Referred: 'brand',
  LeftWithoutBeingSeen: 'danger',
  Deceased: 'neutral',
  // Beds
  Available: 'ok',
  Reserved: 'info',
  Occupied: 'violet',
  Cleaning: 'warn',
  Maintenance: 'neutral',
  // Claims
  Submitted: 'info',
  UnderReview: 'warn',
  PartiallyApproved: 'warn',
  Rejected: 'danger',
};

const TRIAGE_TONE: Record<string, string> = {
  Critical: 'bg-red-600 text-white',
  Urgent: 'bg-orange-500 text-white',
  SemiUrgent: 'bg-amber-300 text-amber-950',
  NonUrgent: 'bg-emerald-600 text-white',
};
export const TRIAGE_LABEL: Record<string, string> = { Critical: 'Critical', Urgent: 'Urgent', SemiUrgent: 'Semi-urgent', NonUrgent: 'Non-urgent' };

/** Solid, high-contrast triage chip (colour-coded the way ER staff expect). */
export function TriageBadge({ level, className }: { level?: string; className?: string }) {
  if (!level) return <span className={cn('inline-flex rounded px-2 py-0.5 text-[11px] font-semibold ring-1 ring-inset ring-border text-muted', className)}>Not triaged</span>;
  return <span className={cn('inline-flex rounded px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide', TRIAGE_TONE[level], className)}>{TRIAGE_LABEL[level] ?? level}</span>;
}

const FLAG_TONE: Record<string, Tone> = { L: 'warn', H: 'warn', LL: 'danger', HH: 'danger', A: 'warn' };
const FLAG_LABEL: Record<string, string> = { L: 'Low', H: 'High', LL: 'Critical low', HH: 'Critical high', A: 'Abnormal' };

/** Lab result flag chip; renders nothing for normal values. */
export function FlagBadge({ flag }: { flag?: string }) {
  if (!flag || flag === 'N') return null;
  return <Badge tone={FLAG_TONE[flag] ?? 'warn'}>{FLAG_LABEL[flag] ?? flag}</Badge>;
}

export function PriorityBadge({ priority }: { priority: string }) {
  if (priority === 'Routine') return <Badge>Routine</Badge>;
  return <Badge tone="danger" dot>{priority}</Badge>;
}

export function StatusBadge({ status, className }: { status: string; className?: string }) {
  return (
    <Badge tone={STATUS_TONE[status] ?? 'neutral'} dot className={className}>
      {status === 'WaitingForDoctor' ? 'Ready for doctor' : status === 'LeftWithoutBeingSeen' ? 'Left without being seen' : humanize(status)}
    </Badge>
  );
}
