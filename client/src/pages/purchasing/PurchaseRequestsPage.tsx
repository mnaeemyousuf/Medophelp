import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Ban, CheckCircle2, ClipboardList, Plus, Send, ShoppingCart, Trash2, Undo2, XCircle } from 'lucide-react';
import { PURCHASE_REQUEST_STATUSES } from '@hms/shared';
import { api, type Paged } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { formatDate, formatDateTime, humanize, money, todayIso } from '@/lib/utils';
import { Button, Card, Input, PageHeader, Select, Textarea } from '@/components/ui/primitives';
import { DataTable, KeyValue, Pagination } from '@/components/ui/data';
import { StatusBadge } from '@/components/ui/badge';
import { Dialog, Drawer } from '@/components/ui/overlay';
import { Field, handleFormError } from '@/components/form/Field';
import type { StockItem, Supplier } from '@/types';

interface PrLine { _id?: string; itemId: string; sku?: string; itemName: string; unit?: string; quantity: number; stockAtRequest?: number; note?: string }
interface PurchaseRequest {
  _id: string;
  requestNo: string;
  status: string;
  requestedByName?: string;
  neededBy?: string;
  justification: string;
  items: PrLine[];
  decisionByName?: string;
  decisionNote?: string;
  poId?: string;
  poNo?: string;
  createdAt: string;
  history?: Array<{ status: string; at: string; byName?: string; note?: string }>;
}

/** Requisitions: pharmacy/stores ask for stock; purchasing approves and turns them into purchase orders. */
export function PurchaseRequestsPage() {
  const { can } = useAuth();
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const [creating, setCreating] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const { data, isFetching } = useQuery({ queryKey: ['purchase-requests', status, page], queryFn: () => api.get<Paged<PurchaseRequest>>('/purchasing/requests', { status, page, pageSize: 25 }), placeholderData: keepPreviousData });
  const canRequest = can('inventory.manage', 'pharmacy.dispense', 'purchasing.manage');
  return (
    <>
      <PageHeader title="Purchase requests" description="Ask purchasing for stock. Requests are approved by someone other than the requester and converted into purchase orders." actions={canRequest && <Button icon={<Plus className="h-4 w-4" />} onClick={() => setCreating(true)}>New request</Button>} />
      <Card>
        <div className="flex flex-wrap gap-2 border-b border-border p-3">
          <Select value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} className="w-44"><option value="">All statuses</option>{PURCHASE_REQUEST_STATUSES.map((s) => <option key={s} value={s}>{humanize(s)}</option>)}</Select>
        </div>
        <DataTable
          loading={isFetching}
          rows={data?.items}
          rowKey={(r) => r._id}
          onRowClick={(r) => setOpen(r._id)}
          empty={{ icon: <ClipboardList className="h-5 w-5" />, title: 'No purchase requests' }}
          columns={[
            { key: 'no', header: 'Request', cell: (r) => <div><p className="font-mono text-xs font-medium">{r.requestNo}</p><p className="text-[11px] text-muted">{formatDate(r.createdAt)} · {r.requestedByName}</p></div> },
            { key: 'it', header: 'Items', cell: (r) => <span className="line-clamp-2 text-xs">{r.items.map((i) => `${i.itemName} × ${i.quantity}`).join(', ')}</span> },
            { key: 'nb', header: 'Needed by', cell: (r) => <span className="text-xs">{r.neededBy ? formatDate(r.neededBy) : '—'}</span>, hideOnMobile: true },
            { key: 'po', header: 'PO', cell: (r) => <span className="font-mono text-xs">{r.poNo ?? '—'}</span>, hideOnMobile: true },
            { key: 'st', header: 'Status', cell: (r) => <StatusBadge status={r.status} /> },
          ]}
        />
        {data && <Pagination page={data.page} pageSize={data.pageSize} total={data.total} onPage={setPage} />}
      </Card>
      <RequestDrawer open={creating} onClose={() => setCreating(false)} />
      <RequestDetail id={open} onClose={() => setOpen(null)} />
    </>
  );
}

function RequestDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const [lines, setLines] = useState<PrLine[]>([]);
  const [search, setSearch] = useState('');
  const [justification, setJustification] = useState('');
  const [neededBy, setNeededBy] = useState('');
  useEffect(() => { if (open) { setLines([]); setJustification(''); setNeededBy(''); setSearch(''); } }, [open]);
  const { data: found } = useQuery({ queryKey: ['pr-items', search], queryFn: () => api.get<Paged<StockItem>>('/inventory/items', { search, pageSize: 8 }), enabled: open && search.trim().length >= 2 });
  const m = useMutation({
    mutationFn: async () => {
      const pr = await api.post<PurchaseRequest>('/purchasing/requests', { justification, neededBy: neededBy || undefined, items: lines.map((l) => ({ itemId: l.itemId, quantity: l.quantity, note: l.note || undefined })) });
      await api.post(`/purchasing/requests/${pr._id}/submit`);
      return pr;
    },
    onSuccess: (pr) => { toast.success(`${pr.requestNo} submitted for approval`); qc.invalidateQueries({ queryKey: ['purchase-requests'] }); onClose(); },
    onError: (e) => handleFormError(e),
  });
  return (
    <Drawer open={open} onClose={onClose} width="sm:max-w-2xl" title="New purchase request" footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button disabled={!lines.length || justification.trim().length < 3 || lines.some((l) => !(l.quantity > 0))} loading={m.isPending} icon={<Send className="h-4 w-4" />} onClick={() => m.mutate()}>Submit request</Button></>}>
      <div className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Needed by"><Input type="date" min={todayIso()} value={neededBy} onChange={(e) => setNeededBy(e.target.value)} /></Field>
          <Field label="Justification" required className="sm:col-span-2"><Textarea value={justification} onChange={(e) => setJustification(e.target.value)} placeholder="e.g. Below reorder level; flu season demand" /></Field>
        </div>
        <Field label="Add items"><Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search item name or SKU" /></Field>
        {!!found?.items.length && search.trim().length >= 2 && (
          <ul className="max-h-48 overflow-y-auto rounded-md border border-border">
            {found.items.filter((i) => !lines.some((l) => l.itemId === i._id)).map((i) => (
              <li key={i._id}><button type="button" className="flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-subtle" onClick={() => { setLines([...lines, { itemId: i._id, itemName: i.name, sku: i.sku, unit: i.unit, stockAtRequest: i.currentStock, quantity: Math.max(1, i.reorderLevel * 2 - i.currentStock) }]); setSearch(''); }}><span>{i.name} <span className="font-mono text-xs text-muted">{i.sku}</span></span><span className="text-xs text-muted">{i.currentStock} {i.unit} in stock · reorder at {i.reorderLevel}</span></button></li>
            ))}
          </ul>
        )}
        <div className="space-y-2">
          {lines.map((l, idx) => (
            <div key={l.itemId} className="grid grid-cols-[1fr_100px_1fr_auto] items-center gap-2 text-sm">
              <span><span className="font-medium">{l.itemName}</span><span className="block text-[11px] text-muted">{l.stockAtRequest} {l.unit} in stock</span></span>
              <Input type="number" min={1} value={l.quantity} onChange={(e) => setLines(lines.map((x, j) => (j === idx ? { ...x, quantity: Number(e.target.value) } : x)))} />
              <Input value={l.note ?? ''} placeholder="Note" onChange={(e) => setLines(lines.map((x, j) => (j === idx ? { ...x, note: e.target.value } : x)))} />
              <Button size="sm" variant="ghost" aria-label="Remove" onClick={() => setLines(lines.filter((_, j) => j !== idx))}><Trash2 className="h-4 w-4" /></Button>
            </div>
          ))}
          {!lines.length && <p className="text-xs text-muted">No items yet</p>}
        </div>
      </div>
    </Drawer>
  );
}

