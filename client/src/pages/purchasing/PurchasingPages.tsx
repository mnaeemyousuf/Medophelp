import { useEffect, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useFieldArray, useForm, useWatch } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { toast } from 'sonner';
import { Ban, CheckCircle2, ClipboardList, PackagePlus, Pencil, Plus, Send, ShoppingCart, Trash2, Truck, Undo2 } from 'lucide-react';
import type { z } from 'zod';
import { PO_STATUSES, STOCK_LOCATIONS, lineTotals, purchaseOrderSchema, supplierSchema } from '@hms/shared';
import { api, type Paged } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { cn, formatDate, formatDateTime, humanize, money, todayIso } from '@/lib/utils';
import { Button, Card, CardHeader, Input, PageHeader, PageLoader, Select, Textarea } from '@/components/ui/primitives';
import { DataTable, KeyValue, Pagination, Tabs } from '@/components/ui/data';
import { Badge, StatusBadge } from '@/components/ui/badge';
import { Dialog, Drawer } from '@/components/ui/overlay';
import { Field, handleFormError } from '@/components/form/Field';
import type { PurchaseOrder, StockItem, Supplier } from '@/types';

export function PurchasingPage() {
  const { can, user } = useAuth();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const tab = (params.get('tab') as 'orders' | 'suppliers') ?? 'orders';
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const [sort, setSort] = useState('');
  const [editingPo, setEditingPo] = useState<PurchaseOrder | 'new' | null>(null);
  const [editingSupplier, setEditingSupplier] = useState<Supplier | 'new' | null>(null);
  const orders = useQuery({ queryKey: ['pos', status, page, sort], queryFn: () => api.get<Paged<PurchaseOrder>>('/purchasing/orders', { status, page, sort, pageSize: 25 }), enabled: tab === 'orders', placeholderData: keepPreviousData });
  const suppliers = useQuery({ queryKey: ['suppliers', 'all'], queryFn: () => api.get<Supplier[]>('/purchasing/suppliers', { includeInactive: true }), enabled: tab === 'suppliers' });
  const manage = can('purchasing.manage');

  return (
    <>
      <PageHeader
        title="Purchasing"
        description="Purchase orders with approval, goods receipt into batches, and supplier records."
        actions={manage && (tab === 'orders' ? <Button icon={<ShoppingCart className="h-4 w-4" />} onClick={() => setEditingPo('new')}>New purchase order</Button> : <Button icon={<Plus className="h-4 w-4" />} onClick={() => setEditingSupplier('new')}>New supplier</Button>)}
      />
      <Card>
        <div className="flex flex-wrap items-center gap-2 border-b border-border px-2">
          <Tabs className="flex-1 border-0" value={tab} onChange={(t) => { setParams({ tab: t }); setPage(1); }} tabs={[{ key: 'orders', label: 'Purchase orders' }, { key: 'suppliers', label: 'Suppliers' }]} />
          {tab === 'orders' && (
            <Select value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} className="my-2 w-48">
              <option value="">All statuses</option>
              {PO_STATUSES.map((s) => <option key={s} value={s}>{humanize(s)}</option>)}
            </Select>
          )}
        </div>
        {tab === 'orders' ? (
          <>
            <DataTable
          sort={sort}
          onSort={(s) => { setSort(s); setPage(1); }}
              loading={orders.isFetching}
              rows={orders.data?.items}
              rowKey={(p) => p._id}
              onRowClick={(p) => navigate(`/purchasing/orders/${p._id}`)}
              empty={{ icon: <Truck className="h-5 w-5" />, title: 'No purchase orders' }}
              columns={[
                { key: 'no', header: 'PO', sortKey: 'created', cell: (p) => <div><p className="font-mono text-xs font-medium">{p.poNo}</p><p className="text-[11px] text-muted">{formatDate(p.createdAt)}</p></div> },
                { key: 'sup', header: 'Supplier', sortKey: 'supplier', cell: (p) => <span className="font-medium">{p.supplierName}</span> },
                { key: 'lines', header: 'Lines', cell: (p) => <span className="text-xs text-muted">{p.items.length} item(s) · {p.items.reduce((s, l) => s + l.receivedQuantity, 0)}/{p.items.reduce((s, l) => s + l.quantity, 0)} received</span>, hideOnMobile: true },
                { key: 'exp', header: 'Expected', sortKey: 'expectedDelivery', cell: (p) => formatDate(p.expectedDelivery), hideOnMobile: true },
                { key: 'by', header: 'Raised by', cell: (p) => <span className="text-xs text-muted">{p.requestedByName}</span>, hideOnMobile: true },
                { key: 'total', header: 'Total', align: 'right', sortKey: 'total', cell: (p) => money(p.total, user?.hospital.currency) },
                { key: 'st', header: 'Status', cell: (p) => <StatusBadge status={p.status} /> },
              ]}
            />
            {orders.data && <Pagination page={orders.data.page} pageSize={orders.data.pageSize} total={orders.data.total} onPage={setPage} />}
          </>
        ) : (
          <DataTable
            loading={suppliers.isFetching}
            rows={suppliers.data}
            rowKey={(s) => s._id}
            onRowClick={manage ? setEditingSupplier : undefined}
            columns={[
              { key: 'code', header: 'Code', cell: (s) => <span className="font-mono text-xs">{s.code}</span> },
              { key: 'name', header: 'Supplier', cell: (s) => <span className="font-medium">{s.name}</span> },
              { key: 'contact', header: 'Contact', cell: (s) => <span className="text-sm">{s.contactPerson}{s.phone ? ` · ${s.phone}` : ''}</span>, hideOnMobile: true },
              { key: 'terms', header: 'Terms', cell: (s) => `${s.paymentTermsDays} days`, hideOnMobile: true },
              { key: 'st', header: '', cell: (s) => (s.isActive ? <Badge tone="ok" dot>Active</Badge> : <Badge>Inactive</Badge>) },
            ]}
          />
        )}
      </Card>
      <PoDrawer po={editingPo} onClose={() => setEditingPo(null)} />
      <SupplierDialog supplier={editingSupplier} onClose={() => setEditingSupplier(null)} />
    </>
  );
}

