import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { CalendarPlus, FileText, LogIn, LogOut, Star } from 'lucide-react';
import { LEAVE_TYPES, isoWeekday } from '@hms/shared';
import { api, openPdf, type Paged } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { cn, formatDate, formatTime, money, todayIso } from '@/lib/utils';
import { Button, Card, CardHeader, EmptyState, Input, PageHeader, PageLoader, Select, Textarea } from '@/components/ui/primitives';
import { DataTable, StatCard, Tabs } from '@/components/ui/data';
import { StatusBadge } from '@/components/ui/badge';
import { Dialog } from '@/components/ui/overlay';
import { Field, handleFormError } from '@/components/form/Field';
import type { AttendanceRecord, AttendanceSummaryRow, EmployeeProfile, LeaveBalance, LeaveRequest, Payslip } from '@/types';
import { LeaveDecisionDialog, LeaveTable, hours } from './HrPages';

interface MyAttendance {
  records: AttendanceRecord[];
  summary: AttendanceSummaryRow | null;
  workingDays: number;
  today: AttendanceRecord | null;
}

const STATUS_COLOR: Record<string, string> = {
  Present: 'bg-emerald-500',
  Late: 'bg-amber-500',
  HalfDay: 'bg-orange-500',
  Absent: 'bg-red-500',
  OnLeave: 'bg-blue-500',
  WeeklyOff: 'bg-slate-300 dark:bg-slate-600',
  Holiday: 'bg-violet-400',
};

/** Self-service for every staff member: clock in/out, attendance, leave, payslips and reviews. */
export function MyWorkspacePage() {
  const { user } = useAuth();
  const [tab, setTab] = useState<'attendance' | 'leave' | 'payslips' | 'reviews' | 'team'>('attendance');
  const { data: me, isLoading, error } = useQuery({ queryKey: ['employee', user?.employeeId], queryFn: () => api.get<EmployeeProfile>(`/hr/employees/${user!.employeeId}`), enabled: !!user?.employeeId });
  if (!user?.employeeId) {
    return (
      <>
        <PageHeader title="My workspace" />
        <Card><EmptyState title="Your account is not linked to an employee record" description="Ask HR to link your user account to your employee profile." /></Card>
      </>
    );
  }
  if (isLoading) return <PageLoader />;
  if (error || !me) return <Card><EmptyState title="Could not load your profile" /></Card>;
  const pendingReviews = me.reviews.filter((r) => r.status === 'Submitted').length;
  const tabs: Array<{ key: typeof tab; label: string; count?: number }> = [
    { key: 'attendance', label: 'Attendance' },
    { key: 'leave', label: 'Leave' },
    { key: 'payslips', label: 'Payslips' },
    { key: 'reviews', label: 'Reviews', count: pendingReviews || undefined },
  ];
  if (me.directReports.length) tabs.push({ key: 'team', label: 'My team' });
  return (
    <>
      <PageHeader title="My workspace" description={`${me.employeeNo} · ${me.designation} · ${typeof me.departmentId === 'object' ? me.departmentId.name : ''}`} />
      <ClockCard />
      <Tabs tabs={tabs} value={tab} onChange={setTab} className="my-4" />
      {tab === 'attendance' && <MyAttendanceTab />}
      {tab === 'leave' && <MyLeaveTab />}
      {tab === 'payslips' && <MyPayslipsTab />}
      {tab === 'reviews' && <MyReviewsTab profile={me} />}
      {tab === 'team' && <TeamTab profile={me} />}
    </>
  );
}

