# Role & Permission Matrix

Generated 2026-10-17 from `shared/src/permissions.ts` (default role permissions) and `client/src/app/nav.ts` (menus) by `tools/manuals/role-matrix.mjs`. Administrators can change role permissions at runtime; this file documents the seeded defaults. Every permission is enforced by the API (`requirePermission` on each route) — hiding menus is only a convenience.

## Roles in the system

The application has exactly the 14 roles required by the specification (§3). There are no separate HR Executive, Procurement Officer or Lab Manager roles; those responsibilities are combined as shown below. Every staff role also has `self.service` (My workspace).

| # | Role | Demo account | Manual | Combined responsibilities |
|---|---|---|---|---|
| 1 | Super Admin | superadmin@hospital.com | `deliverables/user_manuals/01_Super_Admin_User_Manual.pdf` | Super Admin has all permissions except the patient-portal permission. It is the only role that, by default, can read every patient’s clinical record (emr.view_all) and doctors’ clinical notes in addition to configuration. |
| 2 | Hospital Admin | admin@hospital.com | `deliverables/user_manuals/02_Hospital_Admin_User_Manual.pdf` | Hospital Admin has every staff permission except reading all patients’ clinical records (emr.view_all) and doctors’ clinical notes (clinical.notes.view), which are reserved for clinicians and the Super Admin. |
| 3 | Receptionist | reception@hospital.com | `deliverables/user_manuals/03_Receptionist_User_Manual.pdf` | — |
| 4 | Nurse | nurse@hospital.com | `deliverables/user_manuals/04_Nurse_User_Manual.pdf` | — |
| 5 | Doctor | doctor@hospital.com | `deliverables/user_manuals/05_Doctor_User_Manual.pdf` | — |
| 6 | Lab Technician | lab@hospital.com | `deliverables/user_manuals/06_Lab_Technician_User_Manual.pdf` | There is no separate Lab Manager or Lab Supervisor role: the Lab Technician role includes processing (lab.process), verification (lab.verify) and catalogue management (lab.manage). The two-person rule is enforced per order — the person who entered results can never verify them. The demonstration account labsupervisor@hospital.com has the same role and is used as the second person. |
| 7 | Pharmacist | pharmacy@hospital.com | `deliverables/user_manuals/07_Pharmacist_User_Manual.pdf` | — |
| 8 | Inventory Manager | inventory@hospital.com | `deliverables/user_manuals/08_Inventory_Procurement_User_Manual.pdf` | There is no separate Procurement Officer role: the Inventory Manager role holds both inventory (inventory.view/manage) and procurement (purchasing.manage/approve). Approvals still require a second person — you cannot approve a request or purchase order you raised. |
| 9 | Accountant | accounts@hospital.com | `deliverables/user_manuals/09_Accountant_User_Manual.pdf` | — |
| 10 | HR Manager | hr@hospital.com | `deliverables/user_manuals/10_HR_Manager_User_Manual.pdf` | There is no separate HR Executive role. The HR Manager role also approves payroll (payroll.approve) and recruitment offers/hiring (recruitment.approve), and can run recruitment itself. |
| 11 | Payroll Officer | payroll@hospital.com | `deliverables/user_manuals/11_Payroll_Officer_User_Manual.pdf` | — |
| 12 | Recruitment Officer | recruitment@hospital.com | `deliverables/user_manuals/12_Recruitment_Officer_User_Manual.pdf` | — |
| 13 | Patient | patient@hospital.com | `deliverables/user_manuals/13_Patient_Portal_User_Manual.pdf` | — |
| 14 | Management | management@hospital.com | `deliverables/user_manuals/14_Management_Reporting_User_Manual.pdf` | — |

## Permission grid

Legend: SA = Super Admin, HA = Hospital Admin, REC = Receptionist, NUR = Nurse, DOC = Doctor, LAB = Lab Technician, PHA = Pharmacist, INV = Inventory Manager, ACC = Accountant, HR = HR Manager, PAY = Payroll Officer, RCT = Recruitment Officer, PAT = Patient, MGT = Management.

