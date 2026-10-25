import { Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query';
import { Bell, ChevronRight, KeyRound, LogOut, Menu, Moon, Search, Sun, X } from 'lucide-react';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { cn, formatDateTime, initials } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Kbd, PageLoader } from '@/components/ui/primitives';
import { BRAND } from '@hms/shared';
import { BrandMark } from '@/components/brand/Logo';
import { NAV, visibleNav } from './nav';

/** Bottom-bar label: "My medicines" → "Medicines", "Lab worklist" → "Lab". */
const shortLabel = (label: string) => {
  const words = label.replace(/^My\s+/i, '').split(' ');
  const first = words[0] ?? label;
  return first.charAt(0).toUpperCase() + first.slice(1);
};

export function Layout() {
  const { user, can } = useAuth();
  const [mobileOpen, setMobileOpen] = useState(false);
  const location = useLocation();
  const sections = useMemo(() => visibleNav(can), [can]);
  const mobileItems = sections.flatMap((s) => s.items).filter((i) => i.mobile && !i.phase).slice(0, 5);

  useEffect(() => setMobileOpen(false), [location.pathname]);
  // Browser tab title: "<section> · Medophelp", from the longest matching menu entry.
  useEffect(() => {
    const items = NAV.flatMap((s) => s.items).filter((i) => location.pathname === i.to || location.pathname.startsWith(`${i.to}/`));
    const best = items.sort((a, b) => b.to.length - a.to.length)[0];
    document.title = best ? `${best.label} · ${BRAND.name}` : `${BRAND.name} — ${BRAND.tagline}`;
  }, [location.pathname]);

  return (
    <div className="flex h-full">
      {/* Sidebar */}
      <aside className={cn('fixed inset-y-0 left-0 z-40 flex w-64 flex-col bg-sidebar text-sidebar-fg transition-transform lg:static lg:translate-x-0', mobileOpen ? 'translate-x-0' : '-translate-x-full')}>
        <div className="flex h-14 items-center gap-2.5 border-b border-white/10 px-4">
          {user?.hospital.logoUrl ? (
            <img src={user.hospital.logoUrl} alt="" className="h-8 w-8 rounded-md bg-white object-contain" />
          ) : (
            <BrandMark />
          )}
          <div className="min-w-0">
            <p className="truncate font-display text-[15px] font-extrabold leading-tight tracking-tight text-white">{BRAND.name}</p>
            <p className="truncate text-[11px] leading-tight text-sidebar-muted" title={user?.hospital.name}>{user?.hospital.name}</p>
          </div>
          <button className="ml-auto rounded p-1 text-sidebar-muted hover:text-white lg:hidden" onClick={() => setMobileOpen(false)} aria-label="Close menu">
            <X className="h-4 w-4" />
          </button>
        </div>
        <nav className="flex-1 overflow-y-auto px-3 py-3">
          {sections.map((s) => (
            <div key={s.title} className="mb-4">
              <p className="mb-1 px-2 text-[10px] font-semibold uppercase tracking-wider text-sidebar-muted">{s.title}</p>
              {s.items.map((item) =>
                item.phase ? (
                  <div key={item.to} title={`Planned for phase ${item.phase}`} className="flex cursor-not-allowed items-center gap-2.5 rounded-md px-2 py-1.5 text-sm text-sidebar-muted/60">
                    <item.icon className="h-4 w-4" />
                    <span className="flex-1">{item.label}</span>
                    <span className="rounded bg-white/10 px-1 text-[9px] font-semibold uppercase">P{item.phase}</span>
                  </div>
                ) : (
                  <NavLink
                    key={item.to}
                    to={item.to}
                    className={({ isActive }) =>
                      cn('flex items-center gap-2.5 rounded-md px-2 py-1.5 text-sm outline-none transition-colors focus-visible:ring-2 focus-visible:ring-white/70', isActive ? 'bg-brand font-medium text-brand-fg shadow-sm' : 'text-sidebar-muted hover:bg-white/[0.07] hover:text-white')
                    }
                  >
                    <item.icon className="h-4 w-4" />
                    {item.label}
                  </NavLink>
                ),
              )}
            </div>
          ))}
        </nav>
        <div className="border-t border-white/10 px-4 py-3 text-[10.5px] leading-snug text-sidebar-muted">{BRAND.tagline}</div>
      </aside>
      {mobileOpen && <div className="fixed inset-0 z-30 bg-slate-950/40 lg:hidden" onClick={() => setMobileOpen(false)} />}

      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar onMenu={() => setMobileOpen(true)} />
        <main className="flex-1 overflow-y-auto pb-20 lg:pb-0">
          <div className="mx-auto max-w-[1400px] px-4 py-5 sm:px-6">
            <Breadcrumbs />
            <Suspense fallback={<PageLoader />}>
              <Outlet />
            </Suspense>
          </div>
        </main>
        {/* Mobile bottom navigation */}
        <nav className="fixed inset-x-0 bottom-0 z-20 flex border-t border-border bg-surface/95 backdrop-blur lg:hidden">
          {mobileItems.map((i) => (
            <NavLink key={i.to} to={i.to} className={({ isActive }) => cn('flex flex-1 flex-col items-center gap-0.5 py-2 text-[10px]', isActive ? 'text-brand' : 'text-muted')}>
              <i.icon className="h-5 w-5" />
              <span className="max-w-full truncate px-0.5">{shortLabel(i.label)}</span>
            </NavLink>
          ))}
        </nav>
      </div>
    </div>
  );
}

