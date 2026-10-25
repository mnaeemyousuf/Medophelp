import { Navigate, Route, Routes } from 'react-router-dom';
import type { Permission } from '@hms/shared';
import { Layout } from './Layout';
import { RequireAuth, RequirePermission } from './guards';
import { ChangePasswordPage, ForgotPasswordPage, LoginPage, ResetPasswordPage } from '@/pages/auth';
import { lazy, type ComponentType } from 'react';
import { NotFoundPage } from '@/pages/errors';

/** Route-level code splitting: each module's pages load on first visit. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const page = <M,>(load: () => Promise<M>, name: keyof M) => lazy(() => load().then((m) => ({ default: m[name] as unknown as ComponentType<any> })));
const patients = () => import('@/pages/patients/PatientsPage');
const register = () => import('@/pages/patients/RegisterPatientPage');
const profile = () => import('@/pages/patients/PatientProfilePage');
const appointments = () => import('@/pages/appointments/AppointmentsPage');
const nursing = () => import('@/pages/clinical/NursingPages');
const doctor = () => import('@/pages/clinical/DoctorPages');
const billing = () => import('@/pages/billing/BillingPages');
const usersRoles = () => import('@/pages/admin/UsersRolesPages');
const config = () => import('@/pages/admin/ConfigPages');
const labs = () => import('@/pages/laboratory/LabPages');
const pharmacy = () => import('@/pages/pharmacy/PharmacyPages');
const inventory = () => import('@/pages/inventory/InventoryPages');
const purchasing = () => import('@/pages/purchasing/PurchasingPages');

const DashboardPage = page(() => import('@/pages/dashboard/DashboardPage'), 'DashboardPage');
const PatientsPage = page(patients, 'PatientsPage');
const RegisterPatientPage = page(register, 'RegisterPatientPage');
const PatientProfilePage = page(profile, 'PatientProfilePage');
const AppointmentsPage = page(appointments, 'AppointmentsPage');
const NursingQueuePage = page(nursing, 'NursingQueuePage');
const NursingAssessmentPage = page(nursing, 'NursingAssessmentPage');
const DoctorQueuePage = page(doctor, 'DoctorQueuePage');
const ConsultationPage = page(doctor, 'ConsultationPage');
const InvoicesPage = page(billing, 'InvoicesPage');
const InvoiceDetailPage = page(billing, 'InvoiceDetailPage');
const UsersPage = page(usersRoles, 'UsersPage');
const RolesPage = page(usersRoles, 'RolesPage');
const StaffPage = page(config, 'StaffPage');
const DepartmentsServicesPage = page(config, 'DepartmentsServicesPage');
const HospitalSettingsPage = page(config, 'HospitalSettingsPage');
const AuditLogPage = page(config, 'AuditLogPage');
const LabWorklistPage = page(labs, 'LabWorklistPage');
const LabTestsPage = page(labs, 'LabTestsPage');
const LabOrderPage = page(labs, 'LabOrderPage');
const PharmacyPage = page(pharmacy, 'PharmacyPage');
const DispensePage = page(pharmacy, 'DispensePage');
const InventoryPage = page(inventory, 'InventoryPage');
const ItemDetailPage = page(inventory, 'ItemDetailPage');
const PurchasingPage = page(purchasing, 'PurchasingPage');
const PurchaseOrderPage = page(purchasing, 'PurchaseOrderPage');
const emergency = () => import('@/pages/emergency/EmergencyPages');
const ipd = () => import('@/pages/ipd/IpdPages');
const insurance = () => import('@/pages/insurance/InsurancePages');
const EmergencyBoardPage = page(emergency, 'EmergencyBoardPage');
const EmergencyCasePage = page(emergency, 'EmergencyCasePage');
const IpdPage = page(ipd, 'IpdPage');
const AdmissionPage = page(ipd, 'AdmissionPage');
const WardSetupPage = page(ipd, 'WardSetupPage');
const ClaimsPage = page(insurance, 'ClaimsPage');
const ClaimPage = page(insurance, 'ClaimPage');
const hr = () => import('@/pages/hr/HrPages');
const payroll = () => import('@/pages/payroll/PayrollPages');
const recruitment = () => import('@/pages/recruitment/RecruitmentPages');
const HrPage = page(hr, 'HrPage');
const EmployeeProfilePage = page(hr, 'EmployeeProfilePage');
const LeaveApprovalsPage = page(hr, 'LeaveApprovalsPage');
const MyWorkspacePage = page(() => import('@/pages/hr/MyWorkspacePage'), 'MyWorkspacePage');
const PayrollPage = page(payroll, 'PayrollPage');
const PayrollRunPage = page(payroll, 'PayrollRunPage');
const RecruitmentPage = page(recruitment, 'RecruitmentPage');
const CandidatePage = page(recruitment, 'CandidatePage');
const PurchaseRequestsPage = page(() => import('@/pages/purchasing/PurchaseRequestsPage'), 'PurchaseRequestsPage');
const ReportsPage = page(() => import('@/pages/reports/ReportsPage'), 'ReportsPage');
const MyMedicinesPage = page(() => import('@/pages/medication/MedicationPages'), 'MyMedicinesPage');
const NotificationsPage = page(() => import('@/pages/NotificationsPage'), 'NotificationsPage');

const guard = (anyOf: Permission[], el: JSX.Element) => <RequirePermission anyOf={anyOf}>{el}</RequirePermission>;

export function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/forgot-password" element={<ForgotPasswordPage />} />
      <Route path="/reset-password" element={<ResetPasswordPage />} />
      <Route
        element={
          <RequireAuth>
            <Layout />
          </RequireAuth>
        }
      >
        <Route index element={<Navigate to="/dashboard" replace />} />
        <Route path="/dashboard" element={<DashboardPage />} />
        <Route path="/account/password" element={<ChangePasswordPage />} />

        <Route path="/patients" element={guard(['patients.view'], <PatientsPage />)} />
        <Route path="/patients/new" element={guard(['patients.create'], <RegisterPatientPage />)} />
        <Route path="/patients/:id" element={guard(['patients.view'], <PatientProfilePage />)} />
        <Route path="/appointments" element={guard(['appointments.view'], <AppointmentsPage />)} />

        <Route path="/nursing" element={guard(['nursing.queue'], <NursingQueuePage />)} />
        <Route path="/nursing/assess/:id" element={guard(['vitals.record'], <NursingAssessmentPage />)} />
        <Route path="/doctor" element={guard(['clinical.queue'], <DoctorQueuePage />)} />
        <Route path="/doctor/consult/:id" element={guard(['clinical.consult'], <ConsultationPage />)} />

        <Route path="/laboratory" element={guard(['lab.process', 'lab.verify', 'lab.manage'], <LabWorklistPage />)} />
        <Route path="/laboratory/tests" element={guard(['lab.manage'], <LabTestsPage />)} />
        <Route path="/laboratory/orders/:id" element={guard(['lab.process', 'lab.verify', 'lab.results.view', 'portal.self'], <LabOrderPage />)} />
        <Route path="/pharmacy" element={guard(['pharmacy.dispense'], <PharmacyPage />)} />
        <Route path="/pharmacy/dispense/:id" element={guard(['pharmacy.dispense'], <DispensePage />)} />
        <Route path="/inventory" element={guard(['inventory.view'], <InventoryPage />)} />
        <Route path="/inventory/items/:id" element={guard(['inventory.view'], <ItemDetailPage />)} />
        <Route path="/purchasing" element={guard(['purchasing.manage', 'purchasing.approve'], <PurchasingPage />)} />
        <Route path="/purchasing/requests" element={guard(['inventory.manage', 'pharmacy.dispense', 'purchasing.manage', 'purchasing.approve'], <PurchaseRequestsPage />)} />
        <Route path="/purchasing/orders/:id" element={guard(['purchasing.manage', 'purchasing.approve'], <PurchaseOrderPage />)} />

        <Route path="/emergency" element={guard(['emergency.view'], <EmergencyBoardPage />)} />
        <Route path="/emergency/:id" element={guard(['emergency.view'], <EmergencyCasePage />)} />
        <Route path="/ipd" element={guard(['ipd.view'], <IpdPage />)} />
        <Route path="/ipd/setup" element={guard(['ipd.config'], <WardSetupPage />)} />
        <Route path="/ipd/admissions/:id" element={guard(['ipd.view'], <AdmissionPage />)} />
        <Route path="/insurance" element={guard(['insurance.manage'], <ClaimsPage />)} />
        <Route path="/insurance/claims/:id" element={guard(['insurance.manage'], <ClaimPage />)} />

        <Route path="/me" element={guard(['self.service'], <MyWorkspacePage />)} />
        <Route path="/hr" element={guard(['hr.employees', 'hr.attendance'], <HrPage />)} />
        <Route path="/hr/employees/:id" element={guard(['hr.employees', 'hr.attendance', 'payroll.manage'], <EmployeeProfilePage />)} />
        <Route path="/hr/employees" element={<Navigate to="/hr?tab=employees" replace />} />
        <Route path="/payroll/runs" element={<Navigate to="/payroll" replace />} />
        <Route path="/recruitment/candidates" element={<Navigate to="/recruitment?tab=candidates" replace />} />
        <Route path="/hr/leave" element={guard(['hr.leave.approve'], <LeaveApprovalsPage />)} />
        <Route path="/payroll" element={guard(['payroll.manage', 'payroll.approve'], <PayrollPage />)} />
        <Route path="/payroll/runs/:id" element={guard(['payroll.manage', 'payroll.approve'], <PayrollRunPage />)} />
        <Route path="/recruitment" element={guard(['recruitment.manage', 'recruitment.approve'], <RecruitmentPage />)} />
        <Route path="/recruitment/candidates/:id" element={guard(['recruitment.manage', 'recruitment.approve'], <CandidatePage />)} />

        <Route path="/billing" element={guard(['billing.view'], <InvoicesPage />)} />
        <Route path="/billing/invoices/:id" element={guard(['billing.view'], <InvoiceDetailPage />)} />

        <Route path="/portal/appointments" element={guard(['portal.self'], <AppointmentsPage portal />)} />
        <Route path="/portal/medications" element={guard(['portal.self'], <MyMedicinesPage />)} />
        <Route path="/reports" element={<ReportsPage />} />
        <Route path="/notifications" element={<NotificationsPage />} />
        <Route path="/portal/records" element={guard(['portal.self'], <PatientProfilePage portal />)} />
        <Route path="/portal/bills" element={guard(['portal.self'], <InvoicesPage portal />)} />

        <Route path="/admin/users" element={guard(['users.view', 'users.manage'], <UsersPage />)} />
        <Route path="/admin/roles" element={guard(['roles.manage'], <RolesPage />)} />
        <Route path="/admin/staff" element={guard(['staff.view', 'staff.manage'], <StaffPage />)} />
        <Route path="/admin/departments" element={guard(['departments.manage', 'services.manage'], <DepartmentsServicesPage />)} />
        <Route path="/admin/settings" element={guard(['system.config'], <HospitalSettingsPage />)} />
        <Route path="/audit" element={guard(['audit.view'], <AuditLogPage />)} />
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  );
}