function ClockCard() {
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ['my-attendance', todayIso().slice(0, 7)], queryFn: () => api.get<MyAttendance>('/me/attendance') });
  const today = data?.today;
  const m = useMutation({
    mutationFn: (op: 'clock-in' | 'clock-out') => api.post<AttendanceRecord>(`/me/attendance/${op}`),
    onSuccess: (r, op) => {
      toast.success(op === 'clock-in' ? `Clocked in at ${formatTime(r.clockIn)}${r.lateMinutes ? ` (${r.lateMinutes} min late)` : ''}` : `Clocked out — ${hours(r.workedMinutes)} worked${r.overtimeMinutes ? `, ${hours(r.overtimeMinutes)} overtime` : ''}`);
      qc.invalidateQueries({ queryKey: ['my-attendance'] });
    },
    onError: (e) => handleFormError(e),
  });
  return (
    <Card className="flex flex-wrap items-center gap-4 p-4">
      <div className="flex-1">
        <p className="text-xs uppercase tracking-wide text-muted">{formatDate(new Date(), { weekday: 'long', day: 'numeric', month: 'long' })}</p>
        <p className="mt-1 text-sm">
          {!today?.clockIn && (today ? <>Today: <StatusBadge status={today.status} /></> : 'You have not clocked in yet.')}
          {today?.clockIn && <>In at <b>{formatTime(today.clockIn)}</b>{today.clockOut && <> · out at <b>{formatTime(today.clockOut)}</b> · {hours(today.workedMinutes)} worked</>} · <StatusBadge status={today.status} /></>}
        </p>
      </div>
      {!today?.clockIn && today?.status !== 'OnLeave' && <Button icon={<LogIn className="h-4 w-4" />} loading={m.isPending} onClick={() => m.mutate('clock-in')}>Clock in</Button>}
      {today?.clockIn && !today.clockOut && <Button variant="outline" icon={<LogOut className="h-4 w-4" />} loading={m.isPending} onClick={() => m.mutate('clock-out')}>Clock out</Button>}
    </Card>
  );
}

function MyAttendanceTab() {
  const [period, setPeriod] = useState(todayIso().slice(0, 7));
  const { data } = useQuery({ queryKey: ['my-attendance', period], queryFn: () => api.get<MyAttendance>('/me/attendance', { period }) });
  const [y, mo] = period.split('-').map(Number);
  const days = new Date(y, mo, 0).getDate();
  const lead = isoWeekday(`${period}-01`) - 1;
  const byDate = new Map((data?.records ?? []).map((r) => [r.date, r]));
  const s = data?.summary;
  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <Card className="lg:col-span-2">
        <CardHeader title="Calendar" actions={<Input type="month" value={period} max={todayIso().slice(0, 7)} onChange={(e) => setPeriod(e.target.value)} className="h-8 w-40" />} />
        <div className="p-4">
          <div className="grid grid-cols-7 gap-1 text-center text-[11px] text-muted">{['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d) => <span key={d}>{d}</span>)}</div>
          <div className="mt-1 grid grid-cols-7 gap-1">
            {Array.from({ length: lead }).map((_, i) => <span key={`l${i}`} />)}
            {Array.from({ length: days }).map((_, i) => {
              const date = `${period}-${String(i + 1).padStart(2, '0')}`;
              const r = byDate.get(date);
              return (
                <div key={date} title={r ? `${r.status}${r.clockIn ? ` · ${formatTime(r.clockIn)}–${formatTime(r.clockOut) || '…'}` : ''}` : undefined} className={cn('flex h-12 flex-col items-center justify-center rounded-md border border-border text-xs', date === todayIso() && 'ring-2 ring-brand')}>
                  <span>{i + 1}</span>
                  {r && <span className={cn('mt-1 h-1.5 w-6 rounded-full', STATUS_COLOR[r.status])} />}
                </div>
              );
            })}
          </div>
          <div className="mt-3 flex flex-wrap gap-3 text-[11px] text-muted">{Object.entries(STATUS_COLOR).map(([k, c]) => <span key={k} className="flex items-center gap-1"><span className={cn('h-2 w-2 rounded-full', c)} />{k}</span>)}</div>
        </div>
      </Card>
      <div className="grid grid-cols-2 content-start gap-3">
        <StatCard label="Working days" value={data?.workingDays ?? '…'} />
        <StatCard label="Present" value={s?.present ?? 0} tone="ok" />
        <StatCard label="Late" value={s?.late ?? 0} hint={s?.lateMinutes ? `${s.lateMinutes} min total` : undefined} tone="warn" />
        <StatCard label="Absent" value={s?.absent ?? 0} tone="danger" />
        <StatCard label="On leave" value={s?.onLeave ?? 0} tone="info" />
        <StatCard label="Overtime" value={hours(s?.overtimeMinutes)} tone="violet" />
      </div>
    </div>
  );
}

function MyLeaveTab() {
  const qc = useQueryClient();
  const [applying, setApplying] = useState(false);
  const { data } = useQuery({ queryKey: ['my-leave'], queryFn: () => api.get<{ balances: LeaveBalance[]; requests: LeaveRequest[] }>('/me/leave') });
  const cancel = useMutation({ mutationFn: (id: string) => api.post(`/hr/leave/${id}/cancel`), onSuccess: () => { toast.success('Leave cancelled; balance restored'); qc.invalidateQueries({ queryKey: ['my-leave'] }); }, onError: (e) => handleFormError(e) });
  if (!data) return <PageLoader />;
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        {data.balances.map((b) => <StatCard key={b.type} label={`${b.type}`} value={b.available ?? '—'} hint={b.available === null ? `${b.used} taken` : `${b.used} used · ${b.pending} pending of ${b.entitled}`} tone={b.available === 0 ? 'danger' : 'brand'} />)}
      </div>
      <Card>
        <CardHeader title="My leave requests" actions={<Button size="sm" icon={<CalendarPlus className="h-4 w-4" />} onClick={() => setApplying(true)}>Apply for leave</Button>} />
        <LeaveTable rows={data.requests} actions={(l) => (['PendingManager', 'PendingHR'].includes(l.status) || (l.status === 'Approved' && l.from > todayIso())) && <Button size="sm" variant="ghost" loading={cancel.isPending && cancel.variables === l._id} onClick={() => cancel.mutate(l._id)}>Cancel</Button>} />
      </Card>
      <ApplyLeaveDialog open={applying} balances={data.balances} onClose={() => setApplying(false)} />
    </div>
  );
}

