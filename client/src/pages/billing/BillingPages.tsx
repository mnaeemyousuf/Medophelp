import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useFieldArray, useForm, useWatch } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { toast } from 'sonner';
import { Ban, CreditCard, FilePlus2, Printer, Receipt, RotateCcw, Search, Send, ShieldCheck, Trash2, Plus } from 'lucide-react';
import type { z } from 'zod';
import { INVOICE_SOURCES, INVOICE_STATUSES, PAYMENT_METHODS, createInvoiceSchema, lineTotals, round2 } from '@hms/shared';
import { api, newIdempotencyKey, openPdf, type Paged } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useCatalog } from '@/lib/catalog';
import { cn, formatDate, formatDateTime, humanize, money } from '@/lib/utils';
import { Button, Card, CardHeader, Input, PageHeader, PageLoader, Select, Textarea } from '@/components/ui/primitives';
import { DataTable, KeyValue, Pagination, StatCard } from '@/components/ui/data';
import { StatusBadge } from '@/components/ui/badge';
import { ConfirmDialog, Dialog, Drawer } from '@/components/ui/overlay';
import { Field, handleFormError } from '@/components/form/Field';
import type { Invoice, Patient } from '@/types';

interface InvoiceList extends Paged<Invoice> {
  totals: { total: number; paid: number; balance: number };
}

export function InvoicesPage({ portal }: { portal?: boolean }) {
  const { user, can } = useAuth();
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');
  const [status, setStatus] = useState('');
  const [source, setSource] = useState('');
  const [outstandingOnly, setOutstandingOnly] = useState(false);
  const [page, setPage] = useState(1);
  const [sort, setSort] = useState('');
  const [creating, setCreating] = useState(false);
  const cur = user?.hospital.currency;

  useEffect(() => {
    const t = setTimeout(() => { setDebounced(search.trim()); setPage(1); }, 300);
    return () => clearTimeout(t);
  }, [search]);

  const { data, isFetching } = useQuery({
    queryKey: ['invoices', debounced, status, source, outstandingOnly, page, sort],
    queryFn: () => api.get<InvoiceList>('/billing/invoices', { search: debounced, status, source, outstandingOnly: outstandingOnly || undefined, page, sort, pageSize: 20 }),
    placeholderData: keepPreviousData,
  });

  return (
    <>
      <PageHeader
        title={portal ? 'My bills' : 'Billing'}
        description={portal ? 'Invoices and payments for your visits.' : 'OPD, pharmacy, laboratory and other charges. Payments update balances immediately.'}
        actions={!portal && can('billing.manage') && <Button icon={<FilePlus2 className="h-4 w-4" />} onClick={() => setCreating(true)}>New invoice</Button>}
      />
      <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <StatCard label="Billed (filtered)" value={money(data?.totals.total, cur)} icon={<Receipt className="h-4 w-4" />} tone="info" />
        <StatCard label="Collected" value={money(data?.totals.paid, cur)} icon={<CreditCard className="h-4 w-4" />} tone="ok" />
        <StatCard label="Outstanding" value={money(data?.totals.balance, cur)} icon={<Receipt className="h-4 w-4" />} tone="warn" />
      </div>
      <Card>
        <div className="flex flex-wrap items-center gap-2 border-b border-border p-3">
          {!portal && (
            <div className="relative min-w-[220px] flex-1">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
              <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Invoice no., MRN or patient name" className="pl-8" />
            </div>
          )}
          <Select value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} className="w-40">
            <option value="">All statuses</option>
            {INVOICE_STATUSES.map((s) => <option key={s} value={s}>{humanize(s)}</option>)}
          </Select>
          {!portal && (
            <Select value={source} onChange={(e) => { setSource(e.target.value); setPage(1); }} className="w-40">
              <option value="">All departments</option>
              {INVOICE_SOURCES.map((s) => <option key={s}>{s}</option>)}
            </Select>
          )}
          <label className="flex items-center gap-2 text-sm text-muted">
            <input type="checkbox" checked={outstandingOnly} onChange={(e) => { setOutstandingOnly(e.target.checked); setPage(1); }} /> Outstanding only
          </label>
        </div>
        <DataTable
          sort={sort}
          onSort={(s) => { setSort(s); setPage(1); }}
          loading={isFetching}
          rows={data?.items}
          rowKey={(i) => i._id}
          onRowClick={portal ? undefined : (i) => navigate(`/billing/invoices/${i._id}`)}
          empty={{ icon: <Receipt className="h-5 w-5" />, title: 'No invoices found' }}
          columns={[
            { key: 'no', header: 'Invoice', sortKey: 'invoiceNo', cell: (i) => <span className="font-mono text-xs font-medium">{i.invoiceNo}</span> },
            ...(portal ? [] : [{ key: 'patient', header: 'Patient', cell: (i: Invoice) => <div><p className="font-medium">{i.patientName}</p><p className="font-mono text-[11px] text-muted">{i.mrn}</p></div> }]),
            { key: 'src', header: 'Department', cell: (i) => i.source, hideOnMobile: true },
            { key: 'date', header: 'Issued', sortKey: 'issued', cell: (i) => formatDate(i.issuedAt ?? i.createdAt), hideOnMobile: true },
            { key: 'total', header: 'Total', align: 'right', sortKey: 'total', cell: (i) => money(i.total, cur) },
            { key: 'paid', header: 'Paid', align: 'right', cell: (i) => money(i.paid - i.refunded, cur), hideOnMobile: true },
            { key: 'bal', header: 'Balance', align: 'right', sortKey: 'balance', cell: (i) => <span className={cn(i.balance > 0 && 'font-semibold text-warn')}>{money(i.balance, cur)}</span> },
            { key: 'st', header: 'Status', cell: (i) => <StatusBadge status={i.status} /> },
            ...(portal ? [{ key: 'pdf', header: '', align: 'right' as const, cell: (i: Invoice) => <Button size="sm" variant="ghost" icon={<Printer className="h-3.5 w-3.5" />} onClick={() => openPdf(`/billing/invoices/${i._id}/pdf`).catch((e) => toast.error(e.message))}>PDF</Button> }] : []),
          ]}
        />
        {data && <Pagination page={data.page} pageSize={data.pageSize} total={data.total} onPage={setPage} />}
      </Card>
      {!portal && <NewInvoiceDrawer open={creating} onClose={() => setCreating(false)} />}
    </>
  );
}

