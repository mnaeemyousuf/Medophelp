import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { AlertTriangle, CheckCircle2, Lock, PackageCheck, Pill, Printer } from 'lucide-react';
import { allocateFefo } from '@hms/shared';
import { api, newIdempotencyKey, ApiError, openPdf, type Paged } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { cn, formatDate, formatDateTime, money } from '@/lib/utils';
import { Button, Card, CardHeader, EmptyState, Input, PageHeader, PageLoader, Textarea } from '@/components/ui/primitives';
import { DataTable, Pagination, Tabs } from '@/components/ui/data';
import { Badge, StatusBadge } from '@/components/ui/badge';
import { ConfirmDialog } from '@/components/ui/overlay';
import { Field, handleFormError } from '@/components/form/Field';
import { AllergyStrip } from '@/components/clinical';
import type { Allergy } from '@/types';

interface QueueRow {
  _id: string;
  prescriptionNo: string;
  status: string;
  prescribedAt: string;
  doctorName?: string;
  patient: { id: string; mrn: string; name: string };
  lines: Array<{ medicineName: string; remaining: number; available: number | null; linked: boolean }>;
  stockReady: boolean;
}
interface DispenseRow {
  _id: string;
  dispenseNo: string;
  prescriptionNo: string;
  patientName: string;
  mrn: string;
  total: number;
  dispensedByName?: string;
  dispensedAt: string;
  witnessName?: string;
  lines: Array<{ itemName: string; quantity: number; allocations: Array<{ batchNo: string; quantity: number }> }>;
}
interface ControlledRow {
  _id: string;
  at: string;
  itemName: string;
  batchNo: string;
  quantity: number;
  balanceAfter?: number;
  patientName: string;
  mrn: string;
  prescriptionNo: string;
  prescriberName?: string;
  dispensedByName?: string;
  witnessName: string;
}

