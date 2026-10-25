import { useEffect, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { toast } from 'sonner';
import { AlertTriangle, ArrowLeftRight, Boxes, CalendarX, Lock, Pencil, Plus, Search, Trash2, Undo2 } from 'lucide-react';
import type { z } from 'zod';
import { DOSAGE_FORMS, INVENTORY_TX_TYPES, ITEM_CATEGORIES, STOCK_LOCATIONS, itemSchema } from '@hms/shared';
import { api, type Paged } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useCatalog } from '@/lib/catalog';
import { cn, formatDate, formatDateTime, money } from '@/lib/utils';
import { Button, Card, CardHeader, Input, PageHeader, PageLoader, Select, Textarea } from '@/components/ui/primitives';
import { DataTable, KeyValue, Pagination, StatCard, Tabs } from '@/components/ui/data';
import { Badge } from '@/components/ui/badge';
import { Dialog, Drawer } from '@/components/ui/overlay';
import { Field, handleFormError } from '@/components/form/Field';
import type { StockBatch, StockItem, StockTx, Supplier } from '@/types';

const expirySoon = (d?: string | null, days = 90) => !!d && new Date(d).getTime() - Date.now() < days * 86_400_000;

export function InventoryPage() {
  const { can, user } = useAuth();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const tab = (params.get('tab') as 'items' | 'alerts' | 'ledger') ?? 'items';
  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');
  const [category, setCategory] = useState('');
  const [lowOnly, setLowOnly] = useState(false);
  const [txType, setTxType] = useState('');
  const [page, setPage] = useState(1);
  const [sort, setSort] = useState('');
  const [editing, setEditing] = useState<StockItem | 'new' | null>(null);
  useEffect(() => {
    const t = setTimeout(() => { setDebounced(search.trim()); setPage(1); }, 300);
    return () => clearTimeout(t);
  }, [search]);

  const items = useQuery({ queryKey: ['items', debounced, category, lowOnly, page, sort], queryFn: () => api.get<Paged<StockItem>>('/inventory/items', { search: debounced, category, lowStock: lowOnly || undefined, page, sort, pageSize: 25 }), enabled: tab === 'items', placeholderData: keepPreviousData });
  const alerts = useQuery({ queryKey: ['stock-alerts'], queryFn: () => api.get<{ lowStock: StockItem[]; expiring: StockBatch[] }>('/inventory/alerts', { days: 90 }) });
  const ledger = useQuery({ queryKey: ['ledger', txType, page], queryFn: () => api.get<Paged<StockTx>>('/inventory/transactions', { type: txType, page, pageSize: 30 }), enabled: tab === 'ledger', placeholderData: keepPreviousData });
  const expired = alerts.data?.expiring.filter((b) => b.isExpired) ?? [];
  const setTab = (t: string) => { setParams({ tab: t }); setPage(1); };

  return (
    <>
      <PageHeader title="Inventory" description="Medicines and supplies by batch and location. Every movement is written to an immutable ledger." actions={can('inventory.manage') && <Button icon={<Plus className="h-4 w-4" />} onClick={() => setEditing('new')}>New item</Button>} />
      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-3">
        <StatCard label="At or below reorder level" value={alerts.data?.lowStock.length ?? '…'} icon={<AlertTriangle className="h-4 w-4" />} tone="warn" onClick={() => setTab('alerts')} />
        <StatCard label="Batches expiring ≤ 90 days" value={alerts.data ? alerts.data.expiring.length - expired.length : '…'} icon={<CalendarX className="h-4 w-4" />} tone="violet" onClick={() => setTab('alerts')} />
        <StatCard label="Expired batches on shelf" value={alerts.data ? expired.length : '…'} hint="Write off under Expiry" icon={<Trash2 className="h-4 w-4" />} tone="danger" onClick={() => setTab('alerts')} />
      </div>
      <Card>
        <Tabs className="px-2" value={tab} onChange={setTab} tabs={[{ key: 'items', label: 'Items' }, { key: 'alerts', label: 'Alerts', count: (alerts.data?.lowStock.length ?? 0) + (alerts.data?.expiring.length ?? 0) }, { key: 'ledger', label: 'Stock ledger' }]} />
        {tab === 'items' && (
          <>
            <div className="flex flex-wrap items-center gap-2 border-b border-border p-3">
              <div className="relative min-w-[220px] flex-1">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
                <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Name, generic name or SKU" className="pl-8" />
              </div>
              <Select value={category} onChange={(e) => { setCategory(e.target.value); setPage(1); }} className="w-52"><option value="">All categories</option>{ITEM_CATEGORIES.map((c) => <option key={c}>{c}</option>)}</Select>
              <label className="flex items-center gap-2 text-sm text-muted"><input type="checkbox" checked={lowOnly} onChange={(e) => { setLowOnly(e.target.checked); setPage(1); }} /> Low stock only</label>
            </div>
            <DataTable
          sort={sort}
          onSort={(s) => { setSort(s); setPage(1); }}
              loading={items.isFetching}
              rows={items.data?.items}
              rowKey={(i) => i._id}
              onRowClick={(i) => navigate(`/inventory/items/${i._id}`)}
              empty={{ icon: <Boxes className="h-5 w-5" />, title: 'No items found' }}
              columns={[
                { key: 'sku', header: 'SKU', sortKey: 'sku', cell: (i) => <span className="font-mono text-xs">{i.sku}</span> },
                { key: 'name', header: 'Item', sortKey: 'name', cell: (i) => <div><p className="font-medium">{i.name} {i.isControlled && <Lock className="inline h-3 w-3 text-danger" />}</p><p className="text-[11px] text-muted">{i.category}{i.therapeuticClass ? ` · ${i.therapeuticClass}` : ''}{i.genericName ? ` · ${i.genericName}` : ''}</p></div> },
                { key: 'stock', header: 'In stock', align: 'right', sortKey: 'stock', cell: (i) => <span className={cn('font-semibold', i.isLow && 'text-warn')}>{i.currentStock} <span className="text-[11px] font-normal text-muted">{i.unit}</span></span> },
                { key: 'loc', header: 'Store / Pharmacy', align: 'right', cell: (i) => <span className="text-xs text-muted">{i.stockByLocation?.['Main Store'] ?? 0} / {i.stockByLocation?.Pharmacy ?? 0}</span>, hideOnMobile: true },
                { key: 'reorder', header: 'Reorder at', align: 'right', cell: (i) => i.reorderLevel, hideOnMobile: true },
                { key: 'exp', header: 'Next expiry', cell: (i) => <span className={cn('text-xs', expirySoon(i.nextExpiry) && 'font-medium text-warn')}>{i.nextExpiry ? formatDate(i.nextExpiry, { month: 'short', year: 'numeric' }) : '—'}</span>, hideOnMobile: true },
                { key: 'price', header: 'Sell price', align: 'right', cell: (i) => money(i.sellingPrice, user?.hospital.currency), hideOnMobile: true },
                { key: 'flags', header: '', cell: (i) => <div className="flex gap-1">{i.isLow && <Badge tone="warn">Low</Badge>}{!!i.expiredQty && <Badge tone="danger">{i.expiredQty} expired</Badge>}{!i.isActive && <Badge>Inactive</Badge>}</div> },
              ]}
            />
            {items.data && <Pagination page={items.data.page} pageSize={items.data.pageSize} total={items.data.total} onPage={setPage} />}
          </>
        )}
        {tab === 'alerts' && (
          <div className="grid gap-4 p-4 lg:grid-cols-2">
            <div>
              <h3 className="mb-2 text-sm font-semibold">Reorder needed</h3>
              <DataTable
                rows={alerts.data?.lowStock}
                rowKey={(i) => i._id}
                onRowClick={(i) => navigate(`/inventory/items/${i._id}`)}
                empty={{ title: 'Nothing below reorder level' }}
                columns={[
                  { key: 'name', header: 'Item', cell: (i) => <span className="font-medium">{i.name}</span> },
                  { key: 'stock', header: 'Stock', align: 'right', cell: (i) => <span className="font-semibold text-warn">{i.currentStock}</span> },
                  { key: 'reorder', header: 'Reorder at', align: 'right', cell: (i) => i.reorderLevel },
                ]}
              />
            </div>
            <div>
              <h3 className="mb-2 text-sm font-semibold">Expiring or expired batches</h3>
              <DataTable
                rows={alerts.data?.expiring}
                rowKey={(b) => b._id}
                onRowClick={(b) => navigate(`/inventory/items/${typeof b.itemId === 'object' ? b.itemId._id : b.itemId}`)}
                empty={{ title: 'No batches expiring in 90 days' }}
                columns={[
                  { key: 'item', header: 'Item / batch', cell: (b) => <div><p className="font-medium">{typeof b.itemId === 'object' ? b.itemId.name : ''}</p><p className="font-mono text-[11px] text-muted">{b.batchNo} · {b.location}</p></div> },
                  { key: 'qty', header: 'Qty', align: 'right', cell: (b) => b.quantity },
                  { key: 'exp', header: 'Expiry', cell: (b) => (b.isExpired ? <Badge tone="danger">Expired {formatDate(b.expiryDate)}</Badge> : <Badge tone={b.daysLeft! <= 30 ? 'danger' : 'warn'}>{b.daysLeft} days</Badge>) },
                ]}
              />
            </div>
          </div>
        )}
        {tab === 'ledger' && (
          <>
            <div className="border-b border-border p-3">
              <Select value={txType} onChange={(e) => { setTxType(e.target.value); setPage(1); }} className="w-52"><option value="">All movement types</option>{INVENTORY_TX_TYPES.map((t) => <option key={t}>{t}</option>)}</Select>
            </div>
            <LedgerTable rows={ledger.data?.items} loading={ledger.isFetching} showItem />
            {ledger.data && <Pagination page={ledger.data.page} pageSize={ledger.data.pageSize} total={ledger.data.total} onPage={setPage} />}
          </>
        )}
      </Card>
      <ItemDrawer item={editing} onClose={() => setEditing(null)} />
    </>
  );
}