| Module | Permission | SA | HA | REC | NUR | DOC | LAB | PHA | INV | ACC | HR | PAY | RCT | PAT | MGT |
|---|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| Administration | `system.config` — Manage hospital configuration, numbering, tax and notification settings | ✔ | ✔ |  |  |  |  |  |  |  |  |  |  |  |  |
| Administration | `departments.manage` — Create and edit departments | ✔ | ✔ |  |  |  |  |  |  |  | ✔ |  |  |  |  |
| Administration | `services.manage` — Manage billable services and prices | ✔ | ✔ |  |  |  |  |  |  | ✔ |  |  |  |  |  |
| Administration | `users.view` — View user accounts | ✔ | ✔ |  |  |  |  |  |  |  |  |  |  |  |  |
| Administration | `users.manage` — Create, edit, deactivate users and reset passwords | ✔ | ✔ |  |  |  |  |  |  |  |  |  |  |  |  |
| Administration | `roles.manage` — Create roles and change role permissions | ✔ | ✔ |  |  |  |  |  |  |  |  |  |  |  |  |
| Administration | `audit.view` — Read the audit log | ✔ | ✔ |  |  |  |  |  |  |  |  |  |  |  |  |
| Administration | `staff.view` — View doctors and nurses directory | ✔ | ✔ | ✔ | ✔ | ✔ |  |  |  |  | ✔ |  |  |  |  |
| Administration | `staff.manage` — Create and edit doctor and nurse profiles | ✔ | ✔ |  |  |  |  |  |  |  | ✔ |  |  |  |  |
| Dashboards | `dashboard.executive` — Hospital-wide KPIs and charts | ✔ | ✔ |  |  |  |  |  |  |  |  |  |  |  | ✔ |
| Dashboards | `dashboard.financial` — Revenue and outstanding figures | ✔ | ✔ |  |  |  |  |  |  | ✔ |  |  |  |  | ✔ |
| Patients | `patients.view` — Search and view patient demographics | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ |  | ✔ |  |  |  |  |  |
| Patients | `patients.create` — Register patients | ✔ | ✔ | ✔ |  |  |  |  |  |  |  |  |  |  |  |
| Patients | `patients.update` — Edit patient demographics, insurance, allergies and history | ✔ | ✔ | ✔ |  |  |  |  |  |  |  |  |  |  |  |
| Patients | `patients.documents` — Upload and download patient documents | ✔ | ✔ | ✔ |  | ✔ |  |  |  |  |  |  |  |  |  |
| Appointments | `appointments.view` — View appointment calendar and lists | ✔ | ✔ | ✔ | ✔ | ✔ |  |  |  |  |  |  |  |  |  |
| Appointments | `appointments.manage` — Book, reschedule, cancel and mark no-show | ✔ | ✔ | ✔ |  |  |  |  |  |  |  |  |  |  |  |
| Appointments | `appointments.checkin` — Check patients in | ✔ | ✔ | ✔ |  |  |  |  |  |  |  |  |  |  |  |
| Nursing | `nursing.queue` — View the nursing assessment queue | ✔ | ✔ |  | ✔ |  |  |  |  |  |  |  |  |  |  |
| Nursing | `vitals.record` — Record vital signs and submit nursing assessments | ✔ | ✔ |  | ✔ |  |  |  |  |  |  |  |  |  |  |
| Nursing | `vitals.view` — View vital sign history | ✔ | ✔ |  | ✔ | ✔ |  |  |  |  |  |  |  |  |  |
| Clinical | `emr.view` — View EMR of patients under the user's care | ✔ | ✔ |  | ✔ | ✔ |  |  |  |  |  |  |  |  |  |
| Clinical | `emr.view_all` — View EMR of any patient in the hospital | ✔ |  |  |  |  |  |  |  |  |  |  |  |  |  |
| Clinical | `clinical.queue` — View doctor consultation queue | ✔ | ✔ |  |  | ✔ |  |  |  |  |  |  |  |  |  |
| Clinical | `clinical.consult` — Start/complete consultations, write notes, diagnoses and treatment plans | ✔ | ✔ |  |  | ✔ |  |  |  |  |  |  |  |  |  |
| Clinical | `clinical.notes.view` — Read doctor clinical notes | ✔ |  |  |  | ✔ |  |  |  |  |  |  |  |  |  |
| Clinical | `prescriptions.create` — Create and cancel prescriptions | ✔ | ✔ |  |  | ✔ |  |  |  |  |  |  |  |  |  |
| Clinical | `prescriptions.view` — View prescriptions | ✔ | ✔ |  | ✔ | ✔ |  | ✔ |  |  |  |  |  |  |  |
| Clinical | `lab.order` — Order laboratory tests | ✔ | ✔ |  |  | ✔ |  |  |  |  |  |  |  |  |  |
| Clinical | `lab.results.view` — View laboratory results | ✔ | ✔ |  | ✔ | ✔ | ✔ |  |  |  |  |  |  |  |  |
| Clinical | `medication.manage` — View medication adherence, record doses for patients, stop schedules | ✔ | ✔ |  | ✔ | ✔ |  | ✔ |  |  |  |  |  |  |  |
| Laboratory | `lab.process` — Collect samples, enter results | ✔ | ✔ |  |  |  | ✔ |  |  |  |  |  |  |  |  |
| Laboratory | `lab.verify` — Verify lab results | ✔ | ✔ |  |  |  | ✔ |  |  |  |  |  |  |  |  |
| Laboratory | `lab.manage` — Manage lab test master and pricing | ✔ | ✔ |  |  |  | ✔ |  |  |  |  |  |  |  |  |
| Pharmacy | `pharmacy.dispense` — Dispense prescriptions | ✔ | ✔ |  |  |  |  | ✔ |  |  |  |  |  |  |  |
| Pharmacy | `pharmacy.controlled` — Dispense and log controlled medicines | ✔ | ✔ |  |  |  |  | ✔ |  |  |  |  |  |  |  |
| Inventory | `inventory.view` — View stock and batches | ✔ | ✔ |  |  |  |  | ✔ | ✔ |  |  |  |  |  |  |
| Inventory | `inventory.manage` — Items, adjustments, transfers | ✔ | ✔ |  |  |  |  | ✔ | ✔ |  |  |  |  |  |  |
| Inventory | `purchasing.manage` — Suppliers, purchase orders and goods receipts | ✔ | ✔ |  |  |  |  |  | ✔ |  |  |  |  |  |  |
| Inventory | `purchasing.approve` — Approve purchase orders | ✔ | ✔ |  |  |  |  |  | ✔ |  |  |  |  |  |  |
| Emergency | `emergency.view` — View the emergency board and cases | ✔ | ✔ | ✔ | ✔ | ✔ |  |  |  |  |  |  |  |  |  |
| Emergency | `emergency.manage` — Quick-register and triage emergency patients | ✔ | ✔ | ✔ | ✔ |  |  |  |  |  |  |  |  |  |  |
| Emergency | `emergency.treat` — Take emergency cases, treat and record disposition | ✔ | ✔ |  |  | ✔ |  |  |  |  |  |  |  |  |  |
| IPD | `ipd.view` — View bed board and inpatients | ✔ | ✔ | ✔ | ✔ | ✔ |  |  |  | ✔ |  |  |  |  |  |
| IPD | `ipd.manage` — Admit, transfer, reserve beds and update bed housekeeping | ✔ | ✔ | ✔ | ✔ | ✔ |  |  |  |  |  |  |  |  |  |
| IPD | `ipd.discharge` — Discharge inpatients and write discharge summaries | ✔ | ✔ |  |  | ✔ |  |  |  |  |  |  |  |  |  |
| IPD | `ipd.config` — Configure wards, rooms, beds and bed charges | ✔ | ✔ |  |  |  |  |  |  |  |  |  |  |  |  |
| Billing | `billing.view` — View invoices and payments | ✔ | ✔ | ✔ |  |  |  |  |  | ✔ |  |  |  |  |  |
| Billing | `billing.manage` — Create and issue invoices, add charges, cancel drafts | ✔ | ✔ |  |  |  |  |  |  | ✔ |  |  |  |  |  |
| Billing | `payments.receive` — Record payments and print receipts | ✔ | ✔ |  |  |  |  |  |  | ✔ |  |  |  |  |  |
| Billing | `refunds.process` — Process refunds | ✔ | ✔ |  |  |  |  |  |  | ✔ |  |  |  |  |  |
| Billing | `insurance.manage` — Manage insurance claims | ✔ | ✔ |  |  |  |  |  |  | ✔ |  |  |  |  |  |
| HR | `hr.employees` — Manage employees, contracts and performance | ✔ | ✔ |  |  |  |  |  |  |  | ✔ |  |  |  |  |
| HR | `hr.attendance` — Manage attendance | ✔ | ✔ |  |  |  |  |  |  |  | ✔ | ✔ |  |  |  |
| HR | `hr.leave.approve` — Approve leave requests | ✔ | ✔ |  |  |  |  |  |  |  | ✔ |  |  |  |  |
| Payroll | `payroll.manage` — Salary structures and payroll runs | ✔ | ✔ |  |  |  |  |  |  |  |  | ✔ |  |  |  |
| Payroll | `payroll.approve` — Approve payroll runs prepared by someone else | ✔ | ✔ |  |  |  |  |  |  |  | ✔ |  |  |  |  |
| Recruitment | `recruitment.manage` — Jobs, candidates, interviews, offers | ✔ | ✔ |  |  |  |  |  |  |  | ✔ |  | ✔ |  |  |
| Recruitment | `recruitment.approve` — Approve offer letters and hire candidates | ✔ | ✔ |  |  |  |  |  |  |  | ✔ |  |  |  |  |
| My workspace | `self.service` — Clock in/out, request leave, view own attendance and payslips | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ |  | ✔ |
| Reports | `reports.clinical` — Clinical and operational reports | ✔ | ✔ |  |  | ✔ |  |  |  |  |  |  |  |  | ✔ |
| Reports | `reports.financial` — Financial reports | ✔ | ✔ |  |  |  |  |  |  | ✔ |  |  |  |  | ✔ |
| Reports | `reports.hr` — HR and payroll reports | ✔ | ✔ |  |  |  |  |  |  |  | ✔ | ✔ |  |  | ✔ |
| Patient Portal | `portal.self` — Access own appointments, prescriptions, results and invoices |  |  |  |  |  |  |  |  |  |  |  |  | ✔ |  |

