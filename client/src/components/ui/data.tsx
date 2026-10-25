import type { ReactNode } from 'react';
import { ArrowDown, ArrowUp, ArrowUpDown, ChevronLeft, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button, EmptyState, Spinner } from './primitives';

export interface Column<T> {
  key: string;
  header: ReactNode;
  cell: (row: T) => ReactNode;
  className?: string;
  /** Hide on small screens to keep tables readable on phones. */
  hideOnMobile?: boolean;
  align?: 'left' | 'right';
  /** Server sort key (`?sort=key` / `-key`); makes the header clickable when the table has onSort. */
  sortKey?: string;
}

export function DataTable<T>({
  columns,
  rows,
  rowKey,
  loading,
  empty,
  onRowClick,
  rowClassName,
  sort,
  onSort,
}: {
  columns: Column<T>[];
  rows: T[] | undefined;
  rowKey: (row: T) => string;
  loading?: boolean;
  empty?: { title: string; description?: string; icon?: ReactNode; action?: ReactNode };
  onRowClick?: (row: T) => void;
  rowClassName?: (row: T) => string | undefined;
  /** Current sort (`key` or `-key`) and change handler for server-side sorting. */
  sort?: string;
  onSort?: (sort: string) => void;
}) {
  if (loading && !rows)
    return (
      <div className="flex h-40 items-center justify-center">
        <Spinner />
      </div>
    );
  if (!rows?.length) return <EmptyState title={empty?.title ?? 'Nothing here yet'} description={empty?.description} icon={empty?.icon} action={empty?.action} />;
  return (
    <div className="relative overflow-x-auto">
      {loading && <div className="absolute inset-x-0 top-0 h-0.5 animate-pulse bg-brand/60" />}
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border bg-subtle/60 text-left">
            {columns.map((c) => (
              <th key={c.key} className={cn('whitespace-nowrap px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-muted', c.hideOnMobile && 'hidden md:table-cell', c.align === 'right' && 'text-right', c.className)}>
                {c.sortKey && onSort ? (
                  <button type="button" className={cn('inline-flex items-center gap-1 uppercase hover:text-fg', c.align === 'right' && 'flex-row-reverse')} onClick={() => onSort(sort === c.sortKey ? `-${c.sortKey}` : c.sortKey!)} aria-label={`Sort by ${typeof c.header === 'string' ? c.header : c.sortKey}`}>
                    {c.header}
                    {sort === c.sortKey ? <ArrowUp className="h-3 w-3" /> : sort === `-${c.sortKey}` ? <ArrowDown className="h-3 w-3" /> : <ArrowUpDown className="h-3 w-3 opacity-40" />}
                  </button>
                ) : (
                  c.header
                )}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr
              key={rowKey(r)}
              onClick={onRowClick ? () => onRowClick(r) : undefined}
              className={cn('border-b border-border/70 last:border-0', onRowClick && 'cursor-pointer hover:bg-subtle/60', rowClassName?.(r))}
            >
              {columns.map((c) => (
                <td key={c.key} className={cn('px-4 py-2.5 align-middle', c.hideOnMobile && 'hidden md:table-cell', c.align === 'right' && 'num text-right', c.className)}>
                  {c.cell(r)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function Pagination({ page, pageSize, total, onPage }: { page: number; pageSize: number; total: number; onPage: (p: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (total === 0) return null;
  const from = (page - 1) * pageSize + 1;
  const to = Math.min(total, page * pageSize);
  return (
    <div className="flex items-center justify-between border-t border-border px-4 py-2.5 text-xs text-muted">
      <span className="num">
        {from}–{to} of {total}
      </span>
      <div className="flex items-center gap-1">
        <Button variant="ghost" size="sm" disabled={page <= 1} onClick={() => onPage(page - 1)} aria-label="Previous page">
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <span className="num px-2">
          {page} / {pages}
        </span>
        <Button variant="ghost" size="sm" disabled={page >= pages} onClick={() => onPage(page + 1)} aria-label="Next page">
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}

export function Tabs<K extends string>({ tabs, value, onChange, className }: { tabs: Array<{ key: K; label: ReactNode; count?: number }>; value: K; onChange: (k: K) => void; className?: string }) {
  return (
    <div className={cn('flex gap-1 overflow-x-auto border-b border-border', className)} role="tablist">
      {tabs.map((t) => (
        <button
          key={t.key}
          role="tab"
          aria-selected={value === t.key}
          onClick={() => onChange(t.key)}
          className={cn(
            'focus-ring -mb-px inline-flex items-center gap-1.5 whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium transition-colors',
            value === t.key ? 'border-brand text-fg' : 'border-transparent text-muted hover:text-fg',
          )}
        >
          {t.label}
          {t.count !== undefined && <span className="num rounded-full bg-subtle px-1.5 text-[10px] text-muted">{t.count}</span>}
        </button>
      ))}
    </div>
  );
}

export function KeyValue({ items, cols = 2 }: { items: Array<[string, ReactNode]>; cols?: 1 | 2 | 3 }) {
  return (
    <dl className={cn('grid gap-x-6 gap-y-3', cols === 1 ? 'grid-cols-1' : cols === 2 ? 'grid-cols-1 sm:grid-cols-2' : 'grid-cols-1 sm:grid-cols-3')}>
      {items.map(([k, v]) => (
        <div key={k} className="min-w-0">
          <dt className="text-[11px] font-medium uppercase tracking-wide text-muted">{k}</dt>
          <dd className="mt-0.5 truncate text-sm text-fg">{v || '—'}</dd>
        </div>
      ))}
    </dl>
  );
}

export function StatCard({ label, value, hint, icon, tone = 'brand', onClick, unavailable }: { label: string; value: ReactNode; hint?: ReactNode; icon?: ReactNode; tone?: 'brand' | 'info' | 'warn' | 'danger' | 'ok' | 'violet'; onClick?: () => void; unavailable?: boolean }) {
  const toneCls = { brand: 'text-brand bg-brand/10', info: 'text-info bg-info/10', warn: 'text-warn bg-warn/10', danger: 'text-danger bg-danger/10', ok: 'text-ok bg-ok/10', violet: 'text-violet-500 bg-violet-500/10' }[tone];
  return (
    <div onClick={onClick} className={cn('rounded-lg border border-border bg-surface p-4 shadow-card', onClick && 'cursor-pointer transition-colors hover:border-brand/40')}>
      <div className="flex items-start justify-between gap-2">
        <p className="text-xs font-medium text-muted">{label}</p>
        {icon && <span className={cn('rounded-md p-1.5', toneCls)}>{icon}</span>}
      </div>
      <p className={cn('num mt-2 text-2xl font-semibold tracking-tight', unavailable ? 'text-muted/60' : 'text-fg')}>{unavailable ? '—' : value}</p>
      <p className="mt-1 text-[11px] text-muted">{unavailable ? 'Module goes live in a later phase' : hint}</p>
    </div>
  );
}