function LedgerTable({ rows, loading, showItem }: { rows?: StockTx[]; loading?: boolean; showItem?: boolean }) {
  return (
    <DataTable
      loading={loading}
      rows={rows}
      rowKey={(t) => t._id}
      empty={{ title: 'No stock movements' }}
      columns={[
        { key: 'at', header: 'When', cell: (t) => <span className="num whitespace-nowrap text-xs">{formatDateTime(t.at)}</span> },
        ...(showItem ? [{ key: 'item', header: 'Item', cell: (t: StockTx) => (typeof t.itemId === 'object' ? t.itemId.name : '') }] : []),
        { key: 'type', header: 'Movement', cell: (t) => <Badge tone={t.quantity > 0 ? 'ok' : ['Expiry', 'Damage'].includes(t.type) ? 'danger' : 'info'}>{t.type}</Badge> },
        { key: 'batch', header: 'Batch / location', cell: (t) => <span className="font-mono text-[11px] text-muted">{t.batchNo} · {t.location}</span>, hideOnMobile: true },
        { key: 'qty', header: 'Qty', align: 'right', cell: (t) => <span className={cn('font-semibold', t.quantity > 0 ? 'text-ok' : 'text-danger')}>{t.quantity > 0 ? `+${t.quantity}` : t.quantity}</span> },
        { key: 'bal', header: 'Balance', align: 'right', cell: (t) => t.balanceAfter },
        { key: 'ref', header: 'Reference', cell: (t) => <span className="text-xs text-muted">{[t.refNo, t.reason].filter(Boolean).join(' · ')}</span>, hideOnMobile: true },
        { key: 'by', header: 'By', cell: (t) => <span className="text-xs text-muted">{t.byName}</span>, hideOnMobile: true },
      ]}
    />
  );
}

