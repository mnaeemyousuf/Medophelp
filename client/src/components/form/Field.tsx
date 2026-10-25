import { cloneElement, isValidElement, useId, type ReactElement, type ReactNode } from 'react';
import type { FieldError, FieldValues, Path, UseFormSetError } from 'react-hook-form';
import { toast } from 'sonner';
import { ApiError } from '@/lib/api';
import { cn } from '@/lib/utils';
import { Label } from '../ui/primitives';

/** Label + control + error/hint, wiring ids and aria attributes. */
export function Field({ label, error, hint, required, className, children }: { label: string; error?: FieldError | string; hint?: ReactNode; required?: boolean; className?: string; children: ReactElement }) {
  const id = useId();
  const message = typeof error === 'string' ? error : error?.message;
  const control = isValidElement(children)
    ? cloneElement(children as ReactElement<Record<string, unknown>>, { id, 'aria-invalid': !!message || undefined, 'aria-describedby': message ? `${id}-err` : undefined })
    : children;
  return (
    <div className={cn('min-w-0', className)}>
      <Label htmlFor={id}>
        {label}
        {required && <span className="ml-0.5 text-danger">*</span>}
      </Label>
      {control}
      {message ? (
        <p id={`${id}-err`} className="mt-1 text-xs text-danger">
          {message}
        </p>
      ) : hint ? (
        <p className="mt-1 text-xs text-muted">{hint}</p>
      ) : null}
    </div>
  );
}

/**
 * Applies server-side validation errors to the form fields, and toasts anything else.
 * Keeps forms honest when the API rejects something the client schema allowed.
 */
export function handleFormError<T extends FieldValues>(err: unknown, setError?: UseFormSetError<T>) {
  if (err instanceof ApiError) {
    const fields = Object.entries(err.fieldErrors).filter(([k]) => k !== '_form');
    if (setError && fields.length) {
      for (const [k, msgs] of fields) setError(k as Path<T>, { message: msgs[0] });
      toast.error('Please correct the highlighted fields');
      return;
    }
    toast.error(err.message);
    return;
  }
  toast.error('Something went wrong. Please try again.');
}

export function FormSection({ title, description, children }: { title: string; description?: string; children: ReactNode }) {
  return (
    <section className="border-b border-border py-5 first:pt-0 last:border-0">
      <h3 className="text-sm font-semibold text-fg">{title}</h3>
      {description && <p className="mt-0.5 text-xs text-muted">{description}</p>}
      <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">{children}</div>
    </section>
  );
}
