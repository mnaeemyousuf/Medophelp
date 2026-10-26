import { createContext, useCallback, useContext, useEffect, useMemo, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import type { Permission, SessionUser } from '@hms/shared';
import { api, ApiError, isServerUnavailable, setSessionExpiredHandler } from './api';

interface AuthState {
  user: SessionUser | null;
  loading: boolean;
  /** The server could not be reached; the session state is unknown (not signed out). */
  unavailable: boolean;
  can: (...anyOf: Permission[]) => boolean;
  logout: () => Promise<void>;
  refetch: () => Promise<unknown>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { data, isLoading, refetch, failureReason, error } = useQuery({
    queryKey: ['me'],
    queryFn: async () => {
      try {
        return await api.get<SessionUser>('/auth/me');
      } catch (e) {
        if (e instanceof ApiError && e.status === 401) return null;
        throw e;
      }
    },
    staleTime: 60_000,
    // An unreachable server is not a sign-out: keep retrying (2 s, 4 s, 8 s … up to 15 s) so the app
    // recovers on its own when the server is back (e.g. a sleeping host waking up).
    retry: (_count, err) => isServerUnavailable(err),
    retryDelay: (attempt) => Math.min(2000 * 2 ** attempt, 15_000),
  });
  const unavailable = !data && isServerUnavailable(failureReason ?? error);

  useEffect(() => {
    setSessionExpiredHandler(() => {
      qc.setQueryData(['me'], null);
      navigate('/login?expired=1', { replace: true });
    });
  }, [qc, navigate]);

  const perms = useMemo(() => new Set(data?.permissions ?? []), [data]);
  const can = useCallback((...anyOf: Permission[]) => anyOf.some((p) => perms.has(p)), [perms]);

  const logout = useCallback(async () => {
    await api.post('/auth/logout').catch(() => undefined);
    qc.clear();
    navigate('/login', { replace: true });
  }, [qc, navigate]);

  return <AuthContext.Provider value={{ user: data ?? null, loading: isLoading && !unavailable, unavailable, can, logout, refetch }}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth outside AuthProvider');
  return ctx;
}
