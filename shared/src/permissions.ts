/**
 * Permission catalogue. The server seeds these, enforces them on every route, and the client
 * uses them only to decide what to show. Add a module's permissions here first.
 */
export const PERMISSIONS = {
  // Administration
  'system.config': { module: 'Administration', description: 'Manage hospital configuration, numbering, tax and notification settings' },
  'departments.manage': { module: 'Administration', description: 'Create and edit departments' },
  'services.manage': { module: 'Administration', description: 'Manage billable services and prices' },
  'users.view': { module: 'Administration', description: 'View user accounts' },
  'users.manage': { module: 'Administration', description: 'Create, edit, deactivate users and reset passwords' },
  'roles.manage': { module: 'Administration', description: 'Create roles and change role permissions' },
  'audit.view': { module: 'Administration', description: 'Read the audit log' },
  'staff.view': { module: 'Administration', description: 'View doctors and nurses directory' },
  'staff.manage': { module: 'Administration', description: 'Create and edit doctor and nurse profiles' },

  // Dashboards
  'dashboard.executive': { module: 'Dashboards', description: 'Hospital-wide KPIs and charts' },
  'dashboard.financial': { module: 'Dashboards', description: 'Revenue and outstanding figures' },

  // Patients
  'patients.view': { module: 'Patients', description: 'Search and view patient demographics' },
  'patients.create': { module: 'Patients', description: 'Register patients' },
  'patients.update': { module: 'Patients', description: 'Edit patient demographics, insurance, allergies and history' },
  'patients.documents': { module: 'Patients', description: 'Upload and download patient documents' },

  // Appointments
  'appointments.view': { module: 'Appointments', description: 'View appointment calendar and lists' },
  'appointments.manage': { module: 'Appointments', description: 'Book, reschedule, cancel and mark no-show' },
  'appointments.checkin': { module: 'Appointments', description: 'Check patients in' },

  // Nursing
  'nursing.queue': { module: 'Nursing', description: 'View the nursing assessment queue' },
  'vitals.record': { module: 'Nursing', description: 'Record vital signs and submit nursing assessments' },
  'vitals.view': { module: 'Nursing', description: 'View vital sign history' },

  // Clinical
  'emr.view': { module: 'Clinical', description: 'View EMR of patients under the user\'s care' },
  'emr.view_all': { module: 'Clinical', description: 'View EMR of any patient in the hospital' },
  'clinical.queue': { module: 'Clinical', description: 'View doctor consultation queue' },
  'clinical.consult': { module: 'Clinical', description: 'Start/complete consultations, write notes, diagnoses and treatment plans' },
  'clinical.notes.view': { module: 'Clinical', description: 'Read doctor clinical notes' },
  'prescriptions.create': { module: 'Clinical', description: 'Create and cancel prescriptions' },
  'prescriptions.view': { module: 'Clinical', description: 'View prescriptions' },
  'lab.order': { module: 'Clinical', description: 'Order laboratory tests' },
  'lab.results.view': { module: 'Clinical', description: 'View laboratory results' },
  'medication.manage': { module: 'Clinical', description: 'View medication adherence, record doses for patients, stop schedules' },

  // Laboratory (Phase 2)
  'lab.process': { module: 'Laboratory', description: 'Collect samples, enter results' },
  'lab.verify': { module: 'Laboratory', description: 'Verify lab results' },
  'lab.manage': { module: 'Laboratory', description: 'Manage lab test master and pricing' },

  // Pharmacy & Inventory (Phase 2)
  'pharmacy.dispense': { module: 'Pharmacy', description: 'Dispense prescriptions' },
  'pharmacy.controlled': { module: 'Pharmacy', description: 'Dispense and log controlled medicines' },
  'inventory.view': { module: 'Inventory', description: 'View stock and batches' },
  'inventory.manage': { module: 'Inventory', description: 'Items, adjustments, transfers' },
  'purchasing.manage': { module: 'Inventory', description: 'Suppliers, purchase orders and goods receipts' },
  'purchasing.approve': { module: 'Inventory', description: 'Approve purchase orders' },

  // Emergency & IPD (Phase 3)
  'emergency.view': { module: 'Emergency', description: 'View the emergency board and cases' },
  'emergency.manage': { module: 'Emergency', description: 'Quick-register and triage emergency patients' },
  'emergency.treat': { module: 'Emergency', description: 'Take emergency cases, treat and record disposition' },
  'ipd.view': { module: 'IPD', description: 'View bed board and inpatients' },
  'ipd.manage': { module: 'IPD', description: 'Admit, transfer, reserve beds and update bed housekeeping' },
  'ipd.discharge': { module: 'IPD', description: 'Discharge inpatients and write discharge summaries' },
  'ipd.config': { module: 'IPD', description: 'Configure wards, rooms, beds and bed charges' },

  // Billing
  'billing.view': { module: 'Billing', description: 'View invoices and payments' },
  'billing.manage': { module: 'Billing', description: 'Create and issue invoices, add charges, cancel drafts' },
  'payments.receive': { module: 'Billing', description: 'Record payments and print receipts' },
  'refunds.process': { module: 'Billing', description: 'Process refunds' },
  'insurance.manage': { module: 'Billing', description: 'Manage insurance claims' },

  // HR (Phase 4)
  'hr.employees': { module: 'HR', description: 'Manage employees, contracts and performance' },
  'hr.attendance': { module: 'HR', description: 'Manage attendance' },
  'hr.leave.approve': { module: 'HR', description: 'Approve leave requests' },
  'payroll.manage': { module: 'Payroll', description: 'Salary structures and payroll runs' },
  'payroll.approve': { module: 'Payroll', description: 'Approve payroll runs prepared by someone else' },
  'recruitment.manage': { module: 'Recruitment', description: 'Jobs, candidates, interviews, offers' },
  'recruitment.approve': { module: 'Recruitment', description: 'Approve offer letters and hire candidates' },
  'self.service': { module: 'My workspace', description: 'Clock in/out, request leave, view own attendance and payslips' },

  // Reports
  'reports.clinical': { module: 'Reports', description: 'Clinical and operational reports' },
  'reports.financial': { module: 'Reports', description: 'Financial reports' },
  'reports.hr': { module: 'Reports', description: 'HR and payroll reports' },

  // Patient portal
  'portal.self': { module: 'Patient Portal', description: 'Access own appointments, prescriptions, results and invoices' },
} as const;