## Per-role detail

### 1. Super Admin

* **Dashboard:** Executive dashboard: patients, appointments, admissions, revenue, outstanding, stock value, staff on duty and charts.
* **Menus / screens:** Overview: Dashboard (`/dashboard`); Patient care: Patients (`/patients`), Appointments (`/appointments`), Nursing queue (`/nursing`), My consultations (`/doctor`), Emergency (`/emergency`), Admissions / IPD (`/ipd`); Diagnostics & pharmacy: Laboratory (`/laboratory`), Pharmacy (`/pharmacy`), Inventory (`/inventory`), Purchase requests (`/purchasing/requests`), Purchase orders (`/purchasing`); Finance: Billing (`/billing`), Insurance claims (`/insurance`); People: My workspace (`/me`), HR & attendance (`/hr`), Leave approvals (`/hr/leave`), Payroll (`/payroll`), Recruitment (`/recruitment`); Administration: Reports (`/reports`), Users (`/admin/users`), Roles & permissions (`/admin/roles`), Doctors & nurses (`/admin/staff`), Departments & services (`/admin/departments`), Hospital settings (`/admin/settings`), Audit log (`/audit`)
* **Modules (by permission):** Administration, Dashboards, Patients, Appointments, Nursing, Clinical, Laboratory, Pharmacy, Inventory, Emergency, IPD, Billing, HR, Payroll, Recruitment, My workspace, Reports
* **Permitted actions:** Manage hospital configuration, numbering, tax and notification settings; Create and edit departments; Manage billable services and prices; View user accounts; Create, edit, deactivate users and reset passwords; Create roles and change role permissions; Read the audit log; View doctors and nurses directory; Create and edit doctor and nurse profiles; Hospital-wide KPIs and charts; Revenue and outstanding figures; Search and view patient demographics; Register patients; Edit patient demographics, insurance, allergies and history; Upload and download patient documents; View appointment calendar and lists; Book, reschedule, cancel and mark no-show; Check patients in; View the nursing assessment queue; Record vital signs and submit nursing assessments; View vital sign history; View EMR of patients under the user's care; View EMR of any patient in the hospital; View doctor consultation queue; Start/complete consultations, write notes, diagnoses and treatment plans; Read doctor clinical notes; Create and cancel prescriptions; View prescriptions; Order laboratory tests; View laboratory results; View medication adherence, record doses for patients, stop schedules; Collect samples, enter results; Verify lab results; Manage lab test master and pricing; Dispense prescriptions; Dispense and log controlled medicines; View stock and batches; Items, adjustments, transfers; Suppliers, purchase orders and goods receipts; Approve purchase orders; View the emergency board and cases; Quick-register and triage emergency patients; Take emergency cases, treat and record disposition; View bed board and inpatients; Admit, transfer, reserve beds and update bed housekeeping; Discharge inpatients and write discharge summaries; Configure wards, rooms, beds and bed charges; View invoices and payments; Create and issue invoices, add charges, cancel drafts; Record payments and print receipts; Process refunds; Manage insurance claims; Manage employees, contracts and performance; Manage attendance; Approve leave requests; Salary structures and payroll runs; Approve payroll runs prepared by someone else; Jobs, candidates, interviews, offers; Approve offer letters and hire candidates; Clock in/out, request leave, view own attendance and payslips; Clinical and operational reports; Financial reports; HR and payroll reports.
* **Restricted actions:** Everything not listed above is refused by the API with 403.
* **Approvals:** Can act as second approver for purchase requests/POs, payroll, offers and lab verification (two-person rules still apply: never their own item).
* **Reports:** Patient inflow, Patient demographics, OPD / IPD statistics, Doctor appointments, Lab turnaround time, Emergency response time, Medication adherence, Revenue by department, Revenue by doctor, Outstanding payments, Insurance claims, Pharmacy stock, Medicine expiry, Purchase report, Staff attendance, Payroll summary, Leave summary
* **Sensitive data access:** All patient demographics and clinical records (emr.view_all, clinical notes), payroll and salary data, audit log.
* **Notifications received:** Purchase approvals, low-stock/expiry alerts, emergency critical alerts (as staff with the relevant permissions).