export function InvoiceDetailPage() {
  const { id } = useParams();
  const { user, can } = useAuth();
  const qc = useQueryClient();
  const [paying, setPaying] = useState(false);
  const [refunding, setRefunding] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<'issue' | 'cancel' | null>(null);
  const [cancelReason, setCancelReason] = useState('');
  const { data: inv, isLoading } = useQuery({ queryKey: ['invoice', id], queryFn: () => api.get<Invoice>(`/billing/invoices/${id}`) });
  const cur = user?.hospital.currency;
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['invoice', id] });
    qc.invalidateQueries({ queryKey: ['invoices'] });
  };
  const act = useMutation({
    mutationFn: (op: 'issue' | 'cancel') => api.post(`/billing/invoices/${id}/${op}`, op === 'cancel' ? { reason: cancelReason } : {}),
    onSuccess: (_d, op) => {
      toast.success(op === 'issue' ? 'Invoice issued' : 'Invoice cancelled');
      setConfirm(null);
      refresh();
    },
    onError: (e) => handleFormError(e),
  });

  if (isLoading || !inv) return <PageLoader />;
  const payable = ['Issued', 'PartiallyPaid'].includes(inv.status) && inv.balance > 0;

  return (
    <div className="space-y-4">
      <PageHeader
        title={`Invoice ${inv.invoiceNo}`}
        description={<span className="flex items-center gap-2">{inv.patientName} · <span className="font-mono">{inv.mrn}</span> · <StatusBadge status={inv.status} /></span>}
        actions={
          <>
            <Button variant="outline" icon={<Printer className="h-4 w-4" />} onClick={() => openPdf(`/billing/invoices/${inv._id}/pdf`).catch((e) => toast.error(e.message))}>Print</Button>
            {can('billing.manage') && inv.status === 'Draft' && <Button variant="outline" icon={<Send className="h-4 w-4" />} onClick={() => setConfirm('issue')}>Issue</Button>}
            {can('billing.manage') && ['Draft', 'Issued'].includes(inv.status) && inv.paid === 0 && <Button variant="outline" icon={<Ban className="h-4 w-4" />} onClick={() => setConfirm('cancel')}>Cancel</Button>}
            {can('insurance.manage') && payable && <Link to={`/insurance?new=1&invoiceId=${inv._id}`}><Button variant="outline" icon={<ShieldCheck className="h-4 w-4" />}>Insurance claim</Button></Link>}
            {can('payments.receive') && payable && <Button icon={<CreditCard className="h-4 w-4" />} onClick={() => setPaying(true)}>Record payment</Button>}
          </>
        }
      />
      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader title="Charges" description={`${inv.source} · issued ${formatDate(inv.issuedAt)}`} />
          <DataTable
            rows={inv.items}
            rowKey={(l) => l._id}
            columns={[
              { key: 'd', header: 'Description', cell: (l) => l.description },
              { key: 'q', header: 'Qty', align: 'right', cell: (l) => l.quantity },
              { key: 'p', header: 'Unit price', align: 'right', cell: (l) => money(l.unitPrice, cur), hideOnMobile: true },
              { key: 'disc', header: 'Discount', align: 'right', cell: (l) => money(l.discount, cur), hideOnMobile: true },
              { key: 't', header: 'Tax', align: 'right', cell: (l) => money(l.tax, cur), hideOnMobile: true },
              { key: 'tot', header: 'Total', align: 'right', cell: (l) => <span className="font-medium">{money(l.total, cur)}</span> },
            ]}
          />
          <div className="ml-auto max-w-xs space-y-1 border-t border-border p-4 text-sm">
            {[
              ['Subtotal', inv.subtotal],
              ['Discount', -inv.discountTotal],
              ['Tax', inv.taxTotal],
            ].map(([k, v]) => (
              <div key={k as string} className="flex justify-between text-muted"><span>{k}</span><span className="num">{money(v as number, cur)}</span></div>
            ))}
            <div className="flex justify-between border-t border-border pt-1 font-semibold"><span>Total</span><span className="num">{money(inv.total, cur)}</span></div>
            <div className="flex justify-between text-muted"><span>Paid (net)</span><span className="num">{money(inv.paid - inv.refunded, cur)}</span></div>
            <div className={cn('flex justify-between font-semibold', inv.balance > 0 ? 'text-warn' : 'text-ok')}><span>Balance due</span><span className="num">{money(inv.balance, cur)}</span></div>
          </div>
        </Card>
        <div className="space-y-4">
          <Card>
            <CardHeader title="Payments" />
            <ul className="divide-y divide-border">
              {!inv.payments?.length && <li className="px-4 py-3 text-sm text-muted">No payments yet</li>}
              {inv.payments?.map((p) => (
                <li key={p._id} className="px-4 py-2.5 text-sm">
                  <div className="flex items-center justify-between">
                    <span className="num font-medium">{money(p.amount, cur)}</span>
                    <span className="text-xs text-muted">{p.method}{p.reference ? ` · ${p.reference}` : ''}</span>
                  </div>
                  <p className="text-xs text-muted">{p.receiptNo} · {formatDateTime(p.receivedAt)} · {p.receivedByName}</p>
                  {p.refunded > 0 && <p className="text-xs text-violet-500">Refunded {money(p.refunded, cur)}</p>}
                  <div className="mt-1 flex gap-1">
                    <Button size="sm" variant="ghost" icon={<Printer className="h-3.5 w-3.5" />} onClick={() => openPdf(`/billing/payments/${p._id}/receipt`).catch((e) => toast.error(e.message))}>Receipt</Button>
                    {can('refunds.process') && p.amount - p.refunded > 0 && <Button size="sm" variant="ghost" icon={<RotateCcw className="h-3.5 w-3.5" />} onClick={() => setRefunding(p._id)}>Refund</Button>}
                  </div>
                </li>
              ))}
            </ul>
          </Card>
          {!!inv.refunds?.length && (
            <Card>
              <CardHeader title="Refunds" />
              <ul className="divide-y divide-border">
                {inv.refunds.map((r) => (
                  <li key={r._id} className="px-4 py-2.5 text-sm">
                    <p className="num font-medium">{money(r.amount, cur)} <span className="font-mono text-xs text-muted">{r.refundNo}</span></p>
                    <p className="text-xs text-muted">{r.reason} · {formatDateTime(r.processedAt)}</p>
                  </li>
                ))}
              </ul>
            </Card>
          )}
          {inv.notes && <Card className="p-4"><KeyValue cols={1} items={[['Notes', inv.notes]]} /></Card>}
        </div>
      </div>

      <PaymentDialog invoice={inv} open={paying} onClose={() => setPaying(false)} onDone={refresh} />
      <RefundDialog invoice={inv} paymentId={refunding} onClose={() => setRefunding(null)} onDone={refresh} />
      <ConfirmDialog
        open={confirm === 'issue'}
        onClose={() => setConfirm(null)}
        onConfirm={() => act.mutate('issue')}
        loading={act.isPending}
        title="Issue invoice?"
        message="Once issued, lines are locked and the patient can be charged."
        confirmLabel="Issue invoice"
      />
      <ConfirmDialog
        open={confirm === 'cancel'}
        onClose={() => setConfirm(null)}
        onConfirm={() => cancelReason.trim().length >= 3 && act.mutate('cancel')}
        loading={act.isPending}
        danger
        title="Cancel invoice?"
        confirmLabel="Cancel invoice"
        message="The invoice stays on record as Cancelled and cannot be paid."
      >
        <Field label="Reason" required><Textarea value={cancelReason} onChange={(e) => setCancelReason(e.target.value)} /></Field>
      </ConfirmDialog>
    </div>
  );
}