type PoIn = z.input<typeof purchaseOrderSchema>;
type PoOut = z.output<typeof purchaseOrderSchema>;

function PoDrawer({ po, onClose }: { po: PurchaseOrder | 'new' | null; onClose: () => void }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { user } = useAuth();
  const isNew = po === 'new';
  const [itemSearch, setItemSearch] = useState('');
  const { data: suppliers } = useQuery({ queryKey: ['suppliers'], queryFn: () => api.get<Supplier[]>('/purchasing/suppliers'), enabled: !!po });
  const { data: found } = useQuery({ queryKey: ['po-items', itemSearch], queryFn: () => api.get<Paged<StockItem>>('/inventory/items', { search: itemSearch, pageSize: 8 }), enabled: !!po && itemSearch.trim().length >= 2 });
  const { data: lowStock } = useQuery({ queryKey: ['stock-alerts'], queryFn: () => api.get<{ lowStock: StockItem[] }>('/inventory/alerts'), enabled: !!po && isNew });
  const [names, setNames] = useState<Record<string, string>>({});
  const form = useForm<PoIn, unknown, PoOut>({
    resolver: zodResolver(purchaseOrderSchema),
    values:
      po && po !== 'new'
        ? { supplierId: po.supplierId, expectedDelivery: po.expectedDelivery?.slice(0, 10), notes: po.notes ?? '', items: po.items.map((l) => ({ itemId: l.itemId, quantity: l.quantity, unitPrice: l.unitPrice, discount: l.discount, taxRate: l.taxRate })) }
        : { supplierId: '', items: [] },
  });
  useEffect(() => {
    if (po && po !== 'new') setNames(Object.fromEntries(po.items.map((l) => [l.itemId, l.itemName])));
  }, [po]);
  const lines = useFieldArray({ control: form.control, name: 'items' });
  const watched = useWatch({ control: form.control, name: 'items' }) ?? [];
  const supplierId = form.watch('supplierId');
  const total = watched.reduce((s, l) => s + lineTotals({ quantity: Number(l?.quantity) || 0, unitPrice: Number(l?.unitPrice) || 0, discount: Number(l?.discount) || 0, taxRate: Number(l?.taxRate) || 0 }).total, 0);
  const add = (i: StockItem) => {
    if (watched.some((l) => l?.itemId === i._id)) return toast.info(`${i.name} is already on the order`);
    setNames((n) => ({ ...n, [i._id]: i.name }));
    lines.append({ itemId: i._id, quantity: Math.max(1, i.reorderLevel * 2 - i.currentStock), unitPrice: i.purchasePrice, discount: 0, taxRate: 0 });
    setItemSearch('');
  };
  const suggestions = lowStock?.lowStock.filter((i) => !supplierId || (typeof i.defaultSupplierId === 'string' ? i.defaultSupplierId : i.defaultSupplierId?._id) === supplierId) ?? [];

  const submit = form.handleSubmit(async (v) => {
    try {
      const saved = isNew ? await api.post<PurchaseOrder>('/purchasing/orders', v) : await api.put<PurchaseOrder>(`/purchasing/orders/${(po as PurchaseOrder)._id}`, v);
      toast.success(isNew ? `Draft ${saved.poNo} created` : 'Purchase order updated');
      qc.invalidateQueries({ queryKey: ['pos'] });
      qc.invalidateQueries({ queryKey: ['po'] });
      onClose();
      if (isNew) navigate(`/purchasing/orders/${saved._id}`);
    } catch (e) {
      handleFormError(e, form.setError);
    }
  });

  return (
    <Drawer open={!!po} onClose={onClose} width="sm:max-w-4xl" title={isNew ? 'New purchase order' : `Edit ${(po as PurchaseOrder | null)?.poNo ?? ''}`} footer={<><span className="mr-auto self-center text-sm">Total <b className="num">{money(total, user?.hospital.currency)}</b></span><Button variant="outline" onClick={onClose}>Cancel</Button><Button onClick={submit} loading={form.formState.isSubmitting}>Save draft</Button></>}>
      <form onSubmit={submit} className="space-y-4" noValidate>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Supplier" required error={form.formState.errors.supplierId}>
            <Select {...form.register('supplierId')}><option value="">Select supplier…</option>{suppliers?.map((s) => <option key={s._id} value={s._id}>{s.name}</option>)}</Select>
          </Field>
          <Field label="Expected delivery" error={form.formState.errors.expectedDelivery}><Input type="date" min={todayIso()} {...form.register('expectedDelivery', { setValueAs: (v) => v || undefined })} /></Field>
        </div>
        <div>
          <p className="mb-2 text-sm font-semibold">Items</p>
          <Input value={itemSearch} onChange={(e) => setItemSearch(e.target.value)} placeholder="Search items to add…" />
          {found?.items.length ? (
            <div className="mt-1 rounded-md border border-border">
              {found.items.map((i) => (
                <button key={i._id} type="button" onClick={() => add(i)} className="flex w-full justify-between px-3 py-1.5 text-left text-sm hover:bg-subtle">
                  <span>{i.name}</span>
                  <span className="text-xs text-muted">stock {i.currentStock} · reorder {i.reorderLevel}</span>
                </button>
              ))}
            </div>
          ) : null}
          {isNew && suggestions.length > 0 && (
            <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs">
              <span className="text-muted">Low stock{supplierId ? ' from this supplier' : ''}:</span>
              {suggestions.slice(0, 8).map((i) => (
                <button key={i._id} type="button" onClick={() => add(i)} className="rounded-full border border-warn/40 bg-warn/10 px-2 py-0.5 text-warn hover:bg-warn/20">+ {i.name}</button>
              ))}
            </div>
          )}
          {form.formState.errors.items?.message && <p className="mt-2 text-xs text-danger">{form.formState.errors.items.message}</p>}
          <div className="mt-3 space-y-2">
            {lines.fields.map((f, i) => {
              const l = watched[i];
              const lt = lineTotals({ quantity: Number(l?.quantity) || 0, unitPrice: Number(l?.unitPrice) || 0, discount: Number(l?.discount) || 0, taxRate: Number(l?.taxRate) || 0 });
              return (
                <div key={f.id} className="grid grid-cols-2 items-end gap-2 rounded-md border border-border p-2 sm:grid-cols-[1fr_80px_100px_90px_70px_100px_auto]">
                  <p className="col-span-2 self-center text-sm font-medium sm:col-span-1">{names[l?.itemId ?? ''] ?? 'Item'}</p>
                  <Field label="Qty" error={form.formState.errors.items?.[i]?.quantity}><Input type="number" min={1} {...form.register(`items.${i}.quantity`)} /></Field>
                  <Field label="Unit price" error={form.formState.errors.items?.[i]?.unitPrice}><Input type="number" min={0} step="0.01" {...form.register(`items.${i}.unitPrice`)} /></Field>
                  <Field label="Discount"><Input type="number" min={0} {...form.register(`items.${i}.discount`)} /></Field>
                  <Field label="Tax %"><Input type="number" min={0} max={100} {...form.register(`items.${i}.taxRate`)} /></Field>
                  <p className="num self-center text-right text-sm font-medium">{money(lt.total, user?.hospital.currency)}</p>
                  <Button type="button" variant="ghost" size="icon" onClick={() => lines.remove(i)} aria-label="Remove line"><Trash2 className="h-4 w-4" /></Button>
                </div>
              );
            })}
          </div>
        </div>
        <Field label="Notes"><Textarea {...form.register('notes')} /></Field>
      </form>
    </Drawer>
  );
}

