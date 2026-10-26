import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import type { Permission } from '@hms/shared';
import { useAuth } from '@/lib/auth';
import { PageLoader } from '@/components/ui/primitives';
import { ForbiddenPage, ServerUnavailablePage } from '@/pages/errors';

export function RequireAuth({ children }: { children: ReactNode }) {
  const { user, loading, unavailable, refetch } = useAuth();
  const location = useLocation();
  // Unknown session (server unreachable) is not a sign-out: wait here instead of bouncing to /login.
  if (unavailable) return <ServerUnavailablePage onRetry={() => void refetch()} />;
  if (loading) return <PageLoader />;
  if (!user) return <Navigate to={`/login?next=${encodeURIComponent(location.pathname + location.search)}`} replace />;
  if (user.mustChangePassword && location.pathname !== '/account/password') return <Navigate to="/account/password?required=1" replace />;
  return <>{children}</>;
}

/** UI-level guard only; the API enforces the same permission independently. */
export function RequirePermission({ anyOf, children }: { anyOf: Permission[]; children: ReactNode }) {
  const { can } = useAuth();
  return can(...anyOf) ? <>{children}</> : <ForbiddenPage />;
}