function Topbar({ onMenu }: { onMenu: () => void }) {
  const { user, logout } = useAuth();
  const [menu, setMenu] = useState(false);
  const [dark, setDark] = useState(() => document.documentElement.classList.contains('dark'));
  const navigate = useNavigate();

  const toggleTheme = () => {
    const next = !dark;
    setDark(next);
    document.documentElement.classList.toggle('dark', next);
    try {
      localStorage.setItem('hms-theme', next ? 'dark' : 'light');
    } catch {
      /* storage may be unavailable */
    }
  };

  return (
    <header className="sticky top-0 z-20 flex h-14 items-center gap-3 border-b border-border bg-surface/95 px-4 backdrop-blur sm:px-6">
      <button className="rounded-md p-1.5 text-muted hover:bg-subtle lg:hidden" onClick={onMenu} aria-label="Open menu">
        <Menu className="h-5 w-5" />
      </button>
      <GlobalSearch />
      <div className="ml-auto flex items-center gap-1">
        <button onClick={toggleTheme} className="focus-ring rounded-md p-2 text-muted hover:bg-subtle hover:text-fg" aria-label="Toggle theme">
          {dark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
        </button>
        <NotificationBell />
        <div className="relative">
          <button onClick={() => setMenu((m) => !m)} className="focus-ring flex items-center gap-2 rounded-md p-1 pr-2 hover:bg-subtle">
            <span className="flex h-7 w-7 items-center justify-center rounded-full bg-brand/15 text-[11px] font-semibold text-brand">{initials(user?.fullName ?? '?')}</span>
            <span className="hidden text-left sm:block">
              <span className="block text-xs font-medium leading-tight">{user?.fullName}</span>
              <span className="block text-[10px] leading-tight text-muted">{user?.roles.join(', ')}</span>
            </span>
          </button>
          {menu && (
            <>
              <div className="fixed inset-0 z-10" onClick={() => setMenu(false)} />
              <div className="absolute right-0 z-20 mt-1 w-52 rounded-md border border-border bg-surface p-1 shadow-lg">
                <p className="truncate px-2 py-1.5 text-xs text-muted">{user?.email}</p>
                <button onClick={() => { setMenu(false); navigate('/account/password'); }} className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-subtle">
                  <KeyRound className="h-4 w-4 text-muted" /> Change password
                </button>
                <button onClick={logout} className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-sm text-danger hover:bg-danger/10">
                  <LogOut className="h-4 w-4" /> Sign out
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </header>
  );
}

interface SearchGroup {
  type: string;
  label: string;
  items: Array<{ id: string; title: string; subtitle?: string; href: string }>;
}

function GlobalSearch() {
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [debounced, setDebounced] = useState('');
  const ref = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();
  const { user } = useAuth();

  useEffect(() => {
    const t = setTimeout(() => setDebounced(q.trim()), 250);
    return () => clearTimeout(t);
  }, [q]);
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        ref.current?.focus();
      }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, []);

  const { data, isFetching } = useQuery({
    queryKey: ['search', debounced],
    queryFn: () => api.get<{ groups: SearchGroup[] }>('/search', { q: debounced }),
    enabled: debounced.length >= 2,
  });

  if (user?.patientId) return <div className="flex-1" />;

  return (
    <div className="relative max-w-md flex-1">
      <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
      <input
        ref={ref}
        value={q}
        onChange={(e) => {
          setQ(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        placeholder="Search patients, MRN, CNIC, phone, invoice…"
        className="focus-ring h-9 w-full rounded-md border border-border bg-subtle/60 pl-8 pr-12 text-sm placeholder:text-muted/80"
      />
      <span className="absolute right-2 top-1/2 hidden -translate-y-1/2 sm:block">
        <Kbd>Ctrl K</Kbd>
      </span>
      {open && debounced.length >= 2 && (
        <div className="absolute left-0 right-0 top-11 z-30 max-h-[70vh] overflow-y-auto rounded-md border border-border bg-surface p-1 shadow-xl">
          {isFetching && !data && <p className="px-3 py-2 text-xs text-muted">Searching…</p>}
          {data && !data.groups.length && <p className="px-3 py-2 text-xs text-muted">No results for “{debounced}”</p>}
          {data?.groups.map((g) => (
            <div key={g.type} className="py-1">
              <p className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-muted">{g.label}</p>
              {g.items.map((i) => (
                <button
                  key={i.id}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => {
                    navigate(i.href);
                    setOpen(false);
                    setQ('');
                  }}
                  className="flex w-full flex-col rounded px-2 py-1.5 text-left hover:bg-subtle"
                >
                  <span className="text-sm">{i.title}</span>
                  {i.subtitle && <span className="text-xs text-muted">{i.subtitle}</span>}
                </button>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

interface NotificationRow {
  _id: string;
  title: string;
  message: string;
  link?: string;
  priority: string;
  readAt?: string;
  createdAt: string;
}

function NotificationBell() {
  const [open, setOpen] = useState(false);
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { data } = useQuery({
    queryKey: ['notifications'],
    queryFn: () => api.get<{ items: NotificationRow[]; unread: number }>('/notifications', { pageSize: 15 }),
    refetchInterval: 30_000,
  });
  const markAll = useMutation({ mutationFn: () => api.post('/notifications/read-all'), onSuccess: () => qc.invalidateQueries({ queryKey: ['notifications'] }) });
  const markOne = useMutation({ mutationFn: (id: string) => api.post(`/notifications/${id}/read`), onSuccess: () => qc.invalidateQueries({ queryKey: ['notifications'] }) });

  return (
    <div className="relative">
      <button onClick={() => setOpen((o) => !o)} className="focus-ring relative rounded-md p-2 text-muted hover:bg-subtle hover:text-fg" aria-label="Notifications">
        <Bell className="h-4 w-4" />
        {!!data?.unread && <span className="num absolute right-1 top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-danger px-1 text-[9px] font-bold text-white">{data.unread > 9 ? '9+' : data.unread}</span>}
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute right-0 z-20 mt-1 w-[340px] max-w-[calc(100vw-2rem)] rounded-md border border-border bg-surface shadow-xl">
            <div className="flex items-center justify-between border-b border-border px-3 py-2">
              <p className="text-sm font-semibold">Notifications</p>
              {!!data?.unread && (
                <button onClick={() => markAll.mutate()} className="text-xs text-brand hover:underline">
                  Mark all read
                </button>
              )}
            </div>
            <div className="max-h-[60vh] overflow-y-auto">
              {!data?.items.length && <p className="px-3 py-6 text-center text-xs text-muted">You're all caught up</p>}
              {data?.items.map((n) => (
                <button
                  key={n._id}
                  onClick={() => {
                    if (!n.readAt) markOne.mutate(n._id);
                    if (n.link) navigate(n.link);
                    setOpen(false);
                  }}
                  className={cn('flex w-full gap-2 border-b border-border/60 px-3 py-2.5 text-left last:border-0 hover:bg-subtle', !n.readAt && 'bg-brand/[0.04]')}
                >
                  <span className={cn('mt-1.5 h-2 w-2 shrink-0 rounded-full', n.readAt ? 'bg-transparent' : n.priority === 'Normal' ? 'bg-brand' : 'bg-danger')} />
                  <span className="min-w-0">
                    <span className="flex items-center gap-2 text-sm font-medium">
                      {n.title} {n.priority !== 'Normal' && <Badge tone="danger">{n.priority}</Badge>}
                    </span>
                    <span className="mt-0.5 block text-xs text-muted">{n.message}</span>
                    <span className="mt-1 block text-[10px] text-muted/80">{formatDateTime(n.createdAt)}</span>
                  </span>
                </button>
              ))}
            </div>
            <button onClick={() => { setOpen(false); navigate('/notifications'); }} className="block w-full border-t border-border px-3 py-2 text-center text-xs text-brand hover:bg-subtle">
              View all notifications
            </button>
          </div>
        </>
      )}
    </div>
  );
}

const CRUMB_LABELS: Record<string, string> = {
  dashboard: 'Dashboard',
  patients: 'Patients',
  new: 'Register',
  appointments: 'Appointments',
  nursing: 'Nursing',
  assess: 'Assessment',
  doctor: 'Consultations',
  consult: 'Consultation',
  billing: 'Billing',
  invoices: 'Invoices',
  admin: 'Administration',
  users: 'Users',
  roles: 'Roles & permissions',
  staff: 'Doctors & nurses',
  departments: 'Departments & services',
  settings: 'Hospital settings',
  audit: 'Audit log',
  portal: 'My health',
  records: 'My records',
  bills: 'My bills',
  account: 'Account',
  password: 'Change password',
  laboratory: 'Laboratory',
  tests: 'Test master',
  orders: 'Orders',
  pharmacy: 'Pharmacy',
  dispense: 'Dispense',
  inventory: 'Inventory',
  items: 'Items',
  purchasing: 'Purchasing',
  emergency: 'Emergency',
  ipd: 'Admissions & beds',
  admissions: 'Admission',
  setup: 'Wards & beds',
  insurance: 'Insurance claims',
  claims: 'Claim',
  hr: 'HR',
  employees: 'Employees',
  attendance: 'Attendance',
  leave: 'Leave',
  payroll: 'Payroll',
  runs: 'Run',
  recruitment: 'Recruitment',
  candidates: 'Candidate',
  me: 'My workspace',
  reports: 'Reports',
  medications: 'My medicines',
  requests: 'Purchase requests',
  notifications: 'Notifications',
};

function Breadcrumbs() {
  const { pathname } = useLocation();
  const { can } = useAuth();
  const parts = pathname.split('/').filter(Boolean);
  // A crumb that is a menu page the user cannot open is shown as text, not a dead-end link.
  const navPaths = new Set(NAV.flatMap((s) => s.items.map((i) => i.to)));
  const allowed = new Set(visibleNav(can).flatMap((s) => s.items.map((i) => i.to)));
  const linkable = (href: string) => !navPaths.has(href) || allowed.has(href);
  if (parts.length < 2) return null;
  return (
    <nav className="mb-3 flex items-center gap-1 text-xs text-muted" aria-label="Breadcrumb">
      {parts.map((p, i) => {
        const href = '/' + parts.slice(0, i + 1).join('/');
        const label = CRUMB_LABELS[p] ?? (/^[a-f0-9]{24}$/.test(p) ? 'Details' : p);
        const last = i === parts.length - 1;
        return (
          <span key={href} className="flex items-center gap-1">
            {i > 0 && <ChevronRight className="h-3 w-3" />}
            {last || !CRUMB_LABELS[p] || !linkable(href) ? <span className={cn(last && 'text-fg')}>{label}</span> : <Link to={href} className="hover:text-fg">{label}</Link>}
          </span>
        );
      })}
    </nav>
  );
}
