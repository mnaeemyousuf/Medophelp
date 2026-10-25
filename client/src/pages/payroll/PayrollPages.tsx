import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Ban, BadgeCheck, Calculator, FileText, Plus, RefreshCcw, Send, Trash2, Undo2, Wallet } from 'lucide-react';
import { api, openPdf } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { formatDate, formatDateTime, humanize, money, todayIso } from '@/lib/utils';
import { Button, Card, CardHeader, EmptyState, Input, PageHeader, PageLoader, Textarea } from '@/components/ui/primitives';
import { DataTable, KeyValue, StatCard } from '@/components/ui/data';
import { StatusBadge } from '@/components/ui/badge';
import { Dialog, Drawer } from '@/components/ui/overlay';
import { Field, handleFormError } from '@/components/form/Field';
import type { LineItem, PayrollItem, PayrollRun, SalaryStructure } from '@/types';

const periodLabel = (p: string) => formatDate(`${p}-01`, { month: 'long', year: 'numeric' });

export function PayrollPage() {
  const navigate = useNavigate();
  const { can, user } = useAuth();
  const qc = useQueryClient();
  const [creating, setCreating] = useState(false);
  const [period, setPeriod] = useState(todayIso().slice(0, 7));
  const { data: runs, isLoading } = useQuery({ queryKey: ['payroll-runs'], queryFn: () => api.get<PayrollRun[]>('/payroll/runs') });
  const create = useMutation({
    mutationFn: () => api.post<PayrollRun & { skipped: string[] }>('/payroll/runs', { period }),
    onSuccess: (r) => {
      toast.success(`${r.runNo} prepared for ${r.employees} employees${r.skipped.length ? ` · ${r.skipped.length} skipped (no salary structure)` : ''}`);
      qc.invalidateQueries({ queryKey: ['payroll-runs'] });
      setCreating(false);
      navigate(`/payroll/runs/${r._id}`);
    },
    onError: (e) => handleFormError(e),
  });
  const cur = user?.hospital.currency;
  const last = runs?.find((r) => r.status === 'Processed');
  const pending = runs?.filter((r) => ['Draft', 'Review', 'Approved'].includes(r.status)) ?? [];
  return (
    <>
      <PageHeader
        title="Payroll"
        description="Monthly runs are built from salary structures, attendance and approved leave. A run is prepared and processed by payroll, and approved by someone else."
        actions={can('payroll.manage') && <Button icon={<Plus className="h-4 w-4" />} onClick={() => setCreating(true)}>New payroll run</Button>}
      />
      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard label="Last processed" value={last ? periodLabel(last.period) : '—'} hint={last?.runNo} icon={<BadgeCheck className="h-4 w-4" />} tone="ok" />
        <StatCard label="Last net payout" value={money(last?.totals.net, cur)} hint={last ? `${last.employees} employees` : undefined} icon={<Wallet className="h-4 w-4" />} />
        <StatCard label="Last tax withheld" value={money(last?.totals.tax, cur)} icon={<Calculator className="h-4 w-4" />} tone="info" />
        <StatCard label="Runs in progress" value={pending.length} hint={pending.map((r) => `${r.period} ${humanize(r.status).toLowerCase()}`).join(', ') || undefined} icon={<FileText className="h-4 w-4" />} tone="warn" />
      </div>
      <Card>
        <CardHeader title="Payroll runs" />
        {isLoading ? <PageLoader /> : (
          <DataTable
            rows={runs}
            rowKey={(r) => r._id}
            onRowClick={(r) => navigate(`/payroll/runs/${r._id}`)}
            empty={{ icon: <Wallet className="h-5 w-5" />, title: 'No payroll runs yet' }}
            columns={[
              { key: 'no', header: 'Run', cell: (r) => <div><p className="font-mono text-xs font-medium">{r.runNo}</p><p className="text-[11px] text-muted">{r.preparedByName}</p></div> },
              { key: 'p', header: 'Period', cell: (r) => periodLabel(r.period) },
              { key: 'e', header: 'Employees', align: 'right', cell: (r) => r.employees },
              { key: 'g', header: 'Gross', align: 'right', cell: (r) => money(r.totals.gross, cur), hideOnMobile: true },
              { key: 'n', header: 'Net', align: 'right', cell: (r) => <b>{money(r.totals.net, cur)}</b> },
              { key: 's', header: 'Status', cell: (r) => <StatusBadge status={r.status} /> },
            ]}
          />
        )}
      </Card>
      <Dialog open={creating} onClose={() => setCreating(false)} title="New payroll run" description="Pulls each active employee's salary, attendance (absences, overtime) and approved leave for the month." footer={<><Button variant="outline" onClick={() => setCreating(false)}>Cancel</Button><Button loading={create.isPending} onClick={() => create.mutate()}>Prepare run</Button></>}>
        <Field label="Month"><Input type="month" value={period} max={todayIso().slice(0, 7)} onChange={(e) => setPeriod(e.target.value)} /></Field>
      </Dialog>
    </>
  );
}

