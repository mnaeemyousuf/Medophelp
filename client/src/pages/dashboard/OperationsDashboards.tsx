import { Link, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { AlertTriangle, Beaker, Boxes, CalendarX, ClipboardCheck, Inbox, PackageCheck, Pill, ShieldCheck, ShoppingCart, Syringe, Truck } from 'lucide-react';
import { api, type Paged } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { formatDate, formatDateTime, money } from '@/lib/utils';
import { Button, Card, CardHeader, EmptyState, PageHeader } from '@/components/ui/primitives';
import { StatCard } from '@/components/ui/data';
import { Badge, PriorityBadge, StatusBadge } from '@/components/ui/badge';
import type { LabOrder, PurchaseOrder, StockBatch, StockItem } from '@/types';
import { BRAND } from '@hms/shared';

const tooltipStyle = { background: 'rgb(var(--surface))', border: '1px solid rgb(var(--border))', borderRadius: 8, fontSize: 12, color: 'rgb(var(--fg))' };

interface LabStats {
  pending: number;
  toReceive: number;
  toCollect: number;
  toProcess: number;
  inProgress: number;
  toVerify: number;
  turnaround: Array<{ test: string; avgHours: number; count: number }>;
}

export function LabDashboard() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { data: s } = useQuery({ queryKey: ['lab-stats'], queryFn: () => api.get<LabStats>('/laboratory/stats'), refetchInterval: 30_000 });
  const { data: urgent } = useQuery({
    queryKey: ['lab-orders', 'urgent-dash'],
    queryFn: () => api.get<Paged<LabOrder>>('/laboratory/orders', { statuses: 'Ordered,SamplePending,SampleCollected,InProgress,Completed', pageSize: 50 }),
    refetchInterval: 30_000,
  });
  const queue = (urgent?.items ?? []).filter((o) => o.priority !== 'Routine' || o.status === 'Completed').slice(0, 8);
  return (
    <>
      <PageHeader title={`Laboratory — ${user?.fullName.split(' ')[0]}`} description="Pending work and turnaround" actions={<Button icon={<Beaker className="h-4 w-4" />} onClick={() => navigate('/laboratory')}>Open worklist</Button>} />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <StatCard label="Total pending" value={s?.pending ?? '…'} icon={<Beaker className="h-4 w-4" />} />
        <StatCard label="To receive" value={s?.toReceive ?? '…'} icon={<Inbox className="h-4 w-4" />} tone="info" />
        <StatCard label="Samples to collect" value={s?.toCollect ?? '…'} icon={<Syringe className="h-4 w-4" />} tone="warn" />
        <StatCard label="Processing" value={s ? s.toProcess + s.inProgress : '…'} icon={<ClipboardCheck className="h-4 w-4" />} tone="violet" />
        <StatCard label="Awaiting verification" value={s?.toVerify ?? '…'} icon={<ShieldCheck className="h-4 w-4" />} tone="danger" />
      </div>
      <div className="mt-4 grid gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader title="Needs attention" description="Urgent/STAT requests and results awaiting verification" />
          {queue.length ? (
            <ul className="divide-y divide-border">
              {queue.map((o) => (
                <li key={o._id} className="flex items-center gap-3 px-4 py-2.5 text-sm">
                  <Link to={`/laboratory/orders/${o._id}`} className="font-mono text-xs font-medium text-brand hover:underline">{o.orderNo}</Link>
                  <span className="min-w-0 flex-1 truncate">{o.patient?.name} · {o.items.map((i) => i.testName).join(', ')}</span>
                  <PriorityBadge priority={o.priority} />
                  <StatusBadge status={o.status} />
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState title="Nothing urgent" />
          )}
        </Card>
        <Card>
          <CardHeader title="Turnaround time" description="Average hours from order to verification, last 30 days" />
          <div className="p-3">
            {s?.turnaround.length ? (
              <ResponsiveContainer width="100%" height={240}>
                <BarChart data={s.turnaround} layout="vertical" margin={{ left: 10, right: 16 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgb(var(--border))" horizontal={false} />
                  <XAxis type="number" tick={{ fontSize: 11, fill: 'rgb(var(--muted))' }} unit=" h" />
                  <YAxis type="category" dataKey="test" width={140} tick={{ fontSize: 11, fill: 'rgb(var(--muted))' }} />
                  <Tooltip contentStyle={tooltipStyle} formatter={(v: number) => `${v} h`} cursor={{ fill: 'rgb(var(--subtle))' }} />
                  <Bar dataKey="avgHours" name="Avg hours" fill={BRAND.colors.blue} radius={[0, 3, 3, 0]} />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <EmptyState title="No verified results in the last 30 days" />
            )}
          </div>
        </Card>
      </div>
    </>
  );
}

interface Alerts {
  lowStock: StockItem[];
  expiring: StockBatch[];
}

export function PharmacyDashboard() {
  const navigate = useNavigate();
  const { data: q } = useQuery({ queryKey: ['pharmacy-queue', 'dash'], queryFn: () => api.get<Paged<{ _id: string; prescriptionNo: string; prescribedAt: string; patient: { name: string; mrn: string }; stockReady: boolean; doctorName?: string }>>('/pharmacy/queue', { pageSize: 8 }), refetchInterval: 20_000 });
  const { data: a } = useQuery({ queryKey: ['stock-alerts'], queryFn: () => api.get<Alerts>('/inventory/alerts', { days: 90 }) });
  const expired = a?.expiring.filter((b) => b.isExpired).length ?? 0;
  return (
    <>
      <PageHeader title="Pharmacy" description="Prescription queue, stock and expiry" actions={<Button icon={<Pill className="h-4 w-4" />} onClick={() => navigate('/pharmacy')}>Open queue</Button>} />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard label="Prescriptions waiting" value={q?.total ?? '…'} icon={<Pill className="h-4 w-4" />} onClick={() => navigate('/pharmacy')} />
        <StatCard label="Need stock check" value={q ? q.items.filter((r) => !r.stockReady).length : '…'} icon={<PackageCheck className="h-4 w-4" />} tone="warn" />
        <StatCard label="Low-stock items" value={a?.lowStock.length ?? '…'} icon={<AlertTriangle className="h-4 w-4" />} tone="danger" onClick={() => navigate('/inventory?tab=alerts')} />
        <StatCard label="Expired / expiring ≤ 90 d" value={a ? `${expired} / ${a.expiring.length - expired}` : '…'} icon={<CalendarX className="h-4 w-4" />} tone="violet" onClick={() => navigate('/inventory?tab=alerts')} />
      </div>
      <div className="mt-4 grid gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader title="Oldest prescriptions" />
          {q?.items.length ? (
            <ul className="divide-y divide-border">
              {q.items.map((r) => (
                <li key={r._id} className="flex items-center gap-3 px-4 py-2.5 text-sm">
                  <span className="font-mono text-xs">{r.prescriptionNo}</span>
                  <span className="min-w-0 flex-1 truncate">{r.patient.name} <span className="text-xs text-muted">· {formatDateTime(r.prescribedAt)}</span></span>
                  {r.stockReady ? <Badge tone="ok">Ready</Badge> : <Badge tone="warn">Check stock</Badge>}
                  <Button size="sm" onClick={() => navigate(`/pharmacy/dispense/${r._id}`)}>Dispense</Button>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState title="Queue is clear" />
          )}
        </Card>
        <ExpiryCard alerts={a} />
      </div>
    </>
  );
}

function ExpiryCard({ alerts }: { alerts?: Alerts }) {
  const navigate = useNavigate();
  return (
    <Card>
      <CardHeader title="Expiry watch" description="Batches expired or expiring within 90 days" />
      {alerts?.expiring.length ? (
        <ul className="divide-y divide-border">
          {alerts.expiring.slice(0, 8).map((b) => (
            <li key={b._id} className="flex cursor-pointer items-center gap-3 px-4 py-2.5 text-sm hover:bg-subtle/60" onClick={() => navigate(`/inventory/items/${typeof b.itemId === 'object' ? b.itemId._id : b.itemId}`)}>
              <span className="min-w-0 flex-1 truncate">{typeof b.itemId === 'object' ? b.itemId.name : ''} <span className="font-mono text-xs text-muted">{b.batchNo}</span></span>
              <span className="text-xs text-muted">{b.quantity} · {b.location}</span>
              {b.isExpired ? <Badge tone="danger">Expired</Badge> : <Badge tone={b.daysLeft! <= 30 ? 'danger' : 'warn'}>{b.daysLeft} d</Badge>}
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState title="Nothing expiring soon" />
      )}
    </Card>
  );
}

export function StoresDashboard() {
  const { user, can } = useAuth();
  const navigate = useNavigate();
  const { data: a } = useQuery({ queryKey: ['stock-alerts'], queryFn: () => api.get<Alerts>('/inventory/alerts', { days: 90 }) });
  const { data: pending } = useQuery({ queryKey: ['pos', 'PendingApproval'], queryFn: () => api.get<Paged<PurchaseOrder>>('/purchasing/orders', { status: 'PendingApproval', pageSize: 10 }), enabled: can('purchasing.manage', 'purchasing.approve') });
  const { data: inbound } = useQuery({ queryKey: ['pos', 'Ordered'], queryFn: () => api.get<Paged<PurchaseOrder>>('/purchasing/orders', { status: 'Ordered', pageSize: 10 }), enabled: can('purchasing.manage', 'purchasing.approve') });
  return (
    <>
      <PageHeader title="Stores & purchasing" description="Reorders, expiry and inbound deliveries" actions={can('purchasing.manage') && <Button icon={<ShoppingCart className="h-4 w-4" />} onClick={() => navigate('/purchasing')}>Purchase orders</Button>} />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard label="Below reorder level" value={a?.lowStock.length ?? '…'} icon={<AlertTriangle className="h-4 w-4" />} tone="warn" onClick={() => navigate('/inventory?tab=alerts')} />
        <StatCard label="Expiring / expired batches" value={a?.expiring.length ?? '…'} icon={<CalendarX className="h-4 w-4" />} tone="danger" onClick={() => navigate('/inventory?tab=alerts')} />
        <StatCard label="POs awaiting approval" value={pending?.total ?? '—'} icon={<ShieldCheck className="h-4 w-4" />} tone="violet" onClick={() => navigate('/purchasing')} />
        <StatCard label="Deliveries expected" value={inbound?.total ?? '—'} icon={<Truck className="h-4 w-4" />} tone="info" onClick={() => navigate('/purchasing')} />
      </div>
      <div className="mt-4 grid gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader title="Reorder list" actions={<Link to="/inventory?tab=alerts" className="text-xs text-brand hover:underline">All alerts</Link>} />
          {a?.lowStock.length ? (
            <ul className="divide-y divide-border">
              {a.lowStock.slice(0, 8).map((i) => (
                <li key={i._id} className="flex cursor-pointer items-center gap-3 px-4 py-2.5 text-sm hover:bg-subtle/60" onClick={() => navigate(`/inventory/items/${i._id}`)}>
                  <Boxes className="h-4 w-4 text-muted" />
                  <span className="min-w-0 flex-1 truncate">{i.name}</span>
                  <span className="num text-xs"><b className="text-warn">{i.currentStock}</b> / {i.reorderLevel}</span>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState title="Stock levels are healthy" />
          )}
        </Card>
        <Card>
          <CardHeader title="Inbound purchase orders" />
          {inbound?.items.length ? (
            <ul className="divide-y divide-border">
              {inbound.items.map((p) => (
                <li key={p._id} className="flex cursor-pointer items-center gap-3 px-4 py-2.5 text-sm hover:bg-subtle/60" onClick={() => navigate(`/purchasing/orders/${p._id}`)}>
                  <span className="font-mono text-xs">{p.poNo}</span>
                  <span className="min-w-0 flex-1 truncate">{p.supplierName}</span>
                  <span className="text-xs text-muted">due {formatDate(p.expectedDelivery)}</span>
                  <span className="num text-xs">{money(p.total, user?.hospital.currency)}</span>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState title="No deliveries expected" />
          )}
        </Card>
      </div>
    </>
  );
}

/** Doctor's lab data: results ready to review, orders still in the lab, and a ready-made panel. */
export function useDoctorLabs() {
  const navigate = useNavigate();
  const { data } = useQuery({ queryKey: ['lab-orders', 'mine'], queryFn: () => api.get<Paged<LabOrder>>('/laboratory/orders', { mine: true, pageSize: 100 }), refetchInterval: 60_000 });
  const toReview = (data?.items ?? []).filter((o) => o.status === 'Verified' && !o.reviewedAt);
  const pending = (data?.items ?? []).filter((o) => !['Verified', 'Cancelled'].includes(o.status));
  return { toReview, pending, panel: (
    <Card className="mt-4">
      <CardHeader title="Lab results to review" description={`${pending.length} order(s) still in the lab`} />
      {toReview.length ? (
        <ul className="divide-y divide-border">
          {toReview.slice(0, 10).map((o) => (
            <li key={o._id} className="flex cursor-pointer items-center gap-3 px-4 py-2.5 text-sm hover:bg-subtle/60" onClick={() => navigate(`/laboratory/orders/${o._id}`)}>
              <span className="font-mono text-xs">{o.orderNo}</span>
              <span className="min-w-0 flex-1 truncate">{o.patient?.name} · {o.items.map((i) => i.testName).join(', ')}</span>
              {o.hasCritical ? <Badge tone="danger">Critical</Badge> : o.hasAbnormal ? <Badge tone="warn">Abnormal</Badge> : <Badge tone="ok">Normal</Badge>}
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState title="All results reviewed" />
      )}
    </Card>
  ) };
}