function PaymentDialog({ invoice, open, onClose, onDone }: { invoice: Invoice; open: boolean; onClose: () => void; onDone: () => void }) {
  const { user } = useAuth();
  const [amount, setAmount] = useState('');
  const { paymentMethods } = useCatalog();
  const [chosen, setMethod] = useState<(typeof PAYMENT_METHODS)[number]>('Cash');
  const method = paymentMethods.includes(chosen) ? chosen : paymentMethods[0];
  const [reference, setReference] = useState('');
  const [idemKey, setIdemKey] = useState(newIdempotencyKey);
  useEffect(() => {
    if (open) {
      setAmount(String(invoice.balance));
      setReference('');
      setIdemKey(newIdempotencyKey());
    }
  }, [open, invoice.balance]);
  const value = Number(amount);
  const err = !(value > 0) ? 'Enter an amount' : value > invoice.balance ? `Cannot exceed balance ${money(invoice.balance, user?.hospital.currency)}` : method !== 'Cash' && !reference.trim() ? 'Reference required for non-cash payments' : null;
  const m = useMutation({
    mutationFn: () => api.post<{ payment: { _id: string; receiptNo: string } }>(`/billing/invoices/${invoice._id}/payments`, { amount: value, method, reference: reference || undefined }, { idempotencyKey: idemKey }),
    onSuccess: (r) => {
      toast.success(`Payment recorded — ${r.payment.receiptNo}`, { action: { label: 'Print receipt', onClick: () => void openPdf(`/billing/payments/${r.payment._id}/receipt`) } });
      onDone();
      onClose();
    },
    onError: (e) => handleFormError(e),
  });
  return (
    <Dialog open={open} onClose={onClose} title="Record payment" description={`${invoice.invoiceNo} · balance ${money(invoice.balance, user?.hospital.currency)}`} footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button disabled={!!err} loading={m.isPending} onClick={() => m.mutate()}>Record payment</Button></>}>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Amount" required error={amount && err?.startsWith('Cannot') ? err : undefined}><Input type="number" min={0} step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} className="num text-base" /></Field>
        <Field label="Method" required><Select value={method} onChange={(e) => setMethod(e.target.value as typeof method)}>{paymentMethods.map((p) => <option key={p}>{p}</option>)}</Select></Field>
        <Field label="Reference" className="col-span-2" hint={method === 'Cash' ? 'Optional for cash' : 'Card slip, transaction id or claim no.'} error={err?.startsWith('Reference') ? err : undefined}><Input value={reference} onChange={(e) => setReference(e.target.value)} /></Field>
      </div>
    </Dialog>
  );
}