type RunDetail = PayrollRun & { items: Array<PayrollItem & { payslipId?: string; payslipNo?: string }>; byDepartment: Array<{ department: string; employees: number; gross: number; net: number }> };

export function PayrollRunPage() {
  const { id } = useParams();
  const { can, user } = useAuth();
  const qc = useQueryClient();
  const [adjusting, setAdjusting] = useState<PayrollItem | null>(null);
  const [action, setAction] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [search, setSearch] = useState('');
  const { data: run, isLoading } = useQuery({ queryKey: ['payroll-run', id], queryFn: () => api.get<RunDetail>(`/payroll/runs/${id}`) });
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['payroll-run', id] });
    qc.invalidateQueries({ queryKey: ['payroll-runs'] });
  };
  const act = useMutation({
    mutationFn: (op: string) => api.post(`/payroll/runs/${id}/${op}`, op === 'regenerate' ? undefined : { note: note || undefined }),
    onSuccess: (_d, op) => {
      toast.success({ submit: 'Sent for approval', approve: 'Payroll approved', reject: 'Returned to draft', process: 'Processed — payslips issued and staff notified', cancel: 'Run cancelled', regenerate: 'Recalculated from current data' }[op] ?? 'Done');
      setAction(null);
      setNote('');
      refresh();
    },
    onError: (e) => handleFormError(e),
  });
  if (isLoading || !run) return <PageLoader />;
  const cur = user?.hospital.currency;
  const own = run.preparedByName === user?.fullName;
  const items = run.items.filter((i) => !search || `${i.employeeName} ${i.employeeNo} ${i.departmentName}`.toLowerCase().includes(search.toLowerCase()));
  const editable = ['Draft', 'Review'].includes(run.status) && can('payroll.manage');
  const actions: Array<[string, string, React.ReactNode, boolean]> = [
    ['regenerate', 'Recalculate', <RefreshCcw key="r" className="h-4 w-4" />, run.status === 'Draft' && can('payroll.manage')],
    ['submit', 'Submit for approval', <Send key="s" className="h-4 w-4" />, run.status === 'Draft' && can('payroll.manage')],
    ['approve', 'Approve', <BadgeCheck key="a" className="h-4 w-4" />, run.status === 'Review' && can('payroll.approve')],
    ['reject', 'Return to draft', <Undo2 key="u" className="h-4 w-4" />, ['Review', 'Approved'].includes(run.status) && can('payroll.approve')],
    ['process', 'Process & issue payslips', <Wallet key="p" className="h-4 w-4" />, run.status === 'Approved' && can('payroll.manage')],
    ['cancel', 'Cancel run', <Ban key="c" className="h-4 w-4" />, ['Draft', 'Review'].includes(run.status) && can('payroll.manage')],
  ];
  return (
    <div className="space-y-4">
      <PageHeader
        title={`${run.runNo} · ${periodLabel(run.period)}`}
        description={<span className="flex flex-wrap items-center gap-2"><StatusBadge status={run.status} /> {run.workingDays} working days · prepared by {run.preparedByName}{run.approvedByName && ` · approved by ${run.approvedByName}`}</span>}
        actions={actions.filter(([, , , show]) => show).map(([op, label, icon]) => (
          <Button key={op} variant={op === 'cancel' || op === 'reject' || op === 'regenerate' ? 'outline' : 'primary'} icon={icon} onClick={() => (op === 'regenerate' ? act.mutate(op) : setAction(op))} loading={act.isPending && act.variables === op}>{label}</Button>
        ))}
      />
      {run.status === 'Review' && own && can('payroll.approve') && <p className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:bg-amber-950/30 dark:text-amber-300">You prepared this run, so another approver must approve it.</p>}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <StatCard label="Employees" value={run.employees} />
        <StatCard label="Gross" value={money(run.totals.gross, cur)} />
        <StatCard label="Deductions" value={money(run.totals.deductions, cur)} tone="warn" />
        <StatCard label="Tax" value={money(run.totals.tax, cur)} tone="info" />
        <StatCard label="Net payout" value={money(run.totals.net, cur)} tone="ok" />
      </div>
      <Card>
        <CardHeader title="By department" />
        <DataTable rows={run.byDepartment} rowKey={(d) => d.department} columns={[{ key: 'd', header: 'Department', cell: (d) => d.department }, { key: 'e', header: 'Employees', align: 'right', cell: (d) => d.employees }, { key: 'g', header: 'Gross', align: 'right', cell: (d) => money(d.gross, cur) }, { key: 'n', header: 'Net', align: 'right', cell: (d) => money(d.net, cur) }]} />
      </Card>
      <Card>
        <CardHeader title="Employees" actions={<Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Filter…" className="h-8 w-48" />} />
        <DataTable
          rows={items}
          rowKey={(i) => i._id}
          onRowClick={editable ? (i) => setAdjusting(i) : undefined}
          columns={[
            { key: 'e', header: 'Employee', cell: (i) => <div><p className="font-medium">{i.employeeName}</p><p className="text-[11px] text-muted">{i.employeeNo} · {i.departmentName}</p></div> },
            { key: 'd', header: 'Days', cell: (i) => <span className="text-[11px] text-muted">{i.presentDays}P · {i.absentDays}A · {i.paidLeaveDays}L{i.unpaidLeaveDays ? ` · ${i.unpaidLeaveDays}U` : ''}{i.overtimeHours ? ` · ${i.overtimeHours}h OT` : ''}</span>, hideOnMobile: true },
            { key: 'b', header: 'Basic', align: 'right', cell: (i) => money(i.basic, cur), hideOnMobile: true },
            { key: 'g', header: 'Gross', align: 'right', cell: (i) => money(i.gross, cur) },
            { key: 'x', header: 'Deductions', align: 'right', cell: (i) => <span title={`Tax ${i.tax} · absence ${i.absenceDeduction} · unpaid ${i.unpaidLeaveDeduction}`}>{money(i.totalDeductions, cur)}</span>, hideOnMobile: true },
            { key: 'n', header: 'Net', align: 'right', cell: (i) => <div><b>{money(i.net, cur)}</b>{(i.bonus > 0 || i.otherDeduction > 0) && <p className="text-[11px] text-muted">adjusted</p>}</div> },
            { key: 'p', header: '', cell: (i) => i.payslipId && <Button size="sm" variant="ghost" icon={<FileText className="h-4 w-4" />} onClick={(ev) => { ev.stopPropagation(); openPdf(`/payroll/payslips/${i.payslipId}/pdf`).catch((e) => handleFormError(e)); }}>Payslip</Button> },
          ]}
        />
      </Card>
      {run.history && (
        <Card>
          <CardHeader title="History" />
          <ol className="space-y-1 p-4 text-sm">{run.history.map((h, i) => <li key={i}><b>{humanize(h.status)}</b> · {formatDateTime(h.at)} · {h.byName}{h.note && <span className="text-muted"> — {h.note}</span>}</li>)}</ol>
        </Card>
      )}
      <AdjustDrawer item={adjusting} currency={cur} onClose={() => setAdjusting(null)} onDone={refresh} />
      <Dialog open={!!action} onClose={() => setAction(null)} title={actions.find(([op]) => op === action)?.[1] as string} footer={<><Button variant="outline" onClick={() => setAction(null)}>Back</Button><Button variant={action === 'cancel' ? 'danger' : 'primary'} loading={act.isPending} onClick={() => act.mutate(action!)}>Confirm</Button></>}>
        {action === 'process' && <p className="mb-3 text-sm">This locks the run, issues {run.employees} payslips and notifies staff. It cannot be undone.</p>}
        <Field label="Note (optional)"><Textarea value={note} onChange={(e) => setNote(e.target.value)} /></Field>
      </Dialog>
    </div>
  );
}

function AdjustDrawer({ item, currency, onClose, onDone }: { item: PayrollItem | null; currency?: string; onClose: () => void; onDone: () => void }) {
  const [bonus, setBonus] = useState('0');
  const [other, setOther] = useState('0');
  const [note, setNote] = useState('');
  useEffect(() => {
    if (item) {
      setBonus(String(item.bonus ?? 0));
      setOther(String(item.otherDeduction ?? 0));
      setNote(item.adjustmentNote ?? '');
    }
  }, [item]);
  const m = useMutation({ mutationFn: () => api.patch(`/payroll/items/${item!._id}`, { bonus: Number(bonus), otherDeduction: Number(other), note: note || undefined }), onSuccess: () => { toast.success('Adjustment saved'); onDone(); onClose(); }, onError: (e) => handleFormError(e) });
  if (!item) return null;
  const line = (l: LineItem) => [l.name, money(l.amount, currency)] as [string, React.ReactNode];
  return (
    <Drawer open={!!item} onClose={onClose} title={item.employeeName} description={`${item.employeeNo} · ${item.designation ?? ''}`} footer={<><Button variant="outline" onClick={onClose}>Close</Button><Button loading={m.isPending} disabled={(Number(bonus) || Number(other)) > 0 && note.trim().length < 3} onClick={() => m.mutate()}>Save adjustment</Button></>}>
      <div className="space-y-4">
        <KeyValue items={[['Basic', money(item.basic, currency)], ...item.allowances.map(line), ['Overtime', `${item.overtimeHours} h × ${item.overtimeRatePerHour} = ${money(item.overtimePay, currency)}`], ['Gross', money(item.gross, currency)]]} />
        <KeyValue items={[...item.deductions.map(line), ['Absence', `${item.absentDays} day(s) = ${money(item.absenceDeduction, currency)}`], ['Unpaid leave', `${item.unpaidLeaveDays} day(s) = ${money(item.unpaidLeaveDeduction, currency)}`], [`Tax (${item.taxPercent}%)`, money(item.tax, currency)], ['Net', <b key="n">{money(item.net, currency)}</b>]]} />
        <div className="grid grid-cols-2 gap-3">
          <Field label="Bonus"><Input type="number" min={0} value={bonus} onChange={(e) => setBonus(e.target.value)} /></Field>
          <Field label="Other deduction"><Input type="number" min={0} value={other} onChange={(e) => setOther(e.target.value)} /></Field>
          <Field label="Reason" className="col-span-2" required={Number(bonus) > 0 || Number(other) > 0}><Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Night-shift bonus, advance recovery" /></Field>
        </div>
      </div>
    </Drawer>
  );
}

/** Salary structure history and a form to set a new one (effective from a date). */
export function SalaryEditor({ employeeId, history }: { employeeId: string; history: SalaryStructure[] }) {
  const { can, user } = useAuth();
  const qc = useQueryClient();
  const current = history[0];
  const [open, setOpen] = useState(false);
  const [basic, setBasic] = useState('');
  const [tax, setTax] = useState('0');
  const [effectiveFrom, setEffectiveFrom] = useState(todayIso());
  const [allowances, setAllowances] = useState<LineItem[]>([]);
  const [deductions, setDeductions] = useState<LineItem[]>([]);
  const [bankName, setBankName] = useState('');
  const [bankAccount, setBankAccount] = useState('');
  useEffect(() => {
    if (open) {
      setBasic(String(current?.basic ?? ''));
      setTax(String(current?.taxPercent ?? 0));
      setAllowances(current?.allowances.map((a) => ({ name: a.name, amount: a.amount })) ?? []);
      setDeductions(current?.deductions.map((a) => ({ name: a.name, amount: a.amount })) ?? []);
      setBankName(current?.bankName ?? '');
      setBankAccount(current?.bankAccount ?? '');
      setEffectiveFrom(todayIso());
    }
  }, [open, current]);
  const m = useMutation({
    mutationFn: () => api.post(`/payroll/salary/${employeeId}`, { effectiveFrom, basic: Number(basic), taxPercent: Number(tax), allowances: allowances.filter((a) => a.name), deductions: deductions.filter((a) => a.name), bankName: bankName || undefined, bankAccount: bankAccount || undefined }),
    onSuccess: () => { toast.success('New salary structure saved'); setOpen(false); qc.invalidateQueries({ queryKey: ['employee', employeeId] }); },
    onError: (e) => handleFormError(e),
  });
  const cur = user?.hospital.currency;
  const total = (l: LineItem[]) => l.reduce((s, x) => s + (Number(x.amount) || 0), 0);
  return (
    <Card>
      <CardHeader title="Salary structure" description="Each change is a new record effective from a date; history is kept." actions={can('payroll.manage') && <Button size="sm" icon={<Plus className="h-4 w-4" />} onClick={() => setOpen(true)}>Change salary</Button>} />
      {history.length ? (
        <DataTable
          rows={history}
          rowKey={(s) => s._id}
          columns={[
            { key: 'f', header: 'Effective', cell: (s) => formatDate(s.effectiveFrom) },
            { key: 'b', header: 'Basic', align: 'right', cell: (s) => money(s.basic, cur) },
            { key: 'a', header: 'Allowances', cell: (s) => <span className="text-xs">{s.allowances.map((a) => `${a.name} ${a.amount}`).join(' · ') || '—'}</span>, hideOnMobile: true },
            { key: 'd', header: 'Deductions', cell: (s) => <span className="text-xs">{s.deductions.map((a) => `${a.name} ${a.amount}`).join(' · ') || '—'}</span>, hideOnMobile: true },
            { key: 't', header: 'Tax', align: 'right', cell: (s) => `${s.taxPercent}%` },
            { key: 'k', header: 'Bank', cell: (s) => <span className="text-xs">{s.bankName} {s.bankAccount}</span>, hideOnMobile: true },
          ]}
        />
      ) : (
        <EmptyState title="No salary structure" description="Payroll skips employees without one." />
      )}
      <Drawer open={open} onClose={() => setOpen(false)} width="sm:max-w-2xl" title="Change salary" footer={<><Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button><Button disabled={!(Number(basic) > 0)} loading={m.isPending} onClick={() => m.mutate()}>Save</Button></>}>
        <div className="space-y-4">
          <div className="grid grid-cols-3 gap-3">
            <Field label="Effective from" required><Input type="date" value={effectiveFrom} onChange={(e) => setEffectiveFrom(e.target.value)} /></Field>
            <Field label="Basic (monthly)" required><Input type="number" min={0} value={basic} onChange={(e) => setBasic(e.target.value)} /></Field>
            <Field label="Income tax %"><Input type="number" min={0} max={50} step="0.5" value={tax} onChange={(e) => setTax(e.target.value)} /></Field>
            <Field label="Bank"><Input value={bankName} onChange={(e) => setBankName(e.target.value)} /></Field>
            <Field label="Account" className="col-span-2"><Input value={bankAccount} onChange={(e) => setBankAccount(e.target.value)} /></Field>
          </div>
          <LineEditor title={`Allowances (${money(total(allowances), cur)})`} rows={allowances} onChange={setAllowances} />
          <LineEditor title={`Fixed deductions (${money(total(deductions), cur)})`} rows={deductions} onChange={setDeductions} />
        </div>
      </Drawer>
    </Card>
  );
}

export function LineEditor({ title, rows, onChange }: { title: string; rows: LineItem[]; onChange: (r: LineItem[]) => void }) {
  return (
    <div>
      <div className="mb-1 flex items-center justify-between">
        <p className="text-sm font-medium">{title}</p>
        <Button size="sm" variant="ghost" icon={<Plus className="h-4 w-4" />} onClick={() => onChange([...rows, { name: '', amount: 0 }])}>Add</Button>
      </div>
      <div className="space-y-2">
        {rows.map((r, i) => (
          <div key={i} className="flex gap-2">
            <Input value={r.name} placeholder="Name" onChange={(e) => onChange(rows.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} />
            <Input type="number" min={0} className="w-36" value={r.amount} onChange={(e) => onChange(rows.map((x, j) => (j === i ? { ...x, amount: Number(e.target.value) } : x)))} />
            <Button size="sm" variant="ghost" aria-label="Remove" onClick={() => onChange(rows.filter((_, j) => j !== i))}><Trash2 className="h-4 w-4" /></Button>
          </div>
        ))}
        {!rows.length && <p className="text-xs text-muted">None</p>}
      </div>
    </div>
  );
}