function ApplyLeaveDialog({ open, balances, onClose }: { open: boolean; balances: LeaveBalance[]; onClose: () => void }) {
  const qc = useQueryClient();
  const [type, setType] = useState('Annual');
  const [from, setFrom] = useState(todayIso());
  const [to, setTo] = useState(todayIso());
  const [halfDay, setHalfDay] = useState(false);
  const [reason, setReason] = useState('');
  const m = useMutation({
    mutationFn: () => api.post<LeaveRequest>('/me/leave', { type, from, to, halfDay, reason }),
    onSuccess: (l) => {
      toast.success(`${l.requestNo}: ${l.days} day(s) requested — ${l.status === 'PendingManager' ? 'sent to your manager' : 'sent to HR'}`);
      qc.invalidateQueries({ queryKey: ['my-leave'] });
      setReason('');
      onClose();
    },
    onError: (e) => handleFormError(e),
  });
  const bal = balances.find((b) => b.type === type);
  return (
    <Dialog open={open} onClose={onClose} title="Apply for leave" description="Weekly offs and holidays are not counted. Only sick leave can be back-dated." footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button disabled={reason.trim().length < 3 || to < from} loading={m.isPending} onClick={() => m.mutate()}>Submit request</Button></>}>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Type" className="col-span-2" hint={bal ? (bal.available === null ? 'Unpaid — deducted from salary' : `${bal.available} day(s) available`) : undefined}>
          <Select value={type} onChange={(e) => setType(e.target.value)}>{LEAVE_TYPES.map((t) => <option key={t}>{t}</option>)}</Select>
        </Field>
        <Field label="From" required><Input type="date" value={from} onChange={(e) => { setFrom(e.target.value); if (e.target.value > to || halfDay) setTo(e.target.value); }} /></Field>
        <Field label="To" required><Input type="date" value={to} min={from} disabled={halfDay} onChange={(e) => setTo(e.target.value)} /></Field>
        <label className="col-span-2 flex items-center gap-2 text-sm"><input type="checkbox" checked={halfDay} onChange={(e) => { setHalfDay(e.target.checked); if (e.target.checked) setTo(from); }} /> Half day</label>
        <Field label="Reason" required className="col-span-2"><Textarea value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
      </div>
    </Dialog>
  );
}

function MyPayslipsTab() {
  const { user } = useAuth();
  const { data } = useQuery({ queryKey: ['my-payslips'], queryFn: () => api.get<Payslip[]>('/me/payslips') });
  const cur = user?.hospital.currency;
  return (
    <Card>
      <DataTable
        rows={data}
        rowKey={(p) => p._id}
        empty={{ icon: <FileText className="h-5 w-5" />, title: 'No payslips yet', description: 'Payslips appear here once payroll is processed.' }}
        columns={[
          { key: 'p', header: 'Month', cell: (p) => formatDate(`${p.period}-01`, { month: 'long', year: 'numeric' }) },
          { key: 'n', header: 'Payslip', cell: (p) => <span className="font-mono text-xs">{p.payslipNo}</span> },
          { key: 'g', header: 'Gross', align: 'right', cell: (p) => money(p.gross, cur) },
          { key: 'd', header: 'Deductions', align: 'right', cell: (p) => money(p.totalDeductions, cur), hideOnMobile: true },
          { key: 't', header: 'Net pay', align: 'right', cell: (p) => <b>{money(p.net, cur)}</b> },
          { key: 'a', header: '', cell: (p) => <Button size="sm" variant="ghost" icon={<FileText className="h-4 w-4" />} onClick={() => openPdf(`/payroll/payslips/${p._id}/pdf`).catch((e) => handleFormError(e))}>PDF</Button> },
        ]}
      />
    </Card>
  );
}