export function PurchaseOrderPage() {
  const { id } = useParams();
  const { can, user } = useAuth();
  const qc = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [receiving, setReceiving] = useState(false);
  const [noteFor, setNoteFor] = useState<'reject' | 'cancel' | null>(null);
  const [note, setNote] = useState('');
  const { data: po, isLoading } = useQuery({ queryKey: ['po', id], queryFn: () => api.get<PurchaseOrder>(`/purchasing/orders/${id}`) });
  const act = useMutation({
    mutationFn: ({ op, note }: { op: string; note?: string }) => api.post(`/purchasing/orders/${id}/${op}`, { note }),
    onSuccess: (_d, v) => {
      toast.success({ submit: 'Sent for approval', approve: 'Approved', reject: 'Returned to draft', order: 'Marked as ordered', cancel: 'Purchase order cancelled' }[v.op] ?? 'Done');
      setNoteFor(null);
      setNote('');
      qc.invalidateQueries({ queryKey: ['po', id] });
      qc.invalidateQueries({ queryKey: ['pos'] });
    },
    onError: (e) => handleFormError(e),
  });
  if (isLoading || !po) return <PageLoader />;
  const cur = user?.hospital.currency;
  const manage = can('purchasing.manage');
  const approve = can('purchasing.approve');

  return (
    <div className="space-y-4">
      <PageHeader
        title={`Purchase order ${po.poNo}`}
        description={<span className="flex items-center gap-2">{po.supplierName} · <StatusBadge status={po.status} /></span>}
        actions={
          <>
            {manage && po.status === 'Draft' && <Button variant="outline" icon={<Pencil className="h-4 w-4" />} onClick={() => setEditing(true)}>Edit</Button>}
            {manage && po.status === 'Draft' && <Button icon={<Send className="h-4 w-4" />} loading={act.isPending} onClick={() => act.mutate({ op: 'submit' })}>Submit for approval</Button>}
            {approve && po.status === 'PendingApproval' && (
              <>
                <Button variant="outline" icon={<Undo2 className="h-4 w-4" />} onClick={() => setNoteFor('reject')}>Reject</Button>
                <Button icon={<CheckCircle2 className="h-4 w-4" />} loading={act.isPending} onClick={() => act.mutate({ op: 'approve' })}>Approve</Button>
              </>
            )}
            {manage && po.status === 'Approved' && <Button icon={<Truck className="h-4 w-4" />} loading={act.isPending} onClick={() => act.mutate({ op: 'order' })}>Mark as ordered</Button>}
            {(can('purchasing.manage') || can('inventory.manage')) && ['Ordered', 'PartiallyReceived'].includes(po.status) && <Button icon={<PackagePlus className="h-4 w-4" />} onClick={() => setReceiving(true)}>Receive goods</Button>}
            {manage && ['Draft', 'PendingApproval', 'Approved', 'Ordered'].includes(po.status) && !po.items.some((l) => l.receivedQuantity > 0) && <Button variant="ghost" className="text-danger" icon={<Ban className="h-4 w-4" />} onClick={() => setNoteFor('cancel')}>Cancel</Button>}
          </>
        }
      />
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
        <div className="space-y-4">
          <Card>
            <CardHeader title="Lines" />
            <DataTable
              rows={po.items}
              rowKey={(l) => l._id}
              columns={[
                { key: 'item', header: 'Item', cell: (l) => <div><p className="font-medium">{l.itemName}</p><p className="font-mono text-[11px] text-muted">{l.sku}</p></div> },
                { key: 'qty', header: 'Ordered', align: 'right', cell: (l) => `${l.quantity} ${l.unit ?? ''}` },
                { key: 'rec', header: 'Received', align: 'right', cell: (l) => <span className={cn(l.receivedQuantity >= l.quantity ? 'text-ok' : l.receivedQuantity > 0 && 'text-warn')}>{l.receivedQuantity}</span> },
                { key: 'price', header: 'Unit price', align: 'right', cell: (l) => money(l.unitPrice, cur), hideOnMobile: true },
                { key: 'tax', header: 'Tax', align: 'right', cell: (l) => money(l.tax, cur), hideOnMobile: true },
                { key: 'tot', header: 'Total', align: 'right', cell: (l) => <span className="font-medium">{money(l.total, cur)}</span> },
              ]}
            />
            <div className="ml-auto max-w-xs space-y-1 border-t border-border p-4 text-sm">
              <div className="flex justify-between text-muted"><span>Subtotal</span><span className="num">{money(po.subtotal, cur)}</span></div>
              <div className="flex justify-between text-muted"><span>Discount</span><span className="num">−{money(po.discountTotal, cur)}</span></div>
              <div className="flex justify-between text-muted"><span>Tax</span><span className="num">{money(po.taxTotal, cur)}</span></div>
              <div className="flex justify-between border-t border-border pt-1 font-semibold"><span>Total</span><span className="num">{money(po.total, cur)}</span></div>
            </div>
          </Card>
          {!!po.receipts?.length && (
            <Card>
              <CardHeader title="Goods receipts" />
              <ul className="divide-y divide-border">
                {po.receipts.map((g) => (
                  <li key={g._id} className="px-4 py-3 text-sm">
                    <p><span className="font-mono text-xs font-medium">{g.grnNo}</span> · {formatDateTime(g.receivedAt)} · {g.location} · {g.receivedByName}{g.invoiceRef ? ` · inv ${g.invoiceRef}` : ''}</p>
                    {g.lines.map((l, i) => <p key={i} className="text-xs text-muted">{l.itemName} × {l.quantity} — batch {l.batchNo}, exp {formatDate(l.expiryDate)}</p>)}
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </div>
        <div className="space-y-4">
          <Card>
            <CardHeader title="Details" />
            <div className="p-4">
              <KeyValue cols={1} items={[['Expected delivery', formatDate(po.expectedDelivery)], ['Raised by', po.requestedByName], ['Approved', po.approvedByName ? `${po.approvedByName} · ${formatDateTime(po.approvedAt)}` : '—'], ['Ordered', formatDateTime(po.orderedAt)], ['Notes', po.notes], ...(po.cancelReason ? ([['Cancelled', po.cancelReason]] as Array<[string, string]>) : [])]} />
            </div>
          </Card>
          {po.history && (
            <Card>
              <CardHeader title="History" />
              <ol className="space-y-2 p-4 text-xs">
                {po.history.map((h, i) => (
                  <li key={i} className="flex gap-2">
                    <ClipboardList className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted" />
                    <span><span className="font-medium">{humanize(h.status)}</span> · {formatDateTime(h.at)} · {h.byName}{h.note && <span className="block text-muted">{h.note}</span>}</span>
                  </li>
                ))}
              </ol>
            </Card>
          )}
        </div>
      </div>
      <PoDrawer po={editing ? po : null} onClose={() => setEditing(false)} />
      <ReceiveDialog po={po} open={receiving} onClose={() => setReceiving(false)} />
      <Dialog open={!!noteFor} onClose={() => setNoteFor(null)} title={noteFor === 'reject' ? 'Reject purchase order' : 'Cancel purchase order'} footer={<><Button variant="outline" onClick={() => setNoteFor(null)}>Back</Button><Button variant="danger" disabled={note.trim().length < 3} loading={act.isPending} onClick={() => act.mutate({ op: noteFor!, note })}>{noteFor === 'reject' ? 'Reject' : 'Cancel PO'}</Button></>}>
        <Field label="Reason" required><Textarea autoFocus value={note} onChange={(e) => setNote(e.target.value)} /></Field>
      </Dialog>
    </div>
  );
}

function ReceiveDialog({ po, open, onClose }: { po: PurchaseOrder; open: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const outstanding = po.items.filter((l) => l.receivedQuantity < l.quantity);
  const [location, setLocation] = useState<(typeof STOCK_LOCATIONS)[number]>('Main Store');
  const [invoiceRef, setInvoiceRef] = useState('');
  const [rows, setRows] = useState<Record<string, { quantity: string; batchNo: string; expiryDate: string }>>({});
  useEffect(() => {
    if (open) setRows(Object.fromEntries(outstanding.map((l) => [l._id, { quantity: String(l.quantity - l.receivedQuantity), batchNo: '', expiryDate: '' }])));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, po]);
  const lines = Object.entries(rows).filter(([, r]) => Number(r.quantity) > 0);
  const valid = lines.length > 0 && lines.every(([, r]) => r.batchNo.trim() && r.expiryDate);
  const m = useMutation({
    mutationFn: () => api.post<{ grn: { grnNo: string } }>(`/purchasing/orders/${po._id}/receive`, { location, invoiceRef: invoiceRef || undefined, lines: lines.map(([lineId, r]) => ({ lineId, quantity: Number(r.quantity), batchNo: r.batchNo.trim(), expiryDate: r.expiryDate })) }),
    onSuccess: (res) => {
      toast.success(`Goods received — ${res.grn.grnNo}`, { description: `Stock added to ${location}` });
      qc.invalidateQueries({ queryKey: ['po', po._id] });
      qc.invalidateQueries({ queryKey: ['pos'] });
      qc.invalidateQueries({ queryKey: ['items'] });
      onClose();
    },
    onError: (e) => handleFormError(e),
  });
  const set = (id: string, k: 'quantity' | 'batchNo' | 'expiryDate', v: string) => setRows((r) => ({ ...r, [id]: { ...r[id], [k]: v } }));
  return (
    <Dialog open={open} onClose={onClose} width="max-w-3xl" title="Receive goods" description="Enter what arrived. Each line becomes a batch with its expiry date." footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button disabled={!valid} loading={m.isPending} onClick={() => m.mutate()}>Post goods receipt</Button></>}>
      <div className="mb-3 grid grid-cols-2 gap-3">
        <Field label="Receive into"><Select value={location} onChange={(e) => setLocation(e.target.value as typeof location)}>{STOCK_LOCATIONS.map((l) => <option key={l}>{l}</option>)}</Select></Field>
        <Field label="Supplier invoice / DC no."><Input value={invoiceRef} onChange={(e) => setInvoiceRef(e.target.value)} /></Field>
      </div>
      <div className="space-y-2">
        {outstanding.map((l) => (
          <div key={l._id} className="grid grid-cols-2 items-end gap-2 rounded-md border border-border p-2 sm:grid-cols-[1fr_90px_130px_150px]">
            <div className="col-span-2 self-center sm:col-span-1">
              <p className="text-sm font-medium">{l.itemName}</p>
              <p className="text-[11px] text-muted">{l.quantity - l.receivedQuantity} of {l.quantity} outstanding</p>
            </div>
            <Field label="Qty"><Input type="number" min={0} max={l.quantity - l.receivedQuantity} value={rows[l._id]?.quantity ?? ''} onChange={(e) => set(l._id, 'quantity', e.target.value)} /></Field>
            <Field label="Batch no."><Input value={rows[l._id]?.batchNo ?? ''} onChange={(e) => set(l._id, 'batchNo', e.target.value)} /></Field>
            <Field label="Expiry"><Input type="date" min={todayIso()} value={rows[l._id]?.expiryDate ?? ''} onChange={(e) => set(l._id, 'expiryDate', e.target.value)} /></Field>
          </div>
        ))}
      </div>
    </Dialog>
  );
}

type SupIn = z.input<typeof supplierSchema>;
type SupOut = z.output<typeof supplierSchema>;

function SupplierDialog({ supplier, onClose }: { supplier: Supplier | 'new' | null; onClose: () => void }) {
  const qc = useQueryClient();
  const isNew = supplier === 'new';
  const form = useForm<SupIn, unknown, SupOut>({
    resolver: zodResolver(supplierSchema),
    values: supplier && supplier !== 'new' ? { code: supplier.code, name: supplier.name, contactPerson: supplier.contactPerson ?? '', phone: supplier.phone, email: supplier.email ?? '', address: supplier.address ?? '', taxNumber: supplier.taxNumber ?? '', paymentTermsDays: supplier.paymentTermsDays, isActive: supplier.isActive } : { code: '', name: '', paymentTermsDays: 30, isActive: true },
  });
  const { register, formState: { errors, isSubmitting } } = form;
  const submit = form.handleSubmit(async (v) => {
    try {
      if (isNew) await api.post('/purchasing/suppliers', v);
      else await api.put(`/purchasing/suppliers/${(supplier as Supplier)._id}`, v);
      toast.success('Supplier saved');
      qc.invalidateQueries({ queryKey: ['suppliers'] });
      onClose();
    } catch (e) {
      handleFormError(e, form.setError);
    }
  });
  return (
    <Dialog open={!!supplier} onClose={onClose} title={isNew ? 'New supplier' : 'Edit supplier'} footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button onClick={submit} loading={isSubmitting}>Save</Button></>}>
      <form onSubmit={submit} className="grid grid-cols-2 gap-3" noValidate>
        <Field label="Code" required error={errors.code}><Input {...register('code')} /></Field>
        <Field label="Name" required error={errors.name}><Input {...register('name')} /></Field>
        <Field label="Contact person" error={errors.contactPerson}><Input {...register('contactPerson')} /></Field>
        <Field label="Phone" error={errors.phone}><Input {...register('phone', { setValueAs: (v) => v || undefined })} /></Field>
        <Field label="Email" error={errors.email}><Input {...register('email')} /></Field>
        <Field label="Tax number (NTN)" error={errors.taxNumber}><Input {...register('taxNumber')} /></Field>
        <Field label="Address" className="col-span-2"><Input {...register('address')} /></Field>
        <Field label="Payment terms (days)" error={errors.paymentTermsDays}><Input type="number" min={0} {...register('paymentTermsDays')} /></Field>
        <label className="flex items-end gap-2 pb-2 text-sm"><input type="checkbox" {...register('isActive')} /> Active</label>
      </form>
    </Dialog>
  );
}
