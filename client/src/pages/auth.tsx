import { useEffect, useState, type ReactNode } from 'react';
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Eye, EyeOff, Lock, Mail, ShieldCheck } from 'lucide-react';
import { BRAND, changePasswordSchema, forgotPasswordSchema, loginSchema, resetPasswordSchema } from '@hms/shared';
import type { z } from 'zod';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { Button, Card, Input } from '@/components/ui/primitives';
import { Field, handleFormError } from '@/components/form/Field';
import { BrandLogo } from '@/components/brand/Logo';

function AuthShell({ title, subtitle, children }: { title: string; subtitle?: string; children: ReactNode }) {
  useEffect(() => {
    document.title = `${title} · ${BRAND.name}`;
  }, [title]);
  return (
    <div className="grid min-h-full lg:grid-cols-[1.1fr_1fr]">
      <div className="relative hidden overflow-hidden bg-sidebar lg:block">
        <div className="absolute inset-0 bg-[linear-gradient(135deg,rgb(var(--sidebar))_0%,#13306b_55%,rgb(26_86_219)_100%)]" />
        <div className="absolute -right-24 -top-24 h-96 w-96 rounded-full bg-accent/20 blur-3xl" />
        <div className="absolute -bottom-32 left-10 h-96 w-96 rounded-full bg-white/10 blur-3xl" />
        <div className="relative flex h-full flex-col justify-between p-12 text-white">
          <BrandLogo tone="light" size="lg" markClassName="h-11 w-11" />
          <div className="max-w-md">
            <h2 className="text-4xl font-extrabold leading-tight">{BRAND.tagline}</h2>
            <p className="mt-5 text-white/85">One record for every patient, from reception to discharge — registration, nursing, consultations, prescriptions and billing, connected, audited and secured by role.</p>
          </div>
          <div className="flex items-center gap-2 text-xs text-white/75">
            <ShieldCheck className="h-4 w-4" /> Access is monitored. Every sensitive action is logged.
          </div>
        </div>
      </div>
      <div className="flex items-center justify-center p-6">
        <div className="w-full max-w-sm">
          <BrandLogo tagline size="lg" className="mb-8 lg:hidden" markClassName="h-10 w-10" />
          <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
          {subtitle && <p className="mt-1.5 text-sm text-muted">{subtitle}</p>}
          <div className="mt-6">{children}</div>
        </div>
      </div>
    </div>
  );
}

export function LoginPage() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [show, setShow] = useState(false);
  const [error, setError] = useState<string | null>(params.get('expired') ? 'Your session expired. Please sign in again.' : null);
  const form = useForm<z.input<typeof loginSchema>>({ resolver: zodResolver(loginSchema), defaultValues: { email: '', password: '', rememberMe: false } });

  if (user) return <Navigate to="/dashboard" replace />;

  const onSubmit = form.handleSubmit(async (values) => {
    setError(null);
    try {
      await api.post('/auth/login', values);
      await qc.invalidateQueries({ queryKey: ['me'] });
      const next = params.get('next');
      navigate(next && next.startsWith('/') && !next.startsWith('//') ? next : '/dashboard', { replace: true });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Sign-in failed');
    }
  });

  return (
    <AuthShell title="Sign in" subtitle="Use your hospital account to continue.">
      <form onSubmit={onSubmit} className="space-y-4" noValidate>
        {error && <div className="rounded-md border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger">{error}</div>}
        <Field label="Email" error={form.formState.errors.email}>
          <div className="relative">
            <Mail className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
            <Input type="email" autoComplete="username" className="h-10 pl-9" placeholder="you@hospital.com" {...form.register('email')} />
          </div>
        </Field>
        <Field label="Password" error={form.formState.errors.password}>
          <div className="relative">
            <Lock className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
            <Input type={show ? 'text' : 'password'} autoComplete="current-password" className="h-10 pl-9 pr-10" {...form.register('password')} />
            <button type="button" onClick={() => setShow((s) => !s)} className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-muted" aria-label={show ? 'Hide password' : 'Show password'}>
              {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>
        </Field>
        <div className="flex items-center justify-between text-sm">
          <label className="flex items-center gap-2 text-muted">
            <input type="checkbox" className="h-4 w-4 rounded border-border accent-[rgb(var(--brand))]" {...form.register('rememberMe')} /> Remember me
          </label>
          <Link to="/forgot-password" className="text-brand hover:underline">
            Forgot password?
          </Link>
        </div>
        <Button type="submit" size="lg" className="w-full justify-center" loading={form.formState.isSubmitting}>
          Sign in
        </Button>
      </form>
    </AuthShell>
  );
}