function MyReviewsTab({ profile }: { profile: EmployeeProfile }) {
  const qc = useQueryClient();
  const { user } = useAuth();
  const [ack, setAck] = useState<string | null>(null);
  const [comment, setComment] = useState('');
  const m = useMutation({ mutationFn: () => api.post(`/me/reviews/${ack}/acknowledge`, { comment: comment || undefined }), onSuccess: () => { toast.success('Review acknowledged'); setAck(null); setComment(''); qc.invalidateQueries({ queryKey: ['employee', user?.employeeId] }); }, onError: (e) => handleFormError(e) });
  const shown = profile.reviews.filter((r) => r.status !== 'Draft');
  return (
    <Card>
      {shown.length ? (
        <ul className="divide-y divide-border">
          {shown.map((r) => (
            <li key={r._id} className="space-y-1 px-4 py-3 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <b>{r.period}</b>
                <span className="text-amber-500">{'★'.repeat(r.rating)}<span className="text-border">{'★'.repeat(5 - r.rating)}</span></span>
                <StatusBadge status={r.status} />
                <span className="text-xs text-muted">by {r.reviewerName}</span>
                {r.status === 'Submitted' && <Button size="sm" className="ml-auto" icon={<Star className="h-4 w-4" />} onClick={() => setAck(r._id)}>Acknowledge</Button>}
              </div>
              {r.strengths && <p className="text-xs"><b>Strengths:</b> {r.strengths}</p>}
              {r.improvements && <p className="text-xs"><b>To improve:</b> {r.improvements}</p>}
              {r.goals && <p className="text-xs"><b>Goals:</b> {r.goals}</p>}
              {r.employeeComment && <p className="text-xs text-muted">Your comment: “{r.employeeComment}”</p>}
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState title="No reviews shared with you yet" />
      )}
      <Dialog open={!!ack} onClose={() => setAck(null)} title="Acknowledge review" footer={<><Button variant="outline" onClick={() => setAck(null)}>Cancel</Button><Button loading={m.isPending} onClick={() => m.mutate()}>Acknowledge</Button></>}>
        <Field label="Your comments (optional)"><Textarea value={comment} onChange={(e) => setComment(e.target.value)} /></Field>
      </Dialog>
    </Card>
  );
}

function TeamTab({ profile }: { profile: EmployeeProfile }) {
  const qc = useQueryClient();
  const [deciding, setDeciding] = useState<{ leave: LeaveRequest; approve: boolean } | null>(null);
  const { data } = useQuery({ queryKey: ['leave', 'team'], queryFn: () => api.get<Paged<LeaveRequest>>('/hr/leave', { scope: 'team', pageSize: 50 }) });
  const pending = data?.items.filter((l) => l.status === 'PendingManager') ?? [];
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader title="Leave awaiting your approval" description="After you approve, HR makes the final decision." />
        <LeaveTable showEmployee rows={pending} actions={(l) => <div className="flex gap-1"><Button size="sm" onClick={() => setDeciding({ leave: l, approve: true })}>Approve</Button><Button size="sm" variant="outline" onClick={() => setDeciding({ leave: l, approve: false })}>Reject</Button></div>} />
      </Card>
      <Card>
        <CardHeader title={`Team (${profile.directReports.length})`} description="Recent leave history for your direct reports" />
        <LeaveTable showEmployee rows={data?.items.filter((l) => l.status !== 'PendingManager')} />
      </Card>
      <LeaveDecisionDialog value={deciding} stage="manager" onClose={() => setDeciding(null)} onDone={() => qc.invalidateQueries({ queryKey: ['leave'] })} />
    </div>
  );
}
