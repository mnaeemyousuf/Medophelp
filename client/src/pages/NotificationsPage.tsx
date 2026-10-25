import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Bell, CheckCheck, Mail, MessageSquare, Smartphone } from 'lucide-react';
import { NOTIFICATION_TYPES } from '@hms/shared';
import { api, type Paged } from '@/lib/api';
import { cn, formatDateTime, humanize } from '@/lib/utils';
import { Button, Card, PageHeader, Select } from '@/components/ui/primitives';
import { DataTable, Pagination } from '@/components/ui/data';
import { Badge } from '@/components/ui/badge';

interface Row {
  _id: string;
  type: string;
  title: string;
  message: string;
  link?: string;
  priority: string;
  readAt?: string;
  createdAt: string;
  deliveries?: Array<{ channel: string; status: string }>;
}

const CHANNEL_ICON: Record<string, typeof Mail> = { Email: Mail, Sms: MessageSquare, Push: Smartphone };
/** "Logged" = no provider configured (demo mode): recorded but not actually sent. */
const DELIVERY_LABEL: Record<string, string> = { Sent: 'sent', Logged: 'demo – not sent', Skipped: 'channel off', OptedOut: 'patient opted out', Failed: 'failed' };

/** Full notification history with delivery status per external channel. */
export function NotificationsPage() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [type, setType] = useState('');
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [page, setPage] = useState(1);
  const { data, isFetching } = useQuery({
    queryKey: ['notifications', 'history', type, unreadOnly, page],
    queryFn: () => api.get<Paged<Row> & { unread: number }>('/notifications', { type, unreadOnly: unreadOnly || undefined, page, pageSize: 25 }),
    placeholderData: keepPreviousData,
  });
  const refresh = () => qc.invalidateQueries({ queryKey: ['notifications'] });
  const markAll = useMutation({ mutationFn: () => api.post('/notifications/read-all'), onSuccess: refresh });
  const markOne = useMutation({ mutationFn: (id: string) => api.post(`/notifications/${id}/read`), onSuccess: refresh });
  return (
    <>
      <PageHeader title="Notifications" description={data ? `${data.unread} unread` : ' '} actions={!!data?.unread && <Button variant="outline" icon={<CheckCheck className="h-4 w-4" />} loading={markAll.isPending} onClick={() => markAll.mutate()}>Mark all read</Button>} />
      <Card>
        <div className="flex flex-wrap items-center gap-2 border-b border-border p-3">
          <Select value={type} onChange={(e) => { setType(e.target.value); setPage(1); }} className="w-56">
            <option value="">All types</option>
            {NOTIFICATION_TYPES.map((t) => <option key={t} value={t}>{humanize(t)}</option>)}
          </Select>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={unreadOnly} onChange={(e) => { setUnreadOnly(e.target.checked); setPage(1); }} /> Unread only</label>
        </div>
        <DataTable
          loading={isFetching}
          rows={data?.items}
          rowKey={(n) => n._id}
          onRowClick={(n) => {
            if (!n.readAt) markOne.mutate(n._id);
            if (n.link) navigate(n.link);
          }}
          rowClassName={(n) => (n.readAt ? undefined : 'bg-brand/[0.04]')}
          empty={{ icon: <Bell className="h-5 w-5" />, title: 'No notifications' }}
          columns={[
            { key: 'd', header: '', cell: (n) => <span className={cn('block h-2 w-2 rounded-full', n.readAt ? 'bg-transparent' : n.priority === 'Normal' ? 'bg-brand' : 'bg-danger')} /> },
            { key: 'm', header: 'Notification', cell: (n) => <div><p className="font-medium">{n.title} {n.priority !== 'Normal' && <Badge tone="danger">{n.priority}</Badge>}</p><p className="text-xs text-muted">{n.message}</p></div> },
            { key: 't', header: 'Type', cell: (n) => <span className="text-xs">{humanize(n.type)}</span>, hideOnMobile: true },
            {
              key: 'c',
              header: 'Also sent by',
              hideOnMobile: true,
              cell: (n) => (
                <span className="flex gap-1.5">
                  {(n.deliveries ?? []).map((d) => {
                    const Icon = CHANNEL_ICON[d.channel] ?? Bell;
                    return <span key={d.channel} title={`${d.channel}: ${d.status}`} className={cn('flex items-center gap-0.5 text-[11px]', d.status === 'Sent' ? 'text-ok' : d.status === 'Failed' ? 'text-danger' : 'text-muted')}><Icon className="h-3.5 w-3.5" />{DELIVERY_LABEL[d.status] ?? d.status.toLowerCase()}</span>;
                  })}
                  {!n.deliveries?.length && <span className="text-[11px] text-muted">in-app only</span>}
                </span>
              ),
            },
            { key: 'at', header: 'When', cell: (n) => <span className="whitespace-nowrap text-xs text-muted">{formatDateTime(n.createdAt)}</span> },
          ]}
        />
        {data && <Pagination page={data.page} pageSize={data.pageSize} total={data.total} onPage={setPage} />}
      </Card>
    </>
  );
}
