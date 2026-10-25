import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useFieldArray, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { toast } from 'sonner';
import { AlertTriangle, Beaker, CheckCircle2, ClipboardCheck, FileText, FlaskConical, Inbox, Play, Plus, Printer, RotateCcw, Save, Settings2, ShieldCheck, Syringe, Trash2, XCircle } from 'lucide-react';
import type { z } from 'zod';
import { SAMPLE_TYPES, formatRange, labFlag, labTestSchema } from '@hms/shared';
import { api, openPdf, type Paged } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { cn, formatDateTime, minutesSince, money } from '@/lib/utils';
import { Button, Card, CardHeader, EmptyState, Input, PageHeader, PageLoader, Select, Textarea } from '@/components/ui/primitives';
import { DataTable, KeyValue, Pagination, StatCard, Tabs } from '@/components/ui/data';
import { Badge, FlagBadge, PriorityBadge, StatusBadge } from '@/components/ui/badge';
import { ConfirmDialog, Dialog, Drawer } from '@/components/ui/overlay';
import { Field, handleFormError } from '@/components/form/Field';
import type { LabOrder, LabTest } from '@/types';

interface LabStats {
  pending: number;
  toReceive: number;
  toCollect: number;
  toProcess: number;
  inProgress: number;
  toVerify: number;
  turnaround: Array<{ test: string; avgHours: number; count: number }>;
}

const STAGES = {
  intake: { label: 'Receive & collect', statuses: 'Ordered,SamplePending' },
  processing: { label: 'Processing', statuses: 'SampleCollected,InProgress' },
  verify: { label: 'To verify', statuses: 'Completed' },
  done: { label: 'Verified', statuses: 'Verified' },
} as const;
type Stage = keyof typeof STAGES;