function RefundDialog({ invoice, paymentId, onClose, onDone }: { invoice: Invoice; paymentId: string | null; onClose: () => void; onDone: () => void }) {
  const { user } = useAuth();
  const payment = invoice.payments?.find((p) => p._id === paymentId);
  const max = payment ? round2(payment.amount - payment.refunded) : 0;
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [idemKey, setIdemKey] = useState(newIdempotencyKey);
  useEffect(() => {
    if (payment) {
      setAmount(String(max));
      setReason('');
      setIdemKey(newIdempotencyKey());
    }
  }, [payment, max]);
  const m = useMutation({
    mutationFn: () => api.post(`/billing/invoices/${invoice._id}/refunds`, { paymentId, amount: Number(amount), reason }, { idempotencyKey: idemKey }),
    onSuccess: () => {
      toast.success('Refund processed');
      onDone();
      onClose();
    },
    onError: (e) => handleFormError(e),
  });
  const valid = Number(amount) > 0 && Number(amount) <= max && reason.trim().length >= 3;
  return (
    <Dialog open={!!payment} onClose={onClose} title="Process refund" description={payment ? `${payment.receiptNo} · refundable ${money(max, user?.hospital.currency)}` : ''} footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button variant="danger" disabled={!valid} loading={m.isPending} onClick={() => m.mutate()}>Refund</Button></>}>
      <div className="space-y-3">
        <Field label="Amount" required><Input type="number" min={0} max={max} step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} /></Field>
        <Field label="Reason" required hint="Recorded in the audit log"><Textarea value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
      </div>
    </Dialog>
  );
}