### 2. Hospital Admin

* **Dashboard:** Hospital overview dashboard with KPIs and charts.
* **Menus / screens:** Overview: Dashboard (`/dashboard`); Patient care: Patients (`/patients`), Appointments (`/appointments`), Nursing queue (`/nursing`), My consultations (`/doctor`), Emergency (`/emergency`), Admissions / IPD (`/ipd`); Diagnostics & pharmacy: Laboratory (`/laboratory`), Pharmacy (`/pharmacy`), Inventory (`/inventory`), Purchase requests (`/purchasing/requests`), Purchase orders (`/purchasing`); Finance: Billing (`/billing`), Insurance claims (`/insurance`); People: My workspace (`/me`), HR & attendance (`/hr`), Leave approvals (`/hr/leave`), Payroll (`/payroll`), Recruitment (`/recruitment`); Administration: Reports (`/reports`), Users (`/admin/users`), Roles & permissions (`/admin/roles`), Doctors & nurses (`/admin/staff`), Departments & services (`/admin/departments`), Hospital settings (`/admin/settings`), Audit log (`/audit`)
* **Modules (by permission):** Administration, Dashboards, Patients, Appointments, Nursing, Clinical, Laboratory, Pharmacy, Inventory, Emergency, IPD, Billing, HR, Payroll, Recruitment, My workspace, Reports
* **Permitted actions:** Manage hospital configuration, numbering, tax and notification settings; Create and edit departments; Manage billable services and prices; View user accounts; Create, edit, deactivate users and reset passwords; Create roles and change role permissions; Read the audit log; View doctors and nurses directory; Create and edit doctor and nurse profiles; Hospital-wide KPIs and charts; Revenue and outstanding figures; Search and view patient demographics; Register patients; Edit patient demographics, insurance, allergies and history; Upload and download patient documents; View appointment calendar and lists; Book, reschedule, cancel and mark no-show; Check patients in; View the nursing assessment queue; Record vital signs and submit nursing assessments; View vital sign history; View EMR of patients under the user's care; View doctor consultation queue; Start/complete consultations, write notes, diagnoses and treatment plans; Create and cancel prescriptions; View prescriptions; Order laboratory tests; View laboratory results; View medication adherence, record doses for patients, stop schedules; Collect samples, enter results; Verify lab results; Manage lab test master and pricing; Dispense prescriptions; Dispense and log controlled medicines; View stock and batches; Items, adjustments, transfers; Suppliers, purchase orders and goods receipts; Approve purchase orders; View the emergency board and cases; Quick-register and triage emergency patients; Take emergency cases, treat and record disposition; View bed board and inpatients; Admit, transfer, reserve beds and update bed housekeeping; Discharge inpatients and write discharge summaries; Configure wards, rooms, beds and bed charges; View invoices and payments; Create and issue invoices, add charges, cancel drafts; Record payments and print receipts; Process refunds; Manage insurance claims; Manage employees, contracts and performance; Manage attendance; Approve leave requests; Salary structures and payroll runs; Approve payroll runs prepared by someone else; Jobs, candidates, interviews, offers; Approve offer letters and hire candidates; Clock in/out, request leave, view own attendance and payslips; Clinical and operational reports; Financial reports; HR and payroll reports.
* **Restricted actions:** Everything not listed above is refused by the API with 403.
* **Approvals:** Same as Super Admin for operational approvals.
* **Reports:** Patient inflow, Patient demographics, OPD / IPD statistics, Doctor appointments, Lab turnaround time, Emergency response time, Medication adherence, Revenue by department, Revenue by doctor, Outstanding payments, Insurance claims, Pharmacy stock, Medicine expiry, Purchase report, Staff attendance, Payroll summary, Leave summary
* **Sensitive data access:** Patient demographics, billing, HR and payroll data, audit log. Not other doctors’ clinical notes or all-patient EMR.
* **Notifications received:** Purchase approvals, stock alerts.

