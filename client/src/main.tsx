import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { MutationCache, QueryCache, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Toaster, toast } from 'sonner';
import { ApiError } from './lib/api';
import { AuthProvider } from './lib/auth';
import { App } from './app/App';
import { ErrorBoundary } from './pages/errors';
import './index.css';

/** Background query failures surface as toasts; 401/403 are handled by auth and guards. */
const reportQueryError = (err: unknown) => {
  if (err instanceof ApiError && [401, 403, 404].includes(err.status)) return;
  toast.error(err instanceof Error ? err.message : 'Something went wrong');
};

const queryClient = new QueryClient({
  queryCache: new QueryCache({ onError: reportQueryError }),
  mutationCache: new MutationCache({}),
  defaultOptions: {
    queries: {
      staleTime: 15_000,
      refetchOnWindowFocus: true,
      retry: (count, err) => !(err instanceof ApiError && err.status >= 400 && err.status < 500) && count < 2,
    },
  },
});

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <ErrorBoundary>
            <App />
          </ErrorBoundary>
          <Toaster richColors closeButton position="top-right" />
        </AuthProvider>
      </QueryClientProvider>
    </BrowserRouter>
  </React.StrictMode>,
);