export function PharmacyPage() {
  const { can, user } = useAuth();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const tab = (params.get('tab') as 'queue' | 'history' | 'controlled') ?? 'queue';
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const queue = useQuery({ queryKey: ['pharmacy-queue', page, search], queryFn: () => api.get<Paged<QueueRow>>('/pharmacy/queue', { page, pageSize: 25, search }), enabled: tab === 'queue', placeholderData: keepPreviousData, refetchInterval: 20_000 });
  const history = useQuery({ queryKey: ['dispenses', page, search], queryFn: () => api.get<Paged<DispenseRow>>('/pharmacy/dispenses', { page, pageSize: 25, search }), enabled: tab === 'history', placeholderData: keepPreviousData });
  const controlled = useQuery({ queryKey: ['controlled', page], queryFn: () => api.get<Paged<ControlledRow>>('/pharmacy/controlled-register', { page, pageSize: 25 }), enabled: tab === 'controlled' && can('pharmacy.controlled') });
  const setTab = (t: string) => {
    setParams({ tab: t });
    setPage(1);
  };

  return (
    <>
      <PageHeader title="Pharmacy" description="Electronic prescriptions from doctors, dispensed first-expiry-first-out from pharmacy stock." />
      <Card>
        <div className="flex flex-wrap items-center gap-2 border-b border-border px-2">
          <Tabs
            className="flex-1 border-0"
            value={tab}
            onChange={setTab}
            tabs={[
              { key: 'queue', label: 'Prescription queue', count: queue.data?.total },
              { key: 'history', label: 'Dispensing history' },
              ...(can('pharmacy.controlled') ? [{ key: 'controlled' as const, label: 'Controlled register' }] : []),
            ]}
          />
          {tab !== 'controlled' && <Input value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} placeholder={tab === 'queue' ? 'Prescription no.' : 'Dispense no., MRN or Rx no.'} className="my-2 w-56" />}
        </div>
        {tab === 'queue' && (
          <>
            <DataTable
              loading={queue.isFetching}
              rows={queue.data?.items}
              rowKey={(r) => r._id}
              onRowClick={(r) => navigate(`/pharmacy/dispense/${r._id}`)}
              empty={{ icon: <Pill className="h-5 w-5" />, title: 'No prescriptions waiting' }}
              columns={[
                { key: 'no', header: 'Prescription', cell: (r) => <div><p className="font-mono text-xs font-medium">{r.prescriptionNo}</p><p className="text-[11px] text-muted">{formatDateTime(r.prescribedAt)}</p></div> },
                { key: 'pt', header: 'Patient', cell: (r) => <div><p className="font-medium">{r.patient.name}</p><p className="font-mono text-[11px] text-muted">{r.patient.mrn}</p></div> },
                { key: 'meds', header: 'Medicines', cell: (r) => <span className="line-clamp-2 text-sm">{r.lines.filter((l) => l.remaining > 0).map((l) => `${l.medicineName} × ${l.remaining}`).join(', ')}</span> },
                { key: 'doc', header: 'Doctor', cell: (r) => <span className="text-muted">{r.doctorName}</span>, hideOnMobile: true },
                { key: 'stock', header: 'Stock', cell: (r) => (r.stockReady ? <Badge tone="ok" dot>Ready</Badge> : <Badge tone="warn" dot>Check stock</Badge>) },
                { key: 'st', header: 'Status', cell: (r) => <StatusBadge status={r.status} /> },
              ]}
            />
            {queue.data && <Pagination page={queue.data.page} pageSize={queue.data.pageSize} total={queue.data.total} onPage={setPage} />}
          </>
        )}
        {tab === 'history' && (
          <>
            <DataTable
              loading={history.isFetching}
              rows={history.data?.items}
              rowKey={(r) => r._id}
              empty={{ title: 'No dispensing yet' }}
              columns={[
                { key: 'no', header: 'Dispense', cell: (r) => <div><p className="font-mono text-xs font-medium">{r.dispenseNo}</p><p className="text-[11px] text-muted">{formatDateTime(r.dispensedAt)}</p></div> },
                { key: 'pt', header: 'Patient', cell: (r) => <div><p>{r.patientName}</p><p className="font-mono text-[11px] text-muted">{r.mrn} · {r.prescriptionNo}</p></div> },
                { key: 'lines', header: 'Items (batches)', cell: (r) => <div className="text-xs">{r.lines.map((l) => <p key={l.itemName}>{l.itemName} × {l.quantity} <span className="text-muted">({l.allocations.map((a) => `${a.batchNo}:${a.quantity}`).join(', ')})</span></p>)}</div> },
                { key: 'by', header: 'By', cell: (r) => <span className="text-muted">{r.dispensedByName}{r.witnessName ? ` · witness ${r.witnessName}` : ''}</span>, hideOnMobile: true },
                { key: 'tot', header: 'Total', align: 'right', cell: (r) => money(r.total, user?.hospital.currency) },
              ]}
            />
            {history.data && <Pagination page={history.data.page} pageSize={history.data.pageSize} total={history.data.total} onPage={setPage} />}
          </>
        )}
        {tab === 'controlled' && (
          <>
            <DataTable
              loading={controlled.isFetching}
              rows={controlled.data?.items}
              rowKey={(r) => r._id}
              empty={{ icon: <Lock className="h-5 w-5" />, title: 'No controlled medicines dispensed' }}
              columns={[
                { key: 'at', header: 'When', cell: (r) => <span className="num text-xs">{formatDateTime(r.at)}</span> },
                { key: 'item', header: 'Medicine / batch', cell: (r) => <div><p className="font-medium">{r.itemName}</p><p className="font-mono text-[11px] text-muted">{r.batchNo}</p></div> },
                { key: 'qty', header: 'Qty', align: 'right', cell: (r) => r.quantity },
                { key: 'bal', header: 'Balance', align: 'right', cell: (r) => r.balanceAfter ?? '—' },
                { key: 'pt', header: 'Patient', cell: (r) => <div><p>{r.patientName}</p><p className="font-mono text-[11px] text-muted">{r.mrn} · {r.prescriptionNo}</p></div> },
                { key: 'who', header: 'Dispensed / witness', cell: (r) => <span className="text-xs">{r.dispensedByName} / {r.witnessName}</span> },
                { key: 'pres', header: 'Prescriber', cell: (r) => <span className="text-xs text-muted">{r.prescriberName}</span>, hideOnMobile: true },
              ]}
            />
            {controlled.data && <Pagination page={controlled.data.page} pageSize={controlled.data.pageSize} total={controlled.data.total} onPage={setPage} />}
          </>
        )}
      </Card>
    </>
  );
}