### 3. Receptionist

* **Dashboard:** Front desk dashboard: today’s appointments, check-ins and quick actions.
* **Menus / screens:** Overview: Dashboard (`/dashboard`); Patient care: Patients (`/patients`), Appointments (`/appointments`), Emergency (`/emergency`), Admissions / IPD (`/ipd`); Finance: Billing (`/billing`); People: My workspace (`/me`); Administration: Reports (`/reports`), Doctors & nurses (`/admin/staff`)
* **Modules (by permission):** Patients, Appointments, Administration, Billing, IPD, Emergency, My workspace
* **Permitted actions:** Search and view patient demographics; Register patients; Edit patient demographics, insurance, allergies and history; Upload and download patient documents; View appointment calendar and lists; Book, reschedule, cancel and mark no-show; Check patients in; View doctors and nurses directory; View invoices and payments; View bed board and inpatients; Admit, transfer, reserve beds and update bed housekeeping; View the emergency board and cases; Quick-register and triage emergency patients; Clock in/out, request leave, view own attendance and payslips.
* **Restricted actions:** Receptionists cannot see clinical notes or vitals (“Not available for your role” on the profile), cannot record refunds and cannot dispense or enter results.
* **Approvals:** None.
* **Reports:** Emergency response time, Outstanding payments
* **Sensitive data access:** Patient demographics, CNIC, contact details, insurance, invoices (read). No vitals or clinical notes.
* **Notifications received:** Leave decisions (own).