export function LabWorklistPage() {
  const { can } = useAuth();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const stage = (params.get('stage') as Stage) ?? 'intake';
  const [page, setPage] = useState(1);
  const [mine, setMine] = useState(false);
  const { data: stats } = useQuery({ queryKey: ['lab-stats'], queryFn: () => api.get<LabStats>('/laboratory/stats'), refetchInterval: 30_000 });
  const { data, isFetching } = useQuery({
    queryKey: ['lab-orders', stage, page, mine],
    queryFn: () => api.get<Paged<LabOrder>>('/laboratory/orders', { statuses: STAGES[stage].statuses, page, pageSize: 25, assignedToMe: mine || undefined }),
    placeholderData: keepPreviousData,
    refetchInterval: 20_000,
  });

  return (
    <>
      <PageHeader
        title="Laboratory"
        description="Worklist from doctors' orders through sample collection, results, verification and reporting."
        actions={can('lab.manage') && <Link to="/laboratory/tests"><Button variant="outline" icon={<Settings2 className="h-4 w-4" />}>Test master</Button></Link>}
      />
      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-5">
        <StatCard label="Awaiting receipt" value={stats?.toReceive ?? '…'} icon={<Inbox className="h-4 w-4" />} tone="info" onClick={() => setParams({ stage: 'intake' })} />
        <StatCard label="Samples to collect" value={stats?.toCollect ?? '…'} icon={<Syringe className="h-4 w-4" />} tone="warn" onClick={() => setParams({ stage: 'intake' })} />
        <StatCard label="In the lab" value={stats ? stats.toProcess + stats.inProgress : '…'} icon={<Beaker className="h-4 w-4" />} tone="violet" onClick={() => setParams({ stage: 'processing' })} />
        <StatCard label="Awaiting verification" value={stats?.toVerify ?? '…'} icon={<ShieldCheck className="h-4 w-4" />} tone="danger" onClick={() => setParams({ stage: 'verify' })} />
        <StatCard label="Avg turnaround (30 d)" value={stats?.turnaround.length ? `${(stats.turnaround.reduce((s, t) => s + t.avgHours * t.count, 0) / stats.turnaround.reduce((s, t) => s + t.count, 0)).toFixed(1)} h` : '—'} icon={<ClipboardCheck className="h-4 w-4" />} tone="ok" />
      </div>
      <Card>
        <div className="flex flex-wrap items-center justify-between gap-2 pr-3">
          <Tabs className="px-2" value={stage} onChange={(k) => { setParams({ stage: k }); setPage(1); }} tabs={(Object.keys(STAGES) as Stage[]).map((k) => ({ key: k, label: STAGES[k].label }))} />
          {can('lab.process') && <label className="flex items-center gap-2 text-xs text-muted"><input type="checkbox" checked={mine} onChange={(e) => { setMine(e.target.checked); setPage(1); }} /> Assigned to me</label>}
        </div>
        <DataTable
          loading={isFetching}
          rows={data?.items}
          rowKey={(o) => o._id}
          onRowClick={(o) => navigate(`/laboratory/orders/${o._id}`)}
          rowClassName={(o) => (o.hasCritical ? 'bg-danger/[0.04]' : undefined)}
          empty={{ icon: <FlaskConical className="h-5 w-5" />, title: 'Nothing in this stage' }}
          columns={[
            { key: 'no', header: 'Order', cell: (o) => <div><p className="font-mono text-xs font-medium">{o.orderNo}</p><p className="text-[11px] text-muted">{formatDateTime(o.createdAt)}</p></div> },
            { key: 'pt', header: 'Patient', cell: (o) => <div><p className="font-medium">{o.patient?.name}</p><p className="font-mono text-[11px] text-muted">{o.patient?.mrn}</p></div> },
            { key: 'tests', header: 'Tests', cell: (o) => <span className="line-clamp-2 text-sm">{o.items.map((i) => i.testName).join(', ')}</span> },
            { key: 'pri', header: 'Priority', cell: (o) => <PriorityBadge priority={o.priority} /> },
            { key: 'wait', header: 'Age', cell: (o) => <span className={cn('num text-xs', minutesSince(o.createdAt) > 240 && stage !== 'done' && 'font-semibold text-danger')}>{fmtAge(minutesSince(o.createdAt))}</span>, hideOnMobile: true },
            { key: 'doc', header: 'Ordered by', cell: (o) => <span className="text-muted">{o.doctorName}</span>, hideOnMobile: true },
            { key: 'tech', header: 'Technician', cell: (o) => <span className="text-xs text-muted">{o.technicianName ?? '—'}</span>, hideOnMobile: true },
            { key: 'st', header: 'Status', cell: (o) => <div className="flex flex-wrap gap-1"><StatusBadge status={o.status} />{o.hasCritical && <Badge tone="danger">Critical</Badge>}</div> },
          ]}
        />
        {data && <Pagination page={data.page} pageSize={data.pageSize} total={data.total} onPage={setPage} />}
      </Card>
    </>
  );
}

const fmtAge = (m: number) => (m < 60 ? `${m} min` : m < 1440 ? `${Math.floor(m / 60)} h ${m % 60} m` : `${Math.floor(m / 1440)} d`);

