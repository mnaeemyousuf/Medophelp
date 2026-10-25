import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { AlertTriangle, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from './primitives';

function useEscape(open: boolean, onClose: () => void) {
  useEffect(() => {
    if (!open) return;
    const h = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', h);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', h);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);
}

/** Moves focus into the panel when it opens and back to the trigger when it closes. */
function useFocusTrap(open: boolean) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const prev = document.activeElement as HTMLElement | null;
    const first = ref.current?.querySelector<HTMLElement>('input,select,textarea,button:not([data-close])');
    (first ?? ref.current)?.focus();
    return () => prev?.focus();
  }, [open]);
  return ref;
}

interface PanelProps {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  width?: string;
}

export function Dialog({ open, onClose, title, description, children, footer, width = 'max-w-lg' }: PanelProps) {
  useEscape(open, onClose);
  const ref = useFocusTrap(open);
  if (!open) return null;
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center p-0 sm:items-center sm:p-4">
      <div className="absolute inset-0 bg-slate-950/50 backdrop-blur-[1px]" onClick={onClose} />
      <div ref={ref} tabIndex={-1} role="dialog" aria-modal="true" className={cn('relative flex max-h-[92vh] w-full flex-col rounded-t-xl border border-border bg-surface shadow-2xl outline-none sm:rounded-xl', width)}>
        <PanelHeader title={title} description={description} onClose={onClose} />
        <div className="flex-1 overflow-y-auto px-5 py-4">{children}</div>
        {footer && <div className="flex justify-end gap-2 border-t border-border px-5 py-3">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}

export function Drawer({ open, onClose, title, description, children, footer, width = 'sm:max-w-xl' }: PanelProps) {
  useEscape(open, onClose);
  const ref = useFocusTrap(open);
  if (!open) return null;
  return createPortal(
    <div className="fixed inset-0 z-50">
      <div className="absolute inset-0 bg-slate-950/50" onClick={onClose} />
      <div ref={ref} tabIndex={-1} role="dialog" aria-modal="true" className={cn('absolute inset-y-0 right-0 flex w-full flex-col border-l border-border bg-surface shadow-2xl outline-none', width)}>
        <PanelHeader title={title} description={description} onClose={onClose} />
        <div className="flex-1 overflow-y-auto px-5 py-4">{children}</div>
        {footer && <div className="flex justify-end gap-2 border-t border-border px-5 py-3">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}

function PanelHeader({ title, description, onClose }: { title: ReactNode; description?: ReactNode; onClose: () => void }) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-border px-5 py-4">
      <div>
        <h2 className="text-base font-semibold text-fg">{title}</h2>
        {description && <p className="mt-0.5 text-xs text-muted">{description}</p>}
      </div>
      <button data-close onClick={onClose} className="focus-ring rounded-md p-1 text-muted hover:bg-subtle hover:text-fg" aria-label="Close">
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}

/** Confirmation for irreversible or significant actions. */
export function ConfirmDialog({
  open,
  onClose,
  onConfirm,
  title,
  message,
  confirmLabel = 'Confirm',
  danger,
  loading,
  children,
}: {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  message: ReactNode;
  confirmLabel?: string;
  danger?: boolean;
  loading?: boolean;
  children?: ReactNode;
}) {
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={title}
      width="max-w-md"
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Go back
          </Button>
          <Button variant={danger ? 'danger' : 'primary'} onClick={onConfirm} loading={loading}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      <div className="flex gap-3">
        {danger && <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-danger" />}
        <div className="text-sm text-fg">{message}</div>
      </div>
      {children && <div className="mt-4">{children}</div>}
    </Dialog>
  );
}

export function useDisclosure(initial = false) {
  const [open, setOpen] = useState(initial);
  return { open, onOpen: () => setOpen(true), onClose: () => setOpen(false), setOpen };
}