### 4. Nurse

* **Dashboard:** Nurse dashboard: patients waiting for assessment.
* **Menus / screens:** Overview: Dashboard (`/dashboard`); Patient care: Patients (`/patients`), Appointments (`/appointments`), Nursing queue (`/nursing`), Emergency (`/emergency`), Admissions / IPD (`/ipd`); People: My workspace (`/me`); Administration: Reports (`/reports`), Doctors & nurses (`/admin/staff`)
* **Modules (by permission):** Patients, Appointments, Nursing, Clinical, Administration, Emergency, IPD, My workspace
* **Permitted actions:** Search and view patient demographics; View appointment calendar and lists; View the nursing assessment queue; Record vital signs and submit nursing assessments; View vital sign history; View EMR of patients under the user's care; View prescriptions; View laboratory results; View doctors and nurses directory; View the emergency board and cases; Quick-register and triage emergency patients; View bed board and inpatients; Admit, transfer, reserve beds and update bed housekeeping; View medication adherence, record doses for patients, stop schedules; Clock in/out, request leave, view own attendance and payslips.
* **Restricted actions:** Nurses cannot write prescriptions, order tests, dispense, or edit doctors’ notes.
* **Approvals:** Team leave approval only if set as reporting manager (head nurse).
* **Reports:** Emergency response time, Medication adherence
* **Sensitive data access:** Clinical data of patients under care: vitals, prescriptions, lab results.
* **Notifications received:** Emergency alerts, missed-dose alerts for inpatients, leave decisions.

### 5. Doctor

* **Dashboard:** Doctor dashboard: today’s clinic, results to review and emergency alerts.
* **Menus / screens:** Overview: Dashboard (`/dashboard`); Patient care: Patients (`/patients`), Appointments (`/appointments`), My consultations (`/doctor`), Emergency (`/emergency`), Admissions / IPD (`/ipd`); People: My workspace (`/me`); Administration: Reports (`/reports`), Doctors & nurses (`/admin/staff`)
* **Modules (by permission):** Patients, Appointments, Nursing, Clinical, Administration, Reports, Emergency, IPD, My workspace
* **Permitted actions:** Search and view patient demographics; View appointment calendar and lists; View vital sign history; View EMR of patients under the user's care; View doctor consultation queue; Start/complete consultations, write notes, diagnoses and treatment plans; Read doctor clinical notes; Create and cancel prescriptions; View prescriptions; Order laboratory tests; View laboratory results; Upload and download patient documents; View doctors and nurses directory; Clinical and operational reports; View the emergency board and cases; Take emergency cases, treat and record disposition; View bed board and inpatients; Admit, transfer, reserve beds and update bed housekeeping; Discharge inpatients and write discharge summaries; View medication adherence, record doses for patients, stop schedules; Clock in/out, request leave, view own attendance and payslips.
* **Restricted actions:** Doctors can document only their own visits; other doctors’ visits are read-only. Doctors cannot verify lab results or dispense.
* **Approvals:** Discharge of own inpatients; review of verified lab results.
* **Reports:** Patient inflow, Patient demographics, OPD / IPD statistics, Doctor appointments, Lab turnaround time, Emergency response time, Medication adherence
* **Sensitive data access:** Full EMR of patients under their care, clinical notes.
* **Notifications received:** Patient ready (after nursing), lab result available / critical, emergency alerts, missed-dose alerts, leave decisions.

### 6. Lab Technician

* **Dashboard:** Laboratory dashboard: pending work and turnaround.
* **Menus / screens:** Overview: Dashboard (`/dashboard`); Patient care: Patients (`/patients`); Diagnostics & pharmacy: Laboratory (`/laboratory`); People: My workspace (`/me`); Administration: Reports (`/reports`)
* **Modules (by permission):** Patients, Laboratory, Clinical, My workspace
* **Permitted actions:** Search and view patient demographics; Collect samples, enter results; Verify lab results; View laboratory results; Manage lab test master and pricing; Clock in/out, request leave, view own attendance and payslips.
* **Restricted actions:** Lab staff cannot see clinical notes, prescriptions or bills.
* **Approvals:** Verifies results entered by another technician (lab.verify).
* **Reports:** Lab turnaround time
* **Sensitive data access:** Patient identity and lab results.
* **Notifications received:** Test assigned, urgent/STAT orders.

