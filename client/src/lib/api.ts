/** Problem-details error from the API (RFC 7807). */
export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public code?: string,
    public details?: { fieldErrors?: Record<string, string[]>; duplicates?: unknown[] } & Record<string, unknown>,
  ) {
    super(message);
  }
  get fieldErrors() {
    return this.details?.fieldErrors ?? {};
  }
}

let refreshing: Promise<boolean> | null = null;

/** One refresh at a time, shared by every request that hit 401 concurrently. */
async function refreshSession() {
  refreshing ??= fetch('/api/auth/refresh', { method: 'POST', credentials: 'same-origin', headers: { 'X-Requested-With': 'hms' } })
    .then((r) => r.ok)
    .catch(() => false)
    .finally(() => setTimeout(() => (refreshing = null), 0));
  return refreshing;
}

type Query = Record<string, string | number | boolean | undefined | null>;

export function qs(params?: Query) {
  if (!params) return '';
  const s = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== '') s.set(k, String(v));
  const str = s.toString();
  return str ? `?${str}` : '';
}

export let onSessionExpired: () => void = () => {};
export const setSessionExpiredHandler = (fn: () => void) => (onSessionExpired = fn);

export interface RequestOptions {
  /** Sent as the Idempotency-Key header so a retried or double-clicked request runs only once. */
  idempotencyKey?: string;
}

async function request<T>(method: string, url: string, body?: unknown, retry = true, opts: RequestOptions = {}): Promise<T> {
  const isForm = body instanceof FormData;
  let res: Response;
  try {
    res = await fetch(`/api${url}`, {
      method,
      credentials: 'same-origin',
      headers: {
        'X-Requested-With': 'hms',
        ...(opts.idempotencyKey ? { 'Idempotency-Key': opts.idempotencyKey } : {}),
        ...(body !== undefined && !isForm ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body === undefined ? undefined : isForm ? body : JSON.stringify(body),
    });
  } catch {
    throw new ApiError(0, UNAVAILABLE_MESSAGE, 'server_unavailable');
  }

  if (res.status === 401 && retry && !url.startsWith('/auth/')) {
    if (await refreshSession()) return request<T>(method, url, body, false, opts);
    onSessionExpired();
  }
  if (res.status === 204) return undefined as T;
  const type = res.headers.get('content-type') ?? '';
  const data = type.includes('json') ? await res.json() : await res.text();
  if (!res.ok) {
    // The API always answers errors as problem+json. A bare 5xx comes from whatever sits in front of
    // it — the dev proxy with the API stopped, or the host while the service starts or wakes up.
    if (typeof data !== 'object' && res.status >= 500) throw new ApiError(res.status, UNAVAILABLE_MESSAGE, 'server_unavailable');
    const p = typeof data === 'object' ? data : { title: 'Unexpected error' };
    throw new ApiError(res.status, p.title ?? 'Request failed', p.code, p.details);
  }
  return data as T;
}

export const UNAVAILABLE_MESSAGE = 'The Medophelp server is not reachable right now. It may be starting up — please try again in a moment.';

/** True when the server could not be reached (network down, server stopped, starting or asleep). */
export const isServerUnavailable = (err: unknown) => err instanceof ApiError && err.code === 'server_unavailable';

export const api = {
  get: <T>(url: string, params?: Query) => request<T>('GET', url + qs(params)),
  post: <T>(url: string, body?: unknown, opts?: RequestOptions) => request<T>('POST', url, body ?? {}, true, opts),
  put: <T>(url: string, body?: unknown) => request<T>('PUT', url, body),
  patch: <T>(url: string, body?: unknown) => request<T>('PATCH', url, body),
  del: <T>(url: string) => request<T>('DELETE', url),
};

/**
 * Opens an authenticated PDF in a new tab. The tab is opened synchronously (so popup blockers allow
 * it), then filled once the PDF arrives — refreshing the session first if the access token expired.
 */
export async function openPdf(path: string) {
  const win = window.open('about:blank', '_blank');
  const load = () => fetch(`/api${path}`, { credentials: 'same-origin' });
  let res = await load();
  if (res.status === 401 && (await refreshSession())) res = await load();
  if (!res.ok) {
    win?.close();
    throw new ApiError(res.status, 'Could not generate the document');
  }
  const url = URL.createObjectURL(await res.blob());
  if (win) win.location.href = url;
  else window.location.href = url;
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

export interface Paged<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
}

/** A fresh key per user action (one dialog opening = one intended payment/dispense). */
export const newIdempotencyKey = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`).replace(/[^A-Za-z0-9_-]/g, '');