type ItemIn = z.input<typeof itemSchema>;
type ItemOut = z.output<typeof itemSchema>;

function ItemDrawer({ item, onClose }: { item: StockItem | 'new' | null; onClose: () => void }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const isNew = item === 'new';
  const { data: suppliers } = useQuery({ queryKey: ['suppliers'], queryFn: () => api.get<Supplier[]>('/purchasing/suppliers'), enabled: !!item });
  const form = useForm<ItemIn, unknown, ItemOut>({
    resolver: zodResolver(itemSchema),
    values:
      item && item !== 'new'
        ? { sku: item.sku, name: item.name, category: item.category as ItemIn['category'], genericName: item.genericName ?? '', therapeuticClass: item.therapeuticClass ?? '', form: item.form as ItemIn['form'], strength: item.strength ?? '', unit: item.unit, defaultSupplierId: typeof item.defaultSupplierId === 'object' ? item.defaultSupplierId._id : item.defaultSupplierId, purchasePrice: item.purchasePrice, sellingPrice: item.sellingPrice, reorderLevel: item.reorderLevel, isControlled: item.isControlled, isActive: item.isActive }
        : { sku: '', name: '', category: 'Medicine', unit: 'tablet', purchasePrice: 0, sellingPrice: 0, reorderLevel: 0, isControlled: false, isActive: true },
  });
  const category = form.watch('category');
  const { medicineCategories } = useCatalog();
  const { register, formState: { errors, isSubmitting } } = form;
  const submit = form.handleSubmit(async (v) => {
    try {
      const saved = isNew ? await api.post<StockItem>('/inventory/items', v) : await api.put<StockItem>(`/inventory/items/${(item as StockItem)._id}`, v);
      toast.success('Item saved');
      qc.invalidateQueries({ queryKey: ['items'] });
      qc.invalidateQueries({ queryKey: ['item'] });
      onClose();
      if (isNew) navigate(`/inventory/items/${saved._id}`);
    } catch (e) {
      handleFormError(e, form.setError);
    }
  });
  return (
    <Drawer open={!!item} onClose={onClose} title={isNew ? 'New stock item' : 'Edit item'} description="Opening stock is added through a purchase order receipt or an adjustment." footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button onClick={submit} loading={isSubmitting}>Save</Button></>}>
      <form onSubmit={submit} className="grid grid-cols-2 gap-3" noValidate>
        <Field label="SKU" required error={errors.sku}><Input {...register('sku')} /></Field>
        <Field label="Category"><Select {...register('category')}>{ITEM_CATEGORIES.map((c) => <option key={c}>{c}</option>)}</Select></Field>
        <Field label="Name" required error={errors.name} className="col-span-2"><Input placeholder="Paracetamol 500mg" {...register('name')} /></Field>
        {category === 'Medicine' && (
          <>
            <Field label="Generic name" error={errors.genericName}><Input {...register('genericName')} /></Field>
            <Field label="Therapeutic class" error={errors.therapeuticClass}><Select {...register('therapeuticClass', { setValueAs: (v) => v || undefined })}><option value="">—</option>{medicineCategories.map((m) => <option key={m}>{m}</option>)}</Select></Field>
            <Field label="Strength" error={errors.strength}><Input {...register('strength')} /></Field>
            <Field label="Dosage form"><Select {...register('form', { setValueAs: (v) => v || undefined })}><option value="">—</option>{DOSAGE_FORMS.map((f) => <option key={f}>{f}</option>)}</Select></Field>
            <label className="flex items-end gap-2 pb-2 text-sm"><input type="checkbox" {...register('isControlled')} /> Controlled medicine</label>
          </>
        )}
        <Field label="Unit of issue" required error={errors.unit}><Input placeholder="tablet, vial, box…" {...register('unit')} /></Field>
        <Field label="Default supplier"><Select {...register('defaultSupplierId', { setValueAs: (v) => v || undefined })}><option value="">—</option>{suppliers?.map((s) => <option key={s._id} value={s._id}>{s.name}</option>)}</Select></Field>
        <Field label="Purchase price" required error={errors.purchasePrice}><Input type="number" min={0} step="0.01" {...register('purchasePrice')} /></Field>
        <Field label="Selling price" required error={errors.sellingPrice}><Input type="number" min={0} step="0.01" {...register('sellingPrice')} /></Field>
        <Field label="Reorder level" required error={errors.reorderLevel}><Input type="number" min={0} {...register('reorderLevel')} /></Field>
        <label className="flex items-end gap-2 pb-2 text-sm"><input type="checkbox" {...register('isActive')} /> Active</label>
      </form>
    </Drawer>
  );
}

