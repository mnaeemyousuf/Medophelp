import { createContext, useCallback, useContext, useEffect, useMemo, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import type { Permission, SessionUser } from '@hms/shared';
import { api, ApiError, setSessionExpiredHandler } from './api';

interface AuthState {
  user: SessionUser | null;
  loading: boolean;
  can: (...anyOf: Permission[]) => boolean;
  logout: () => Promise<void>;
  refetch: () => Promise<unknown>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { data, isLoading, refetch } = useQuery({
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
    retry: false,
  });

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

  return <AuthContext.Provider value={{ user: data ?? null, loading: isLoading, can, logout, refetch }}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth outside AuthProvider');
  return ctx;
}