function RequestDetail({ id, onClose }: { id: string | null; onClose: () => void }) {
  const { can, user } = useAuth();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [deciding, setDeciding] = useState<'approve' | 'reject' | null>(null);
  const [note, setNote] = useState('');
  const [converting, setConverting] = useState(false);
  const { data: pr } = useQuery({ queryKey: ['purchase-request', id], queryFn: () => api.get<PurchaseRequest>(`/purchasing/requests/${id}`), enabled: !!id });
  const refresh = () => { qc.invalidateQueries({ queryKey: ['purchase-requests'] }); qc.invalidateQueries({ queryKey: ['purchase-request', id] }); };
  const act = useMutation({
    mutationFn: (op: string) => api.post(`/purchasing/requests/${id}/${op}`, { note: note || undefined }),
    onSuccess: (_d, op) => { toast.success({ approve: 'Request approved', reject: 'Request rejected', cancel: 'Request cancelled', reopen: 'Back to draft', submit: 'Submitted' }[op] ?? 'Done'); setDeciding(null); setNote(''); refresh(); },
    onError: (e) => handleFormError(e),
  });
  const requester = can('inventory.manage', 'pharmacy.dispense', 'purchasing.manage');
  return (
    <Drawer
      open={!!id}
      onClose={onClose}
      width="sm:max-w-2xl"
      title={pr ? `Purchase request ${pr.requestNo}` : 'Purchase request'}
      description={pr && <span className="flex items-center gap-2"><StatusBadge status={pr.status} /> {pr.requestedByName} · {formatDateTime(pr.createdAt)}</span>}
      footer={
        pr && (
          <div className="flex flex-wrap justify-end gap-2">
            {pr.status === 'Draft' && requester && <Button icon={<Send className="h-4 w-4" />} loading={act.isPending} onClick={() => act.mutate('submit')}>Submit</Button>}
            {pr.status === 'Submitted' && can('purchasing.approve') && (
              <>
                <Button variant="outline" icon={<XCircle className="h-4 w-4" />} disabled={pr.requestedByName === user?.fullName} onClick={() => setDeciding('reject')}>Reject</Button>
                <Button icon={<CheckCircle2 className="h-4 w-4" />} disabled={pr.requestedByName === user?.fullName} title={pr.requestedByName === user?.fullName ? 'Another person must approve your request' : undefined} onClick={() => setDeciding('approve')}>Approve</Button>
              </>
            )}
            {pr.status === 'Approved' && can('purchasing.manage') && <Button icon={<ShoppingCart className="h-4 w-4" />} onClick={() => setConverting(true)}>Create purchase order</Button>}
            {pr.status === 'Rejected' && requester && <Button variant="outline" icon={<Undo2 className="h-4 w-4" />} onClick={() => act.mutate('reopen')}>Revise</Button>}
            {['Draft', 'Submitted', 'Approved'].includes(pr.status) && requester && <Button variant="ghost" className="text-danger" icon={<Ban className="h-4 w-4" />} onClick={() => act.mutate('cancel')}>Cancel request</Button>}
            {pr.poId && <Button variant="outline" onClick={() => navigate(`/purchasing/orders/${pr.poId}`)}>Open {pr.poNo}</Button>}
          </div>
        )
      }
    >
      {pr && (
        <div className="space-y-4">
          <KeyValue items={[['Justification', pr.justification], ['Needed by', pr.neededBy ? formatDate(pr.neededBy) : '—'], ['Decision', pr.decisionByName ? `${pr.decisionByName}${pr.decisionNote ? ` — ${pr.decisionNote}` : ''}` : '—'], ['Purchase order', pr.poNo ?? '—']]} />
          <DataTable rows={pr.items} rowKey={(l) => l.itemId} columns={[{ key: 'i', header: 'Item', cell: (l) => <div><p className="font-medium">{l.itemName}</p><p className="font-mono text-[11px] text-muted">{l.sku}</p></div> }, { key: 'q', header: 'Quantity', align: 'right', cell: (l) => `${l.quantity} ${l.unit ?? ''}` }, { key: 's', header: 'Stock when requested', align: 'right', cell: (l) => l.stockAtRequest ?? '—' }, { key: 'n', header: 'Note', cell: (l) => <span className="text-xs">{l.note ?? ''}</span> }]} />
          {pr.history && <ol className="space-y-1 text-xs">{pr.history.map((h, i) => <li key={i}><b>{humanize(h.status)}</b> · {formatDateTime(h.at)} · {h.byName}{h.note && <span className="text-muted"> — {h.note}</span>}</li>)}</ol>}
        </div>
      )}
      <Dialog open={!!deciding} onClose={() => setDeciding(null)} title={deciding === 'approve' ? 'Approve request' : 'Reject request'} footer={<><Button variant="outline" onClick={() => setDeciding(null)}>Back</Button><Button variant={deciding === 'reject' ? 'danger' : 'primary'} disabled={deciding === 'reject' && note.trim().length < 3} loading={act.isPending} onClick={() => act.mutate(deciding!)}>{deciding === 'approve' ? 'Approve' : 'Reject'}</Button></>}>
        <Field label={deciding === 'reject' ? 'Reason' : 'Note (optional)'} required={deciding === 'reject'}><Textarea value={note} onChange={(e) => setNote(e.target.value)} /></Field>
      </Dialog>
      {pr && <ConvertDialog pr={pr} open={converting} onClose={() => setConverting(false)} onDone={(poId) => { refresh(); navigate(`/purchasing/orders/${poId}`); }} />}
    </Drawer>
  );
}

function ConvertDialog({ pr, open, onClose, onDone }: { pr: PurchaseRequest; open: boolean; onClose: () => void; onDone: (poId: string) => void }) {
  const { user } = useAuth();
  const [supplierId, setSupplierId] = useState('');
  const [expected, setExpected] = useState('');
  const { data: suppliers } = useQuery({ queryKey: ['suppliers'], queryFn: () => api.get<Supplier[]>('/purchasing/suppliers'), enabled: open });
  const m = useMutation({
    mutationFn: () => api.post<{ purchaseOrder: { _id: string; poNo: string; total: number } }>(`/purchasing/requests/${pr._id}/convert`, { supplierId, expectedDelivery: expected || undefined }),
    onSuccess: (r) => { toast.success(`Draft ${r.purchaseOrder.poNo} created (${money(r.purchaseOrder.total, user?.hospital.currency)}) — review prices and submit it for approval`); onClose(); onDone(r.purchaseOrder._id); },
    onError: (e) => handleFormError(e),
  });
  return (
    <Dialog open={open} onClose={onClose} title="Create purchase order" description="Lines are copied from the request at each item's purchase price; edit the draft PO before sending it for approval." footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button disabled={!supplierId} loading={m.isPending} onClick={() => m.mutate()}>Create draft PO</Button></>}>
      <div className="grid gap-3">
        <Field label="Supplier" required><Select value={supplierId} onChange={(e) => setSupplierId(e.target.value)}><option value="">Select…</option>{suppliers?.map((s) => <option key={s._id} value={s._id}>{s.name}</option>)}</Select></Field>
        <Field label="Expected delivery"><Input type="date" min={todayIso()} value={expected} onChange={(e) => setExpected(e.target.value)} /></Field>
      </div>
    </Dialog>
  );
}