interface DispenseContext {
  prescription: { _id: string; prescriptionNo: string; status: string; prescribedAt: string; doctorName?: string; notes?: string };
  patient: { id: string; mrn: string; name: string; gender: string; dateOfBirth: string; allergies: Allergy[] };
  lines: Array<{
    prescriptionItemId: string;
    medicineName: string;
    dosage: string;
    frequency: string;
    durationDays: number;
    instructions?: string;
    prescribed: number;
    dispensed: number;
    remaining: number;
    item: { _id: string; name: string; sku: string; unit: string; sellingPrice: number; isControlled: boolean; linkedByDoctor: boolean } | null;
    batches: Array<{ _id: string; batchNo: string; expiryDate: string; quantity: number; isExpired: boolean }>;
  }>;
  history: DispenseRow[];
}

export function DispensePage() {
  const { id } = useParams();
  const { can, user } = useAuth();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { data, isLoading, refetch } = useQuery({ queryKey: ['dispense', id], queryFn: () => api.get<DispenseContext>(`/pharmacy/prescriptions/${id}`) });
  const [qty, setQty] = useState<Record<string, number>>({});
  const [witness, setWitness] = useState('');
  const [notes, setNotes] = useState('');
  const [confirm, setConfirm] = useState(false);
  const [saving, setSaving] = useState(false);
  // One key per dispensing attempt: a double-click or retry cannot dispense (and bill) twice.
  const [idemKey, setIdemKey] = useState(newIdempotencyKey);

  useEffect(() => {
    if (!data) return;
    const init: Record<string, number> = {};
    for (const l of data.lines) {
      const usable = l.batches.filter((b) => !b.isExpired).reduce((s, b) => s + b.quantity, 0);
      init[l.prescriptionItemId] = l.item ? Math.max(0, Math.min(l.remaining, usable)) : 0;
    }
    setQty(init);
  }, [data]);

  const plan = useMemo(() => {
    if (!data) return [];
    return data.lines.map((l) => {
      const q = qty[l.prescriptionItemId] ?? 0;
      const fefo = allocateFefo(l.batches.map((b) => ({ id: b._id, batchNo: b.batchNo, expiryDate: b.expiryDate, quantity: b.quantity })), q);
      return { line: l, quantity: q, fefo, price: l.item ? q * l.item.sellingPrice : 0 };
    });
  }, [data, qty]);

  if (isLoading || !data) return <PageLoader />;
  const selected = plan.filter((p) => p.quantity > 0 && p.line.item);
  const needsWitness = selected.some((p) => p.line.item!.isControlled);
  const total = selected.reduce((s, p) => s + p.price, 0);
  const problems = selected.filter((p) => p.fefo.shortfall > 0 || p.quantity > p.line.remaining);
  const done = !['Active', 'PartiallyDispensed'].includes(data.prescription.status);

  const submit = async () => {
    setSaving(true);
    try {
      const res = await api.post<{ dispense: { dispenseNo: string }; prescriptionStatus: string }>(`/pharmacy/prescriptions/${id}/dispense`, {
        lines: selected.map((p) => ({ prescriptionItemId: p.line.prescriptionItemId, itemId: p.line.item!._id, quantity: p.quantity })),
        witnessName: witness || undefined,
        notes: notes || undefined,
      }, { idempotencyKey: idemKey });
      setIdemKey(newIdempotencyKey());
      toast.success(`Dispensed — ${res.dispense.dispenseNo}`, { description: `Prescription is now ${res.prescriptionStatus === 'Dispensed' ? 'fully dispensed' : 'partially dispensed'}. Pharmacy charges posted to billing.` });
      setConfirm(false);
      qc.invalidateQueries({ queryKey: ['pharmacy-queue'] });
      if (res.prescriptionStatus === 'Dispensed') navigate('/pharmacy');
      else refetch();
    } catch (e) {
      setConfirm(false);
      if (e instanceof ApiError && e.code === 'insufficient_stock') toast.error(e.message, { description: 'Stock changed since the page loaded — reloading.' });
      else handleFormError(e);
      refetch();
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-border bg-surface shadow-card">
        <div className="flex flex-wrap items-center gap-3 p-4">
          <div className="min-w-0 flex-1">
            <h1 className="text-lg font-semibold">{data.patient.name} <span className="ml-1 font-mono text-sm text-muted">{data.patient.mrn}</span></h1>
            <p className="text-xs text-muted">{data.prescription.prescriptionNo} · {data.prescription.doctorName} · {formatDateTime(data.prescription.prescribedAt)}</p>
          </div>
          <StatusBadge status={data.prescription.status} />
          <Button size="sm" variant="outline" icon={<Printer className="h-4 w-4" />} onClick={() => openPdf(`/clinical/prescriptions/${data.prescription._id}/pdf`).catch((e) => toast.error(e.message))}>Prescription</Button>
        </div>
        <AllergyStrip allergies={data.patient.allergies} />
      </div>
      {data.prescription.notes && <p className="rounded-md bg-subtle px-3 py-2 text-sm"><span className="font-medium">Doctor's note:</span> {data.prescription.notes}</p>}

      <div className="space-y-3">
        {plan.map(({ line, quantity, fefo, price }) => (
          <Card key={line.prescriptionItemId} className={cn(line.remaining <= 0 && 'opacity-60')}>
            <div className="flex flex-col gap-3 p-4 lg:flex-row lg:items-start">
              <div className="min-w-0 flex-1">
                <p className="font-medium">
                  {line.medicineName} {line.item?.isControlled && <Badge tone="danger"><Lock className="mr-0.5 inline h-3 w-3" />Controlled</Badge>}
                </p>
                <p className="text-xs text-muted">{line.dosage} · {line.frequency} · {line.durationDays} days{line.instructions ? ` · ${line.instructions}` : ''}</p>
                <p className="mt-1 text-xs">Prescribed <b>{line.prescribed}</b> · dispensed <b>{line.dispensed}</b> · remaining <b>{line.remaining}</b></p>
                {!line.item ? (
                  <p className="mt-2 flex items-center gap-1 text-xs text-danger"><AlertTriangle className="h-3.5 w-3.5" /> No matching item in the formulary — add it under Inventory or ask the doctor to prescribe from the formulary.</p>
                ) : (
                  <p className="mt-1 text-xs text-muted">Stock item: {line.item.name} ({line.item.sku}) · {money(line.item.sellingPrice, user?.hospital.currency)}/{line.item.unit}{!line.item.linkedByDoctor && ' · matched by name — check before dispensing'}</p>
                )}
              </div>
              {line.item && line.remaining > 0 && !done && (
                <div className="w-full lg:w-80">
                  <div className="flex items-end gap-2">
                    <Field label={`Dispense (${line.item.unit})`} className="w-32">
                      <Input type="number" min={0} max={line.remaining} value={quantity} onChange={(e) => setQty((s) => ({ ...s, [line.prescriptionItemId]: Math.max(0, Math.floor(Number(e.target.value) || 0)) }))} className="num" />
                    </Field>
                    <p className="pb-2 text-sm font-medium">{money(price, user?.hospital.currency)}</p>
                  </div>
                  <div className="mt-2 rounded-md border border-border text-xs">
                    <p className="border-b border-border bg-subtle/60 px-2 py-1 font-semibold text-muted">Pharmacy batches (FEFO order)</p>
                    {line.batches.length === 0 && <p className="px-2 py-1.5 text-danger">No stock in pharmacy</p>}
                    {line.batches.map((b) => {
                      const take = fefo.allocations.find((a) => a.batchId === b._id)?.quantity;
                      return (
                        <div key={b._id} className={cn('flex justify-between px-2 py-1', b.isExpired && 'text-danger line-through', take && 'bg-brand/5 font-medium')}>
                          <span className="font-mono">{b.batchNo}</span>
                          <span>exp {formatDate(b.expiryDate, { month: 'short', year: 'numeric' })}</span>
                          <span className="num">{b.quantity}{take ? ` → −${take}` : ''}</span>
                        </div>
                      );
                    })}
                    {fefo.shortfall > 0 && <p className="px-2 py-1.5 font-medium text-danger">Short by {fefo.shortfall} — reduce quantity or transfer stock from the main store.</p>}
                  </div>
                </div>
              )}
            </div>
          </Card>
        ))}
      </div>

      {!done && (
        <Card className="p-4">
          <div className="grid gap-3 sm:grid-cols-2">
            {needsWitness && (
              <Field label="Witness (controlled medicines)" required hint={can('pharmacy.controlled') ? 'Recorded in the controlled-drug register' : 'You are not authorised to dispense controlled medicines'}>
                <Input value={witness} onChange={(e) => setWitness(e.target.value)} placeholder="Full name of witness" />
              </Field>
            )}
            <Field label="Notes" className={needsWitness ? '' : 'sm:col-span-2'}><Textarea className="min-h-[38px]" value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
          </div>
          <div className="mt-4 flex flex-wrap items-center justify-end gap-3">
            <span className="text-sm">Charge to patient: <b className="num">{money(total, user?.hospital.currency)}</b></span>
            <Button icon={<PackageCheck className="h-4 w-4" />} disabled={!selected.length || problems.length > 0 || (needsWitness && !witness.trim())} onClick={() => setConfirm(true)}>
              Dispense {selected.length} item{selected.length === 1 ? '' : 's'}
            </Button>
          </div>
        </Card>
      )}

      {data.history.length > 0 && (
        <Card>
          <CardHeader title="Previously dispensed" />
          <ul className="divide-y divide-border text-sm">
            {data.history.map((h) => (
              <li key={h._id} className="px-4 py-2">
                <span className="font-mono text-xs">{h.dispenseNo}</span> · {formatDateTime(h.dispensedAt)} · {h.dispensedByName}
                <p className="text-xs text-muted">{h.lines.map((l) => `${l.itemName} × ${l.quantity}`).join(', ')}</p>
              </li>
            ))}
          </ul>
        </Card>
      )}
      {done && <EmptyState icon={<CheckCircle2 className="h-5 w-5" />} title="This prescription is fully dispensed" />}

      <ConfirmDialog
        open={confirm}
        onClose={() => setConfirm(false)}
        onConfirm={submit}
        loading={saving}
        title="Dispense medicines?"
        confirmLabel="Dispense"
        message={
          <div className="space-y-1">
            {selected.map((p) => (
              <p key={p.line.prescriptionItemId}>{p.line.item!.name} × {p.quantity} <span className="text-xs text-muted">from {p.fefo.allocations.map((a) => `${a.batchNo} (${a.quantity})`).join(', ')}</span></p>
            ))}
            <p className="pt-2 text-xs text-muted">Stock is deducted and {money(total, user?.hospital.currency)} is billed to the patient.</p>
          </div>
        }
      />
    </div>
  );
}