type BatchAction = { kind: 'adjust' | 'transfer' | 'return'; batch: StockBatch };

export function ItemDetailPage() {
  const { id } = useParams();
  const { can, user } = useAuth();
  const [editing, setEditing] = useState(false);
  const [action, setAction] = useState<BatchAction | null>(null);
  const { data, isLoading } = useQuery({ queryKey: ['item', id], queryFn: () => api.get<{ item: StockItem; batches: StockBatch[]; transactions: StockTx[] }>(`/inventory/items/${id}`) });
  if (isLoading || !data) return <PageLoader />;
  const { item, batches, transactions } = data;
  const manage = can('inventory.manage');

  return (
    <div className="space-y-4">
      <PageHeader
        title={item.name}
        description={<span className="flex flex-wrap items-center gap-2"><span className="font-mono">{item.sku}</span> · {item.category}{item.isControlled && <Badge tone="danger"><Lock className="mr-0.5 inline h-3 w-3" />Controlled</Badge>}{item.currentStock <= item.reorderLevel && <Badge tone="warn">Below reorder level</Badge>}</span>}
        actions={manage && <Button variant="outline" icon={<Pencil className="h-4 w-4" />} onClick={() => setEditing(true)}>Edit item</Button>}
      />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard label="Total in stock" value={`${item.currentStock} ${item.unit}`} icon={<Boxes className="h-4 w-4" />} tone={item.currentStock <= item.reorderLevel ? 'warn' : 'brand'} />
        <StatCard label="Main store" value={item.stockByLocation?.['Main Store'] ?? 0} />
        <StatCard label="Pharmacy" value={item.stockByLocation?.Pharmacy ?? 0} />
        <StatCard label="Stock value (cost)" value={money(item.currentStock * item.purchasePrice, user?.hospital.currency)} tone="ok" />
      </div>
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
        <Card>
          <CardHeader title="Batches" description="Earliest expiry first — the order pharmacy dispenses in" />
          <DataTable
            rows={batches}
            rowKey={(b) => b._id}
            empty={{ title: 'No stock on hand' }}
            rowClassName={(b) => (b.isExpired ? 'bg-danger/[0.04]' : undefined)}
            columns={[
              { key: 'batch', header: 'Batch', cell: (b) => <span className="font-mono text-xs font-medium">{b.batchNo}</span> },
              { key: 'loc', header: 'Location', cell: (b) => b.location },
              { key: 'exp', header: 'Expiry', cell: (b) => <span className={cn(b.isExpired ? 'font-semibold text-danger' : expirySoon(b.expiryDate) && 'text-warn')}>{formatDate(b.expiryDate)}{b.isExpired && ' (expired)'}</span> },
              { key: 'qty', header: 'Qty', align: 'right', cell: (b) => <span className="font-semibold">{b.quantity}</span> },
              { key: 'cost', header: 'Unit cost', align: 'right', cell: (b) => money(b.unitCost, user?.hospital.currency), hideOnMobile: true },
              {
                key: 'act',
                header: '',
                align: 'right',
                cell: (b) =>
                  manage && (
                    <div className="flex justify-end gap-1">
                      {!b.isExpired && <Button size="sm" variant="ghost" title="Transfer" onClick={() => setAction({ kind: 'transfer', batch: b })}><ArrowLeftRight className="h-4 w-4" /></Button>}
                      <Button size="sm" variant="ghost" title="Adjust / write off" onClick={() => setAction({ kind: 'adjust', batch: b })}>{b.isExpired ? <Trash2 className="h-4 w-4 text-danger" /> : <Pencil className="h-4 w-4" />}</Button>
                      <Button size="sm" variant="ghost" title="Return to supplier" onClick={() => setAction({ kind: 'return', batch: b })}><Undo2 className="h-4 w-4" /></Button>
                    </div>
                  ),
              },
            ]}
          />
        </Card>
        <Card>
          <CardHeader title="Details" />
          <div className="p-4">
            <KeyValue
              cols={1}
              items={[
                ['Generic', item.genericName],
                ['Form / strength', [item.form, item.strength].filter(Boolean).join(' ')],
                ['Unit', item.unit],
                ['Supplier', typeof item.defaultSupplierId === 'object' ? item.defaultSupplierId.name : '—'],
                ['Purchase / selling', `${money(item.purchasePrice, user?.hospital.currency)} / ${money(item.sellingPrice, user?.hospital.currency)}`],
                ['Reorder level', String(item.reorderLevel)],
              ]}
            />
          </div>
        </Card>
      </div>
      <Card>
        <CardHeader title="Recent movements" description="Last 100 ledger entries" />
        <LedgerTable rows={transactions} />
      </Card>
      <ItemDrawer item={editing ? item : null} onClose={() => setEditing(false)} />
      <BatchActionDialog action={action} itemId={item._id} onClose={() => setAction(null)} />
    </div>
  );
}