### 7. Pharmacist

* **Dashboard:** Pharmacy dashboard: queue, low stock and expiring batches.
* **Menus / screens:** Overview: Dashboard (`/dashboard`); Patient care: Patients (`/patients`); Diagnostics & pharmacy: Pharmacy (`/pharmacy`), Inventory (`/inventory`), Purchase requests (`/purchasing/requests`); People: My workspace (`/me`); Administration: Reports (`/reports`)
* **Modules (by permission):** Patients, Clinical, Pharmacy, Inventory, My workspace
* **Permitted actions:** Search and view patient demographics; View prescriptions; Dispense prescriptions; Dispense and log controlled medicines; View stock and batches; Items, adjustments, transfers; View medication adherence, record doses for patients, stop schedules; Clock in/out, request leave, view own attendance and payslips.
* **Restricted actions:** Pharmacists cannot change a prescription; contact the prescriber to change or cancel it.
* **Approvals:** None (purchase requests are approved by someone else).
* **Reports:** Medication adherence, Pharmacy stock, Medicine expiry
* **Sensitive data access:** Prescriptions, allergies, controlled medicine register.
* **Notifications received:** New prescription available, stock alerts.

### 8. Inventory Manager

* **Dashboard:** Stores dashboard.
* **Menus / screens:** Overview: Dashboard (`/dashboard`); Diagnostics & pharmacy: Inventory (`/inventory`), Purchase requests (`/purchasing/requests`), Purchase orders (`/purchasing`); People: My workspace (`/me`); Administration: Reports (`/reports`)
* **Modules (by permission):** Inventory, My workspace
* **Permitted actions:** View stock and batches; Items, adjustments, transfers; Suppliers, purchase orders and goods receipts; Approve purchase orders; Clock in/out, request leave, view own attendance and payslips.
* **Restricted actions:** Everything not listed above is refused by the API with 403.
* **Approvals:** Approves purchase requests and POs raised by others.
* **Reports:** Pharmacy stock, Medicine expiry, Purchase report
* **Sensitive data access:** Supplier prices and purchase data.
* **Notifications received:** Purchase requests submitted, low stock and expiry alerts.

### 9. Accountant

* **Dashboard:** Financial dashboard: revenue, collections and outstanding.
* **Menus / screens:** Overview: Dashboard (`/dashboard`); Patient care: Patients (`/patients`), Admissions / IPD (`/ipd`); Finance: Billing (`/billing`), Insurance claims (`/insurance`); People: My workspace (`/me`); Administration: Reports (`/reports`), Departments & services (`/admin/departments`)
* **Modules (by permission):** Patients, Billing, IPD, Dashboards, Reports, Administration, My workspace
* **Permitted actions:** Search and view patient demographics; View invoices and payments; Create and issue invoices, add charges, cancel drafts; Record payments and print receipts; Process refunds; Manage insurance claims; View bed board and inpatients; Revenue and outstanding figures; Financial reports; Manage billable services and prices; Clock in/out, request leave, view own attendance and payslips.
* **Restricted actions:** Everything not listed above is refused by the API with 403.
* **Approvals:** Refunds; insurance claim decisions recording.
* **Reports:** Revenue by department, Revenue by doctor, Outstanding payments, Insurance claims, Pharmacy stock, Medicine expiry, Purchase report
* **Sensitive data access:** Invoices, payments, patient contact and insurance policy data.
* **Notifications received:** Payment-related events.

### 10. HR Manager

* **Dashboard:** HR dashboard: workforce today, attendance and pending approvals.
* **Menus / screens:** Overview: Dashboard (`/dashboard`); People: My workspace (`/me`), HR & attendance (`/hr`), Leave approvals (`/hr/leave`), Payroll (`/payroll`), Recruitment (`/recruitment`); Administration: Reports (`/reports`), Doctors & nurses (`/admin/staff`), Departments & services (`/admin/departments`)
* **Modules (by permission):** HR, Reports, Administration, Payroll, Recruitment, My workspace
* **Permitted actions:** Manage employees, contracts and performance; Manage attendance; Approve leave requests; HR and payroll reports; View doctors and nurses directory; Create and edit doctor and nurse profiles; Create and edit departments; Approve payroll runs prepared by someone else; Jobs, candidates, interviews, offers; Approve offer letters and hire candidates; Clock in/out, request leave, view own attendance and payslips.
* **Restricted actions:** Everything not listed above is refused by the API with 403.
* **Approvals:** Leave (HR step), payroll runs prepared by others, offers drafted by others, hiring.
* **Reports:** Staff attendance, Payroll summary, Leave summary
* **Sensitive data access:** Employee personal data, contracts, performance reviews, payroll totals.
* **Notifications received:** Leave requests, payroll submitted for approval, recruitment updates.

