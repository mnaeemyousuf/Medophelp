import { useQuery } from '@tanstack/react-query';
import { BedDouble } from 'lucide-react';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { cn, money } from '@/lib/utils';
import { Spinner } from './ui/primitives';
import type { BedBoard } from '@/types';

/** Pick an available bed, grouped by ward with the daily rate. Used for admit, transfer and ER admission. */
export function BedPicker({ value, onChange, exclude }: { value?: string; onChange: (bedId: string, label: string) => void; exclude?: string }) {
  const { user } = useAuth();
  const { data, isLoading } = useQuery({ queryKey: ['bed-board'], queryFn: () => api.get<BedBoard>('/ipd/beds/board'), refetchInterval: 15_000 });
  if (isLoading || !data) return <div className="flex justify-center py-4"><Spinner /></div>;
  const wards = data.wards.map((w) => ({ ...w, free: w.rooms.flatMap((r) => r.beds.filter((b) => b.status === 'Available' && b._id !== exclude).map((b) => ({ ...b, roomNo: r.roomNo }))) })).filter((w) => w.free.length);
  if (!wards.length) return <p className="rounded-md border border-dashed border-danger/40 px-3 py-4 text-center text-sm text-danger">No beds available. Free a bed on the bed board first.</p>;
  return (
    <div className="max-h-72 space-y-3 overflow-y-auto pr-1">
      {wards.map((w) => (
        <div key={w._id}>
          <p className="mb-1 flex items-center justify-between text-xs font-semibold text-muted">
            <span>{w.name} <span className="font-normal">· {w.type}{w.floor ? ` · ${w.floor} floor` : ''}</span></span>
            <span className="font-normal">{w.free.length} free</span>
          </p>
          <div className="grid grid-cols-3 gap-1.5 sm:grid-cols-5">
            {w.free.map((b) => (
              <button
                key={b._id}
                type="button"
                onClick={() => onChange(b._id, `${w.name} · room ${b.roomNo} · bed ${b.bedNo}`)}
                className={cn('flex flex-col items-center rounded-md border px-1 py-1.5 text-xs transition-colors', value === b._id ? 'border-brand bg-brand text-brand-fg' : 'border-border hover:border-brand/60 hover:bg-brand/5')}
              >
                <BedDouble className="h-3.5 w-3.5" />
                <span className="font-medium">{b.roomNo}/{b.bedNo}</span>
                <span className={cn('text-[10px]', value === b._id ? 'text-brand-fg/80' : 'text-muted')}>{money(b.ratePerDay, user?.hospital.currency)}</span>
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