export type Permission = keyof typeof PERMISSIONS;
export const ALL_PERMISSIONS = Object.keys(PERMISSIONS) as Permission[];

export const SYSTEM_ROLES = {
  SUPER_ADMIN: 'Super Admin',
  HOSPITAL_ADMIN: 'Hospital Admin',
  RECEPTIONIST: 'Receptionist',
  NURSE: 'Nurse',
  DOCTOR: 'Doctor',
  LAB_TECHNICIAN: 'Lab Technician',
  PHARMACIST: 'Pharmacist',
  INVENTORY_MANAGER: 'Inventory Manager',
  ACCOUNTANT: 'Accountant',
  HR_MANAGER: 'HR Manager',
  PAYROLL_OFFICER: 'Payroll Officer',
  RECRUITMENT_OFFICER: 'Recruitment Officer',
  PATIENT: 'Patient',
  MANAGEMENT: 'Management',
} as const;

/** Default permission sets for seeded roles. Admins can change them at runtime. */
const BASE_ROLE_PERMISSIONS: Record<string, Permission[]> = {
  [SYSTEM_ROLES.SUPER_ADMIN]: ALL_PERMISSIONS.filter((p) => p !== 'portal.self'),
  [SYSTEM_ROLES.HOSPITAL_ADMIN]: ALL_PERMISSIONS.filter((p) => p !== 'portal.self' && p !== 'emr.view_all' && p !== 'clinical.notes.view'),
  [SYSTEM_ROLES.RECEPTIONIST]: [
    'patients.view', 'patients.create', 'patients.update', 'patients.documents',
    'appointments.view', 'appointments.manage', 'appointments.checkin',
    'staff.view', 'billing.view', 'ipd.view', 'ipd.manage', 'emergency.view', 'emergency.manage',
  ],
  [SYSTEM_ROLES.NURSE]: [
    'patients.view', 'appointments.view', 'nursing.queue', 'vitals.record', 'vitals.view',
    'emr.view', 'prescriptions.view', 'lab.results.view', 'staff.view', 'emergency.view', 'emergency.manage',
    'ipd.view', 'ipd.manage', 'medication.manage',
  ],
  [SYSTEM_ROLES.DOCTOR]: [
    'patients.view', 'appointments.view', 'vitals.view', 'emr.view', 'clinical.queue', 'clinical.consult',
    'clinical.notes.view', 'prescriptions.create', 'prescriptions.view', 'lab.order', 'lab.results.view',
    'patients.documents', 'staff.view', 'reports.clinical', 'emergency.view', 'emergency.treat', 'ipd.view', 'ipd.manage', 'ipd.discharge',
    'medication.manage',
  ],
  [SYSTEM_ROLES.LAB_TECHNICIAN]: ['patients.view', 'lab.process', 'lab.verify', 'lab.results.view', 'lab.manage'],
  [SYSTEM_ROLES.PHARMACIST]: ['patients.view', 'prescriptions.view', 'pharmacy.dispense', 'pharmacy.controlled', 'inventory.view', 'inventory.manage', 'medication.manage'],
  [SYSTEM_ROLES.INVENTORY_MANAGER]: ['inventory.view', 'inventory.manage', 'purchasing.manage', 'purchasing.approve'],
  [SYSTEM_ROLES.ACCOUNTANT]: [
    'patients.view', 'billing.view', 'billing.manage', 'payments.receive', 'refunds.process', 'insurance.manage', 'ipd.view',
    'dashboard.financial', 'reports.financial', 'services.manage',
  ],
  [SYSTEM_ROLES.HR_MANAGER]: [
    'hr.employees', 'hr.attendance', 'hr.leave.approve', 'reports.hr', 'staff.view', 'staff.manage', 'departments.manage',
    'payroll.approve', 'recruitment.manage', 'recruitment.approve',
  ],
  [SYSTEM_ROLES.PAYROLL_OFFICER]: ['payroll.manage', 'reports.hr', 'hr.attendance'],
  [SYSTEM_ROLES.RECRUITMENT_OFFICER]: ['recruitment.manage'],
  [SYSTEM_ROLES.PATIENT]: ['portal.self'],
  [SYSTEM_ROLES.MANAGEMENT]: ['dashboard.executive', 'dashboard.financial', 'reports.clinical', 'reports.financial', 'reports.hr'],
};

/** Every staff role gets self-service (own attendance, leave, payslips); patients never do. */
export const DEFAULT_ROLE_PERMISSIONS: Record<string, Permission[]> = Object.fromEntries(
  Object.entries(BASE_ROLE_PERMISSIONS).map(([role, perms]) => [
    role,
    role === SYSTEM_ROLES.PATIENT || perms.includes('self.service') ? perms : [...perms, 'self.service' as Permission],
  ]),
);