### 11. Payroll Officer

* **Dashboard:** Payroll dashboard.
* **Menus / screens:** Overview: Dashboard (`/dashboard`); People: My workspace (`/me`), HR & attendance (`/hr`), Payroll (`/payroll`); Administration: Reports (`/reports`)
* **Modules (by permission):** Payroll, Reports, HR, My workspace
* **Permitted actions:** Salary structures and payroll runs; HR and payroll reports; Manage attendance; Clock in/out, request leave, view own attendance and payslips.
* **Restricted actions:** You cannot approve a run you prepared.
* **Approvals:** None — cannot approve own runs.
* **Reports:** Staff attendance, Payroll summary, Leave summary
* **Sensitive data access:** Salary structures, employee bank details, payslips.
* **Notifications received:** Payroll approved/processed.

### 12. Recruitment Officer

* **Dashboard:** Recruitment overview.
* **Menus / screens:** Overview: Dashboard (`/dashboard`); People: My workspace (`/me`), Recruitment (`/recruitment`)
* **Modules (by permission):** Recruitment, My workspace
* **Permitted actions:** Jobs, candidates, interviews, offers; Clock in/out, request leave, view own attendance and payslips.
* **Restricted actions:** Everything not listed above is refused by the API with 403.
* **Approvals:** None — offers are approved by HR.
* **Reports:** None
* **Sensitive data access:** Candidate CVs and contact details.
* **Notifications received:** Recruitment updates.

### 13. Patient

* **Dashboard:** Portal home.
* **Menus / screens:** Overview: Dashboard (`/dashboard`); My health: My appointments (`/portal/appointments`), My medicines (`/portal/medications`), My records (`/portal/records`), My bills (`/portal/bills`)
* **Modules (by permission):** Patient Portal
* **Permitted actions:** Access own appointments, prescriptions, results and invoices.
* **Restricted actions:** Everything not listed above is refused by the API with 403.
* **Approvals:** None.
* **Reports:** None
* **Sensitive data access:** Only own records.
* **Notifications received:** Appointment confirmation and reminders, medicine reminders, refill/follow-up reminders, lab result available (after verification), payment due/received, payment reminders. External channels (SMS/email) only when configured and not opted out.

### 14. Management

* **Dashboard:** Management dashboard.
* **Menus / screens:** Overview: Dashboard (`/dashboard`); People: My workspace (`/me`); Administration: Reports (`/reports`)
* **Modules (by permission):** Dashboards, Reports, My workspace
* **Permitted actions:** Hospital-wide KPIs and charts; Revenue and outstanding figures; Clinical and operational reports; Financial reports; HR and payroll reports; Clock in/out, request leave, view own attendance and payslips.
* **Restricted actions:** Everything not listed above is refused by the API with 403.
* **Approvals:** None (read-only).
* **Reports:** Patient inflow, Patient demographics, OPD / IPD statistics, Doctor appointments, Lab turnaround time, Emergency response time, Medication adherence, Revenue by department, Revenue by doctor, Outstanding payments, Insurance claims, Pharmacy stock, Medicine expiry, Purchase report, Staff attendance, Payroll summary, Leave summary
* **Sensitive data access:** Aggregated clinical, financial and HR report data (reports can include names).
* **Notifications received:** None specific.

## Segregation-of-duties rules enforced by the server

* Lab results: “Results must be verified by someone other than the technician who entered them”.
* Purchase requests: “A request must be approved by someone other than the requester”.
* Purchase orders: “You cannot approve a purchase order you raised”.
* Payroll: “Payroll must be approved by someone other than the preparer”.
* Recruitment offers: “Offers must be approved by someone other than the person who drafted them”.
* Leave: “You cannot approve your own leave”; the reporting manager decides before HR.
* Prescriptions: “Only the prescribing doctor can cancel this prescription”.
* Clinical notes: only the visit’s doctor can write; closed visits are read-only; amendments keep the earlier version with a reason.
* Refunds: only roles with `refunds.process` (Accountant, admins) — receptionists are refused (tested in `tests/e2e.workflow.test.ts`).

Role restrictions verified by automated tests: see `docs/qa_and_test_report.md` (role-restriction section).