export function LabOrderPage() {
  const { id } = useParams();
  const { can, user } = useAuth();
  const qc = useQueryClient();
  const [confirm, setConfirm] = useState<'verify' | null>(null);
  const [reasonFor, setReasonFor] = useState<'reject' | 'cancel' | null>(null);
  const [reason, setReason] = useState('');
  const { data: o, isLoading } = useQuery({ queryKey: ['lab-order', id], queryFn: () => api.get<LabOrder>(`/laboratory/orders/${id}`) });
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['lab-order', id] });
    qc.invalidateQueries({ queryKey: ['lab-orders'] });
    qc.invalidateQueries({ queryKey: ['lab-stats'] });
  };
  const act = useMutation({
    mutationFn: ({ op, body }: { op: string; body?: object }) => api.post<LabOrder>(`/laboratory/orders/${id}/${op}`, body),
    onSuccess: (_d, v) => {
      toast.success({ receive: 'Request received', collect: 'Sample collected', start: 'Processing started', verify: 'Results verified and released', reject: 'Returned for correction', cancel: 'Order cancelled', review: 'Marked as reviewed' }[v.op] ?? 'Done');
      setConfirm(null);
      setReasonFor(null);
      setReason('');
      refresh();
    },
    onError: (e) => handleFormError(e),
  });

  if (isLoading || !o) return <PageLoader />;
  const isLab = can('lab.process');
  const enteredByMe = o.technicianName === user?.fullName;

  return (
    <div className="space-y-4">
      <PageHeader
        title={`Lab order ${o.orderNo}`}
        description={
          <span className="flex flex-wrap items-center gap-2">
            {o.patient?.name} · <span className="font-mono">{o.patient?.mrn}</span> · ordered by {o.doctorName} · <PriorityBadge priority={o.priority} /> <StatusBadge status={o.status} />
          </span>
        }
        actions={
          <>
            {o.status === 'Verified' && <Button variant="outline" icon={<Printer className="h-4 w-4" />} onClick={() => openPdf(`/laboratory/orders/${o._id}/report`).catch((e) => toast.error(e.message))}>Report PDF</Button>}
            {isLab && o.status === 'Ordered' && <Button icon={<Inbox className="h-4 w-4" />} loading={act.isPending} onClick={() => act.mutate({ op: 'receive' })}>Receive request</Button>}
            {isLab && ['Ordered', 'SamplePending'].includes(o.status) && <Button variant={o.status === 'Ordered' ? 'outline' : 'primary'} icon={<Syringe className="h-4 w-4" />} loading={act.isPending} onClick={() => act.mutate({ op: 'collect', body: {} })}>Collect sample</Button>}
            {isLab && o.status === 'SampleCollected' && <Button icon={<Play className="h-4 w-4" />} loading={act.isPending} onClick={() => act.mutate({ op: 'start' })}>Start processing</Button>}
            {can('lab.verify') && o.status === 'Completed' && (
              <>
                <Button variant="outline" icon={<RotateCcw className="h-4 w-4" />} onClick={() => setReasonFor('reject')}>Return for correction</Button>
                <Button icon={<ShieldCheck className="h-4 w-4" />} disabled={enteredByMe} title={enteredByMe ? 'Results must be verified by a second person' : undefined} onClick={() => setConfirm('verify')}>Verify & release</Button>
              </>
            )}
            {user?.doctorId && o.status === 'Verified' && !o.reviewedAt && <Button icon={<CheckCircle2 className="h-4 w-4" />} loading={act.isPending} onClick={() => act.mutate({ op: 'review' })}>Mark reviewed</Button>}
            {(isLab || user?.doctorId) && ['Ordered', 'SamplePending', 'SampleCollected'].includes(o.status) && <Button variant="ghost" className="text-danger" icon={<XCircle className="h-4 w-4" />} onClick={() => setReasonFor('cancel')}>Cancel</Button>}
          </>
        }
      />
      {o.hasCritical && o.status !== 'Cancelled' && (
        <div className="flex items-center gap-2 rounded-md border border-danger/30 bg-danger/10 px-3 py-2 text-sm font-medium text-danger">
          <AlertTriangle className="h-4 w-4" /> Critical value(s) present — follow the critical result call-back procedure.
        </div>
      )}
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
        <div className="space-y-4">
          {o.status === 'InProgress' && isLab ? <ResultsEntry order={o} onSaved={refresh} /> : <ResultsView order={o} />}
        </div>
        <div className="space-y-4">
          <Card>
            <CardHeader title="Request" />
            <div className="p-4">
              <KeyValue
                cols={1}
                items={[
                  ['Tests', o.items.map((i) => `${i.testName} (${money(i.price, user?.hospital.currency)})`).join(', ')],
                  ['Clinical notes', o.clinicalNotes],
                  ['Sample', o.sample?.collectedAt ? `${o.sample.type} · ${formatDateTime(o.sample.collectedAt)} · ${o.sample.collectedByName}` : 'Not collected'],
                  ['Barcode', o.sample?.barcode],
                  ['Technician', o.technicianName],
                  ['Results entered', formatDateTime(o.resultsEnteredAt)],
                  ['Verified', o.verifiedAt ? `${o.verifiedByName} · ${formatDateTime(o.verifiedAt)}` : '—'],
                  ['Doctor review', o.reviewedAt ? `${o.reviewedByName} · ${formatDateTime(o.reviewedAt)}` : '—'],
                  ...(o.cancelReason ? ([['Cancelled', o.cancelReason]] as Array<[string, string]>) : []),
                ]}
              />
            </div>
          </Card>
          {can('lab.verify', 'lab.manage') && !['Verified', 'Cancelled'].includes(o.status) && <AssignCard order={o} onDone={refresh} />}
          <AttachmentsCard order={o} canUpload={isLab && o.status !== 'Cancelled'} onDone={refresh} />
          {o.history && (
            <Card>
              <CardHeader title="History" />
              <ol className="space-y-2 p-4 text-xs">
                {o.history.map((h, i) => (
                  <li key={i} className="flex gap-2">
                    <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-brand" />
                    <span>
                      <span className="font-medium">{h.status}</span> · {formatDateTime(h.at)} {h.byName && `· ${h.byName}`}
                      {h.note && <span className="block text-muted">{h.note}</span>}
                    </span>
                  </li>
                ))}
              </ol>
            </Card>
          )}
        </div>
      </div>

      <ConfirmDialog open={confirm === 'verify'} onClose={() => setConfirm(null)} onConfirm={() => act.mutate({ op: 'verify' })} loading={act.isPending} title="Verify and release results?" confirmLabel="Verify & release" message="The report becomes available to the ordering doctor and the patient. Further changes will need a documented correction." />
      <Dialog
        open={!!reasonFor}
        onClose={() => setReasonFor(null)}
        title={reasonFor === 'reject' ? 'Return results for correction' : 'Cancel lab order'}
        footer={<><Button variant="outline" onClick={() => setReasonFor(null)}>Back</Button><Button variant="danger" disabled={reason.trim().length < 3} loading={act.isPending} onClick={() => act.mutate({ op: reasonFor!, body: { reason } })}>{reasonFor === 'reject' ? 'Return' : 'Cancel order'}</Button></>}
      >
        <Field label="Reason" required hint={reasonFor === 'cancel' ? 'Unpaid lab charges are voided automatically.' : undefined}><Textarea autoFocus value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
      </Dialog>
    </div>
  );
}