function BatchActionDialog({ action, itemId, onClose }: { action: BatchAction | null; itemId: string; onClose: () => void }) {
  const qc = useQueryClient();
  const b = action?.batch;
  const [type, setType] = useState<'Adjustment' | 'Damage' | 'Expiry' | 'Consumption'>('Adjustment');
  const [quantity, setQuantity] = useState('');
  const [reason, setReason] = useState('');
  const [to, setTo] = useState<(typeof STOCK_LOCATIONS)[number]>('Pharmacy');
  useEffect(() => {
    if (!b) return;
    setType(b.isExpired ? 'Expiry' : 'Adjustment');
    setQuantity(b.isExpired ? String(b.quantity) : '');
    setReason(b.isExpired ? 'Expired stock destroyed' : '');
    setTo(b.location === 'Pharmacy' ? 'Main Store' : 'Pharmacy');
  }, [b]);
  const m = useMutation({
    mutationFn: () => {
      const q = Number(quantity);
      if (action!.kind === 'transfer') return api.post('/inventory/transfers', { batchId: b!._id, to, quantity: q });
      if (action!.kind === 'return') return api.post('/inventory/returns', { batchId: b!._id, quantity: q, reason });
      return api.post('/inventory/adjustments', { batchId: b!._id, type, quantity: type === 'Adjustment' ? q : Math.abs(q), reason });
    },
    onSuccess: () => {
      toast.success('Stock updated');
      qc.invalidateQueries({ queryKey: ['item', itemId] });
      qc.invalidateQueries({ queryKey: ['items'] });
      qc.invalidateQueries({ queryKey: ['stock-alerts'] });
      onClose();
    },
    onError: (e) => handleFormError(e),
  });
  const q = Number(quantity);
  // Only a count correction may be negative; every other movement takes a positive quantity.
  const signedAllowed = action?.kind === 'adjust' && type === 'Adjustment';
  const reasonNeeded = action?.kind !== 'transfer';
  const valid = Number.isInteger(q) && q !== 0 && (signedAllowed || q > 0) && (!reasonNeeded || reason.trim().length >= 3);
  const title = action?.kind === 'transfer' ? 'Transfer stock' : action?.kind === 'return' ? 'Return to supplier' : 'Adjust or write off';
  return (
    <Dialog open={!!action} onClose={onClose} title={title} description={b ? `Batch ${b.batchNo} · ${b.location} · ${b.quantity} on hand` : ''} footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button disabled={!valid} loading={m.isPending} variant={action?.kind === 'adjust' && type !== 'Adjustment' ? 'danger' : 'primary'} onClick={() => m.mutate()}>Save</Button></>}>
      <div className="space-y-3">
        {action?.kind === 'adjust' && (
          <Field label="Type" hint={type === 'Adjustment' ? 'Positive adds stock (count found more), negative removes it' : 'Quantity removed from this batch'}>
            <Select value={type} onChange={(e) => setType(e.target.value as typeof type)}>
              {!b?.isExpired && <option value="Adjustment">Count correction (±)</option>}
              <option value="Expiry">Expiry write-off</option>
              <option value="Damage">Damage / breakage</option>
              {!b?.isExpired && <option value="Consumption">Ward consumption</option>}
            </Select>
          </Field>
        )}
        {action?.kind === 'transfer' && (
          <Field label="To"><Select value={to} onChange={(e) => setTo(e.target.value as typeof to)}>{STOCK_LOCATIONS.filter((l) => l !== b?.location).map((l) => <option key={l}>{l}</option>)}</Select></Field>
        )}
        <Field label="Quantity" required><Input type="number" value={quantity} onChange={(e) => setQuantity(e.target.value)} className="num" /></Field>
        {action?.kind !== 'transfer' && <Field label="Reason" required hint="Recorded in the ledger and audit log"><Textarea value={reason} onChange={(e) => setReason(e.target.value)} /></Field>}
      </div>
    </Dialog>
  );
}