type InvIn = z.input<typeof createInvoiceSchema>;
type InvOut = z.output<typeof createInvoiceSchema>;
interface ServiceRow {
  _id: string;
  code: string;
  name: string;
  price: number;
  category: string;
  taxable: boolean;
}

function NewInvoiceDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [patient, setPatient] = useState<{ id: string; label: string } | null>(null);
  const [search, setSearch] = useState('');
  const { data: services } = useQuery({ queryKey: ['services'], queryFn: () => api.get<ServiceRow[]>('/admin/services'), enabled: open });
  const { data: hospital } = useQuery({ queryKey: ['hospital-tax'], queryFn: () => api.get<{ defaultTaxRate: number }>('/admin/hospital').catch(() => ({ defaultTaxRate: 0 })), enabled: open });
  const { data: found } = useQuery({ queryKey: ['inv-patient', search], queryFn: () => api.get<Paged<Patient>>('/patients', { search, pageSize: 5 }), enabled: open && search.trim().length >= 2 && !patient });
  const form = useForm<InvIn, unknown, InvOut>({ resolver: zodResolver(createInvoiceSchema), defaultValues: { source: 'Other', issue: true, items: [], patientId: '' } });
  const items = useFieldArray({ control: form.control, name: 'items' });
  const watched = useWatch({ control: form.control, name: 'items' }) ?? [];
  const total = watched.reduce((s, l) => s + lineTotals({ quantity: Number(l?.quantity) || 0, unitPrice: Number(l?.unitPrice) || 0, discount: Number(l?.discount) || 0, taxRate: Number(l?.taxRate) || 0 }).total, 0);

  const submit = form.handleSubmit(async (v) => {
    try {
      const inv = await api.post<Invoice>('/billing/invoices', v);
      toast.success(`Invoice ${inv.invoiceNo} created`);
      onClose();
      navigate(`/billing/invoices/${inv._id}`);
    } catch (e) {
      handleFormError(e, form.setError);
    }
  });

  return (
    <Drawer open={open} onClose={onClose} width="sm:max-w-3xl" title="New invoice" description="For procedures and services not billed automatically." footer={<><span className="mr-auto self-center text-sm">Total <span className="num font-semibold">{money(total, user?.hospital.currency)}</span></span><Button variant="outline" onClick={onClose}>Cancel</Button><Button onClick={submit} loading={form.formState.isSubmitting}>Create & issue</Button></>}>
      <div className="space-y-4">
        <Field label="Patient" required error={form.formState.errors.patientId}>
          {patient ? (
            <div className="flex items-center justify-between rounded-md border border-brand/40 bg-brand/5 px-3 py-2 text-sm">
              {patient.label}
              <button className="text-xs text-brand" onClick={() => { setPatient(null); form.setValue('patientId', ''); }}>Change</button>
            </div>
          ) : (
            <div>
              <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search patient" />
              {found?.items.map((p) => (
                <button key={p.id} type="button" className="flex w-full justify-between px-2 py-1.5 text-left text-sm hover:bg-subtle" onClick={() => { setPatient({ id: p.id, label: `${p.fullName} · ${p.mrn}` }); form.setValue('patientId', p.id, { shouldValidate: true }); }}>
                  {p.fullName} <span className="font-mono text-xs text-muted">{p.mrn}</span>
                </button>
              ))}
            </div>
          )}
        </Field>
        <Field label="Department"><Select {...form.register('source')}>{INVOICE_SOURCES.map((s) => <option key={s}>{s}</option>)}</Select></Field>
        <div>
          <div className="mb-2 flex items-center justify-between">
            <p className="text-sm font-semibold">Lines</p>
            <div className="flex gap-2">
              <Select className="h-8 w-56 text-xs" value="" onChange={(e) => {
                const s = services?.find((x) => x._id === e.target.value);
                if (s) items.append({ serviceId: s._id, description: s.name, quantity: 1, unitPrice: s.price, discount: 0, taxRate: s.taxable ? hospital?.defaultTaxRate ?? 0 : 0 });
              }}>
                <option value="">+ Add from price list…</option>
                {services?.map((s) => <option key={s._id} value={s._id}>{s.name} — {money(s.price, user?.hospital.currency)}</option>)}
              </Select>
              <Button type="button" size="sm" variant="outline" icon={<Plus className="h-3.5 w-3.5" />} onClick={() => items.append({ description: '', quantity: 1, unitPrice: 0, discount: 0, taxRate: 0 })}>Custom</Button>
            </div>
          </div>
          {form.formState.errors.items?.message && <p className="mb-2 text-xs text-danger">{form.formState.errors.items.message}</p>}
          {items.fields.map((f, i) => (
            <div key={f.id} className="mb-2 grid grid-cols-[1fr_70px_100px_90px_70px_auto] items-end gap-2">
              <Field label="Description" error={form.formState.errors.items?.[i]?.description}><Input {...form.register(`items.${i}.description`)} /></Field>
              <Field label="Qty"><Input type="number" min={1} {...form.register(`items.${i}.quantity`)} /></Field>
              <Field label="Unit price"><Input type="number" min={0} {...form.register(`items.${i}.unitPrice`)} /></Field>
              <Field label="Discount"><Input type="number" min={0} {...form.register(`items.${i}.discount`)} /></Field>
              <Field label="Tax %"><Input type="number" min={0} max={100} {...form.register(`items.${i}.taxRate`)} /></Field>
              <Button type="button" variant="ghost" size="icon" onClick={() => items.remove(i)} aria-label="Remove line"><Trash2 className="h-4 w-4" /></Button>
            </div>
          ))}
        </div>
        <Field label="Notes"><Textarea {...form.register('notes')} /></Field>
      </div>
    </Drawer>
  );
}