function ResultsView({ order }: { order: LabOrder }) {
  const ready = ['Completed', 'Verified'].includes(order.status);
  if (!ready) {
    return (
      <Card>
        <EmptyState icon={<FlaskConical className="h-5 w-5" />} title="Results not available yet" description={`Current stage: ${order.status}`} />
      </Card>
    );
  }
  return (
    <>
      {order.status === 'Completed' && <div className="rounded-md border border-warn/30 bg-warn/10 px-3 py-2 text-sm text-warn">Preliminary — awaiting verification.</div>}
      {order.items.map((it) => (
        <Card key={it._id}>
          <CardHeader title={it.testName} description={it.sampleType} />
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-subtle/60 text-left text-[11px] uppercase tracking-wide text-muted">
                  <th className="px-4 py-2 font-semibold">Parameter</th>
                  <th className="px-4 py-2 text-right font-semibold">Result</th>
                  <th className="px-4 py-2 font-semibold">Unit</th>
                  <th className="px-4 py-2 font-semibold">Reference</th>
                  <th className="px-4 py-2 font-semibold">Flag</th>
                </tr>
              </thead>
              <tbody>
                {it.results.map((r) => (
                  <tr key={r.parameter} className="border-b border-border/70 last:border-0">
                    <td className="px-4 py-2">{r.parameter}</td>
                    <td className={cn('num px-4 py-2 text-right font-semibold', r.flag !== 'N' && (r.flag.length === 2 ? 'text-danger' : 'text-warn'))}>{r.value}</td>
                    <td className="px-4 py-2 text-muted">{r.unit}</td>
                    <td className="px-4 py-2 text-muted">{r.refRange}</td>
                    <td className="px-4 py-2"><FlagBadge flag={r.flag} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      ))}
      {order.comments && <Card className="p-4 text-sm"><span className="font-medium">Comments:</span> {order.comments}</Card>}
    </>
  );
}

/** Result entry with live flagging against each parameter's ranges (the server recomputes on save). */
function ResultsEntry({ order, onSaved }: { order: LabOrder; onSaved: () => void }) {
  const { data: tests } = useQuery({ queryKey: ['lab-tests'], queryFn: () => api.get<LabTest[]>('/laboratory/tests', { includeInactive: true }) });
  const [values, setValues] = useState<Record<string, string>>({});
  const [comments, setComments] = useState(order.comments ?? '');
  const [saving, setSaving] = useState<'draft' | 'final' | null>(null);
  useEffect(() => {
    const init: Record<string, string> = {};
    for (const it of order.items) for (const r of it.results) init[`${it._id}|${r.parameter}`] = r.value;
    setValues(init);
  }, [order]);

  const save = async (draft: boolean) => {
    setSaving(draft ? 'draft' : 'final');
    try {
      const results = Object.entries(values)
        .filter(([, v]) => v.trim() !== '')
        .map(([k, value]) => {
          const [itemId, parameter] = k.split('|');
          return { itemId, parameter, value };
        });
      if (!results.length) throw new Error('Enter at least one result');
      await api.put(`/laboratory/orders/${order._id}/results`, { results, comments: comments || undefined, draft });
      toast.success(draft ? 'Draft saved' : 'Results completed — sent for verification');
      onSaved();
    } catch (e) {
      handleFormError(e);
    } finally {
      setSaving(null);
    }
  };

  if (!tests) return <PageLoader />;
  return (
    <>
      {order.items.map((it) => {
        const test = tests.find((t) => t._id === it.testId);
        return (
          <Card key={it._id}>
            <CardHeader title={it.testName} description={`${it.sampleType} · enter every parameter to complete`} />
            <div className="divide-y divide-border">
              {test?.parameters.map((p) => {
                const key = `${it._id}|${p.name}`;
                const v = values[key] ?? '';
                const flag = p.type === 'numeric' ? labFlag(v, p) : 'N';
                return (
                  <div key={p.name} className="grid grid-cols-[1fr_140px_80px] items-center gap-3 px-4 py-2 sm:grid-cols-[1fr_160px_90px_150px_110px]">
                    <span className="text-sm">{p.name}</span>
                    <Input
                      value={v}
                      inputMode={p.type === 'numeric' ? 'decimal' : 'text'}
                      onChange={(e) => setValues((s) => ({ ...s, [key]: e.target.value }))}
                      className={cn('num text-right', flag.length === 2 ? 'border-danger bg-danger/5 text-danger' : flag !== 'N' && 'border-warn bg-warn/5 text-warn')}
                      placeholder={p.type === 'numeric' ? '0.0' : p.refText}
                    />
                    <span className="text-xs text-muted">{p.unit}</span>
                    <span className="hidden text-xs text-muted sm:block">{formatRange(p)}</span>
                    <span className="hidden sm:block"><FlagBadge flag={flag} /></span>
                  </div>
                );
              })}
            </div>
          </Card>
        );
      })}
      <Card className="p-4">
        <Field label="Comments / interpretation"><Textarea value={comments} onChange={(e) => setComments(e.target.value)} /></Field>
        <div className="mt-3 flex justify-end gap-2">
          <Button variant="outline" icon={<Save className="h-4 w-4" />} loading={saving === 'draft'} onClick={() => save(true)}>Save draft</Button>
          <Button icon={<ClipboardCheck className="h-4 w-4" />} loading={saving === 'final'} onClick={() => save(false)}>Complete — send for verification</Button>
        </div>
      </Card>
    </>
  );
}

// ── Test master ─────────────────────────────────────────────────────────────
type TestIn = z.input<typeof labTestSchema>;
type TestOut = z.output<typeof labTestSchema>;

export function LabTestsPage() {
  const { user } = useAuth();
  const [editing, setEditing] = useState<LabTest | 'new' | null>(null);
  const { data, isLoading } = useQuery({ queryKey: ['lab-tests', 'all'], queryFn: () => api.get<LabTest[]>('/laboratory/tests', { includeInactive: true }) });
  return (
    <>
      <PageHeader title="Lab test master" description="Orderable tests, pricing, sample type and result parameters with reference and critical ranges." actions={<Button icon={<Plus className="h-4 w-4" />} onClick={() => setEditing('new')}>New test</Button>} />
      <Card>
        <DataTable
          loading={isLoading}
          rows={data}
          rowKey={(t) => t._id}
          onRowClick={setEditing}
          columns={[
            { key: 'code', header: 'Code', cell: (t) => <span className="font-mono text-xs">{t.code}</span> },
            { key: 'name', header: 'Test', cell: (t) => <span className="font-medium">{t.name}</span> },
            { key: 'cat', header: 'Category', cell: (t) => t.category },
            { key: 'sample', header: 'Sample', cell: (t) => t.sampleType, hideOnMobile: true },
            { key: 'params', header: 'Parameters', cell: (t) => t.parameters.length, hideOnMobile: true },
            { key: 'tat', header: 'TAT', cell: (t) => `${t.turnaroundHours} h`, hideOnMobile: true },
            { key: 'price', header: 'Price', align: 'right', cell: (t) => money(t.price, user?.hospital.currency) },
            { key: 'st', header: '', cell: (t) => (t.isActive ? null : <Badge>Inactive</Badge>) },
          ]}
        />
      </Card>
      <TestDrawer test={editing} onClose={() => setEditing(null)} />
    </>
  );
}

function TestDrawer({ test, onClose }: { test: LabTest | 'new' | null; onClose: () => void }) {
  const qc = useQueryClient();
  const isNew = test === 'new';
  const values = useMemo<TestIn>(
    () =>
      test && test !== 'new'
        ? { code: test.code, name: test.name, category: test.category, sampleType: test.sampleType as TestIn['sampleType'], price: test.price, turnaroundHours: test.turnaroundHours, parameters: test.parameters, isActive: test.isActive }
        : { code: '', name: '', category: 'Biochemistry', sampleType: 'Serum', price: 0, turnaroundHours: 24, parameters: [{ name: '', type: 'numeric' }], isActive: true },
    [test],
  );
  const form = useForm<TestIn, unknown, TestOut>({ resolver: zodResolver(labTestSchema), values });
  const params = useFieldArray({ control: form.control, name: 'parameters' });
  const { register, formState: { errors, isSubmitting } } = form;
  const submit = form.handleSubmit(async (v) => {
    try {
      if (isNew) await api.post('/laboratory/tests', v);
      else await api.put(`/laboratory/tests/${(test as LabTest)._id}`, v);
      toast.success('Test saved (change audited)');
      qc.invalidateQueries({ queryKey: ['lab-tests'] });
      onClose();
    } catch (e) {
      handleFormError(e, form.setError);
    }
  });
  return (
    <Drawer open={!!test} onClose={onClose} width="sm:max-w-3xl" title={isNew ? 'New lab test' : 'Edit lab test'} footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button onClick={submit} loading={isSubmitting}>Save</Button></>}>
      <form onSubmit={submit} className="space-y-4" noValidate>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <Field label="Code" required error={errors.code}><Input {...register('code')} /></Field>
          <Field label="Name" required error={errors.name} className="col-span-2"><Input {...register('name')} /></Field>
          <Field label="Category" required error={errors.category}><Input {...register('category')} /></Field>
          <Field label="Sample type"><Select {...register('sampleType')}>{SAMPLE_TYPES.map((s) => <option key={s}>{s}</option>)}</Select></Field>
          <Field label="Price" required error={errors.price}><Input type="number" min={0} {...register('price')} /></Field>
          <Field label="Turnaround (hours)" error={errors.turnaroundHours}><Input type="number" min={1} {...register('turnaroundHours')} /></Field>
          <label className="flex items-end gap-2 pb-2 text-sm"><input type="checkbox" {...register('isActive')} /> Orderable</label>
        </div>
        <div>
          <div className="mb-2 flex items-center justify-between">
            <p className="text-sm font-semibold">Parameters</p>
            <Button type="button" size="sm" variant="outline" icon={<Plus className="h-3.5 w-3.5" />} onClick={() => params.append({ name: '', type: 'numeric' })}>Add parameter</Button>
          </div>
          {errors.parameters?.message && <p className="mb-2 text-xs text-danger">{errors.parameters.message}</p>}
          {params.fields.map((f, i) => (
            <div key={f.id} className="mb-2 grid grid-cols-2 items-end gap-2 rounded-md border border-border p-2 sm:grid-cols-[1.4fr_90px_90px_80px_80px_80px_80px_auto]">
              <Field label="Name" error={errors.parameters?.[i]?.name}><Input {...register(`parameters.${i}.name`)} /></Field>
              <Field label="Type"><Select {...register(`parameters.${i}.type`)}><option value="numeric">Numeric</option><option value="text">Text</option></Select></Field>
              <Field label="Unit"><Input {...register(`parameters.${i}.unit`)} /></Field>
              <Field label="Ref low"><Input type="number" step="any" {...register(`parameters.${i}.refLow`)} /></Field>
              <Field label="Ref high" error={errors.parameters?.[i]?.refHigh?.message}><Input type="number" step="any" {...register(`parameters.${i}.refHigh`)} /></Field>
              <Field label="Crit low"><Input type="number" step="any" {...register(`parameters.${i}.criticalLow`)} /></Field>
              <Field label="Crit high"><Input type="number" step="any" {...register(`parameters.${i}.criticalHigh`)} /></Field>
              <Button type="button" variant="ghost" size="icon" disabled={params.fields.length === 1} onClick={() => params.remove(i)} aria-label="Remove parameter"><Trash2 className="h-4 w-4" /></Button>
              <Field label="Reference text (for text results)" className="col-span-2 sm:col-span-8"><Input placeholder="e.g. Negative" {...register(`parameters.${i}.refText`)} /></Field>
            </div>
          ))}
        </div>
      </form>
    </Drawer>
  );
}

/** Compact list of a patient's or visit's lab orders, used in the EMR and consultation. */
export function LabOrdersList({ orders, compact }: { orders: LabOrder[]; compact?: boolean }) {
  if (!orders.length) return <p className="px-4 py-3 text-sm text-muted">No lab orders</p>;
  return (
    <ul className="divide-y divide-border">
      {orders.map((o) => (
        <li key={o._id} className="px-4 py-3">
          <div className="flex flex-wrap items-center gap-2">
            <Link to={`/laboratory/orders/${o._id}`} className="font-mono text-xs font-medium text-brand hover:underline">{o.orderNo}</Link>
            <StatusBadge status={o.status} />
            {o.priority !== 'Routine' && <PriorityBadge priority={o.priority} />}
            {o.status === 'Verified' && o.hasAbnormal && <Badge tone={o.hasCritical ? 'danger' : 'warn'}>{o.hasCritical ? 'Critical' : 'Abnormal'}</Badge>}
            {o.reviewedAt && <Badge tone="ok">Reviewed</Badge>}
            <span className="ml-auto text-xs text-muted">{formatDateTime(o.verifiedAt ?? o.createdAt)}</span>
            {o.status === 'Verified' && <Button size="sm" variant="ghost" icon={<FileText className="h-3.5 w-3.5" />} onClick={() => openPdf(`/laboratory/orders/${o._id}/report`).catch((e) => toast.error(e.message))}>Report</Button>}
          </div>
          <p className="mt-1 text-sm">{o.items.map((i) => i.testName).join(', ')}</p>
          {!compact && ['Completed', 'Verified'].includes(o.status) && (
            <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs">
              {o.items.flatMap((i) => i.results.filter((r) => r.flag !== 'N')).slice(0, 8).map((r) => (
                <span key={r.parameter} className={cn(r.flag.length === 2 ? 'text-danger' : 'text-warn')}>
                  {r.parameter}: <span className="num font-semibold">{r.value}</span> {r.unit} ({r.flag})
                </span>
              ))}
            </div>
          )}
        </li>
      ))}
    </ul>
  );
}

function AssignCard({ order, onDone }: { order: LabOrder; onDone: () => void }) {
  const [userId, setUserId] = useState('');
  const { data: techs } = useQuery({ queryKey: ['lab-technicians'], queryFn: () => api.get<Array<{ _id: string; fullName: string }>>('/laboratory/technicians'), staleTime: 300_000 });
  const m = useMutation({
    mutationFn: () => api.post(`/laboratory/orders/${order._id}/assign`, { userId }),
    onSuccess: () => { toast.success('Technician assigned and notified'); setUserId(''); onDone(); },
    onError: (e) => handleFormError(e),
  });
  return (
    <Card>
      <CardHeader title="Technician assignment" description={order.technicianName ? `Currently: ${order.technicianName}` : 'Not assigned yet'} />
      <div className="flex gap-2 p-4">
        <Select value={userId} onChange={(e) => setUserId(e.target.value)} className="flex-1">
          <option value="">Select technician…</option>
          {techs?.map((t) => <option key={t._id} value={t._id}>{t.fullName}</option>)}
        </Select>
        <Button disabled={!userId} loading={m.isPending} onClick={() => m.mutate()}>Assign</Button>
      </div>
    </Card>
  );
}

function AttachmentsCard({ order, canUpload, onDone }: { order: LabOrder; canUpload: boolean; onDone: () => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [description, setDescription] = useState('');
  const m = useMutation({
    mutationFn: () => {
      const fd = new FormData();
      fd.append('file', file!);
      if (description) fd.append('description', description);
      return api.post(`/laboratory/orders/${order._id}/attachments`, fd);
    },
    onSuccess: () => { toast.success('Report uploaded'); setFile(null); setDescription(''); onDone(); },
    onError: (e) => handleFormError(e),
  });
  const files = order.attachments ?? [];
  if (!canUpload && !files.length) return null;
  return (
    <Card>
      <CardHeader title="Uploaded reports" description="Instrument printouts or external lab reports (PDF / image)" />
      <ul className="divide-y divide-border">
        {files.map((a) => (
          <li key={a._id} className="flex items-center gap-2 px-4 py-2 text-xs">
            <FileText className="h-4 w-4 shrink-0 text-muted" />
            <button type="button" className="min-w-0 flex-1 truncate text-left text-brand hover:underline" onClick={() => openPdf(`/laboratory/orders/${order._id}/attachments/${a._id}`).catch((e) => toast.error(e.message))}>{a.fileName}</button>
            <span className="text-muted">{a.uploadedByName} · {formatDateTime(a.at)}</span>
          </li>
        ))}
        {!files.length && <li className="px-4 py-2 text-xs text-muted">None yet</li>}
      </ul>
      {canUpload && (
        <div className="space-y-2 border-t border-border p-4">
          <Input type="file" accept="application/pdf,image/png,image/jpeg" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
          <Input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Description (optional)" />
          <Button size="sm" disabled={!file} loading={m.isPending} onClick={() => m.mutate()}>Upload</Button>
        </div>
      )}
    </Card>
  );
}
