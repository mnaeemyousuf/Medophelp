import type { LucideIcon } from 'lucide-react';
import {
  Activity,
  BarChart3,
  Building2,
  CalendarDays,
  ClipboardList,
  CreditCard,
  FileClock,
  FlaskConical,
  HeartPulse,
  LayoutDashboard,
  Pill,
  Receipt,
  ScrollText,
  Settings,
  ShieldCheck,
  Siren,
  Stethoscope,
  UserCog,
  Users,
  UsersRound,
  BedDouble,
  Boxes,
  Briefcase,
  Wallet,
  CalendarCheck,
  Truck,
  Contact,
} from 'lucide-react';
import { REPORTS, type Permission } from '@hms/shared';

/** Anyone who can open at least one report sees the Reports entry. */
const REPORT_PERMISSIONS = [...new Set(REPORTS.flatMap((r) => r.anyOf))];

export interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  /** Shown if the user has any of these. */
  anyOf: Permission[];
  /** Planned module: shown greyed out with its phase so users know it is coming. */
  phase?: number;
  mobile?: boolean;
}

export interface NavSection {
  title: string;
  items: NavItem[];
}

export const NAV: NavSection[] = [
  {
    title: 'Overview',
    items: [{ to: '/dashboard', label: 'Dashboard', icon: LayoutDashboard, anyOf: [], mobile: true }],
  },
  {
    title: 'Patient care',
    items: [
      { to: '/patients', label: 'Patients', icon: Users, anyOf: ['patients.view'], mobile: true },
      { to: '/appointments', label: 'Appointments', icon: CalendarDays, anyOf: ['appointments.view'], mobile: true },
      { to: '/nursing', label: 'Nursing queue', icon: HeartPulse, anyOf: ['nursing.queue'], mobile: true },
      { to: '/doctor', label: 'My consultations', icon: Stethoscope, anyOf: ['clinical.queue'], mobile: true },
      { to: '/emergency', label: 'Emergency', icon: Siren, anyOf: ['emergency.view'], mobile: true },
      { to: '/ipd', label: 'Admissions / IPD', icon: BedDouble, anyOf: ['ipd.view'] },
    ],
  },
  {
    title: 'Diagnostics & pharmacy',
    items: [
      { to: '/laboratory', label: 'Laboratory', icon: FlaskConical, anyOf: ['lab.process', 'lab.verify', 'lab.manage'], mobile: true },
      { to: '/pharmacy', label: 'Pharmacy', icon: Pill, anyOf: ['pharmacy.dispense'], mobile: true },
      { to: '/inventory', label: 'Inventory', icon: Boxes, anyOf: ['inventory.view'], mobile: true },
      { to: '/purchasing/requests', label: 'Purchase requests', icon: ClipboardList, anyOf: ['inventory.manage', 'pharmacy.dispense', 'purchasing.manage', 'purchasing.approve'] },
      { to: '/purchasing', label: 'Purchase orders', icon: Truck, anyOf: ['purchasing.manage', 'purchasing.approve'] },
    ],
  },
  {
    title: 'Finance',
    items: [
      { to: '/billing', label: 'Billing', icon: Receipt, anyOf: ['billing.view'], mobile: true },
      { to: '/insurance', label: 'Insurance claims', icon: CreditCard, anyOf: ['insurance.manage'] },
    ],
  },
  {
    title: 'People',
    items: [
      { to: '/me', label: 'My workspace', icon: Contact, anyOf: ['self.service'], mobile: true },
      { to: '/hr', label: 'HR & attendance', icon: Briefcase, anyOf: ['hr.employees', 'hr.attendance'] },
      { to: '/hr/leave', label: 'Leave approvals', icon: CalendarCheck, anyOf: ['hr.leave.approve'] },
      { to: '/payroll', label: 'Payroll', icon: Wallet, anyOf: ['payroll.manage', 'payroll.approve'] },
      { to: '/recruitment', label: 'Recruitment', icon: UsersRound, anyOf: ['recruitment.manage', 'recruitment.approve'] },
    ],
  },
  {
    title: 'My health',
    items: [
      { to: '/portal/appointments', label: 'My appointments', icon: CalendarCheck, anyOf: ['portal.self'], mobile: true },
      { to: '/portal/medications', label: 'My medicines', icon: Pill, anyOf: ['portal.self'], mobile: true },
      { to: '/portal/records', label: 'My records', icon: ClipboardList, anyOf: ['portal.self'], mobile: true },
      { to: '/portal/bills', label: 'My bills', icon: Receipt, anyOf: ['portal.self'], mobile: true },
    ],
  },
  {
    title: 'Administration',
    items: [
      { to: '/reports', label: 'Reports', icon: BarChart3, anyOf: REPORT_PERMISSIONS },
      { to: '/admin/users', label: 'Users', icon: UserCog, anyOf: ['users.view', 'users.manage'] },
      { to: '/admin/roles', label: 'Roles & permissions', icon: ShieldCheck, anyOf: ['roles.manage'] },
      { to: '/admin/staff', label: 'Doctors & nurses', icon: Activity, anyOf: ['staff.view', 'staff.manage'] },
      { to: '/admin/departments', label: 'Departments & services', icon: Building2, anyOf: ['departments.manage', 'services.manage'] },
      { to: '/admin/settings', label: 'Hospital settings', icon: Settings, anyOf: ['system.config'] },
      { to: '/audit', label: 'Audit log', icon: ScrollText, anyOf: ['audit.view'] },
    ],
  },
];

export const NOTIFICATIONS_ICON = FileClock;

export function visibleNav(can: (...p: Permission[]) => boolean) {
  return NAV.map((s) => ({ ...s, items: s.items.filter((i) => i.anyOf.length === 0 || can(...i.anyOf)) })).filter((s) => s.items.length);
}