export function ForgotPasswordPage() {
  const [sent, setSent] = useState(false);
  const form = useForm<z.infer<typeof forgotPasswordSchema>>({ resolver: zodResolver(forgotPasswordSchema) });
  const onSubmit = form.handleSubmit(async (v) => {
    try {
      await api.post('/auth/forgot-password', v);
      setSent(true);
    } catch (e) {
      handleFormError(e);
    }
  });
  return (
    <AuthShell title="Reset your password" subtitle="We'll email you a link to choose a new password.">
      {sent ? (
        <Card className="p-4 text-sm">If an account exists for that email, a reset link is on its way. It expires in 30 minutes.</Card>
      ) : (
        <form onSubmit={onSubmit} className="space-y-4" noValidate>
          <Field label="Email" error={form.formState.errors.email}>
            <Input type="email" className="h-10" {...form.register('email')} />
          </Field>
          <Button type="submit" size="lg" className="w-full justify-center" loading={form.formState.isSubmitting}>
            Send reset link
          </Button>
        </form>
      )}
      <p className="mt-6 text-center text-sm">
        <Link to="/login" className="text-brand hover:underline">
          Back to sign in
        </Link>
      </p>
    </AuthShell>
  );
}

export function ResetPasswordPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const form = useForm<z.infer<typeof resetPasswordSchema>>({ resolver: zodResolver(resetPasswordSchema), defaultValues: { token: params.get('token') ?? '' } });
  const onSubmit = form.handleSubmit(async (v) => {
    try {
      await api.post('/auth/reset-password', v);
      toast.success('Password updated. Please sign in.');
      navigate('/login');
    } catch (e) {
      handleFormError(e, form.setError);
    }
  });
  return (
    <AuthShell title="Choose a new password" subtitle="At least 10 characters with upper and lower case letters, a digit and a symbol.">
      <form onSubmit={onSubmit} className="space-y-4" noValidate>
        <Field label="New password" error={form.formState.errors.password}>
          <Input type="password" autoComplete="new-password" className="h-10" {...form.register('password')} />
        </Field>
        <Field label="Confirm password" error={form.formState.errors.confirmPassword}>
          <Input type="password" autoComplete="new-password" className="h-10" {...form.register('confirmPassword')} />
        </Field>
        {form.formState.errors.token && <p className="text-sm text-danger">This reset link is invalid.</p>}
        <Button type="submit" size="lg" className="w-full justify-center" loading={form.formState.isSubmitting}>
          Update password
        </Button>
      </form>
    </AuthShell>
  );
}

export function ChangePasswordPage() {
  const [params] = useSearchParams();
  const { refetch } = useAuth();
  const navigate = useNavigate();
  const form = useForm<z.infer<typeof changePasswordSchema>>({ resolver: zodResolver(changePasswordSchema) });
  const onSubmit = form.handleSubmit(async (v) => {
    try {
      await api.post('/auth/change-password', v);
      await refetch();
      toast.success('Password changed. Other sessions have been signed out.');
      navigate('/dashboard');
    } catch (e) {
      handleFormError(e, form.setError);
    }
  });
  return (
    <div className="mx-auto max-w-md">
      <h1 className="text-xl font-semibold">Change password</h1>
      {params.get('required') && <p className="mt-2 rounded-md border border-warn/30 bg-warn/10 px-3 py-2 text-sm text-warn">Your administrator requires you to set a new password before continuing.</p>}
      <Card className="mt-4 p-5">
        <form onSubmit={onSubmit} className="space-y-4" noValidate>
          <Field label="Current password" error={form.formState.errors.currentPassword}>
            <Input type="password" autoComplete="current-password" {...form.register('currentPassword')} />
          </Field>
          <Field label="New password" error={form.formState.errors.newPassword} hint="10+ characters, upper & lower case, digit and symbol">
            <Input type="password" autoComplete="new-password" {...form.register('newPassword')} />
          </Field>
          <Field label="Confirm new password" error={form.formState.errors.confirmPassword}>
            <Input type="password" autoComplete="new-password" {...form.register('confirmPassword')} />
          </Field>
          <Button type="submit" loading={form.formState.isSubmitting}>
            Update password
          </Button>
        </form>
      </Card>
    </div>
  );
}
