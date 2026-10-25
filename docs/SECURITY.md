# Roles, Permissions & Security

## Model
* **Permission** — a code such as `patients.create`, defined once in `shared/src/permissions.ts`.
* **Role** — a named set of permission codes, per hospital, editable at runtime under
  *Administration → Roles & permissions*. System roles are seeded and cannot be renamed.
* **User** — has one or more roles. Effective permissions = union of role permissions.

The API enforces permissions on **every route** (`requirePermission(...)`). The client only uses
them to decide what to show. Permission changes apply within 60 seconds (principal cache TTL).

## Data-level rules (beyond permissions)

| Rule | Where enforced |
|---|---|
| Users only ever see their own hospital's data | `basePlugin` adds `hospitalId` to every query; unscoped queries throw |
| Patients see only their own record, appointments, prescriptions and invoices | `access.ts`, list filters force `patientId` |
| Doctors see EMRs only for patients they have an appointment or visit with (`emr.view_all` overrides) | `assertClinicalAccess` |
| Nurses see EMRs only for patients with an open visit or an appointment today | `assertClinicalAccess` |
| Only the assigned doctor can run a consultation, write its notes, diagnoses and prescriptions | `ownAppointment` / `ownOpenVisit` |
| Nurses cannot write doctor notes; pharmacy and accounts cannot edit clinical data; HR cannot read patients | role permissions (`clinical.consult`, `patients.view` absent) |
| Closed visits are read-only | `ownOpenVisit` |
| Clinical notes are visible only with `clinical.notes.view` (not to reception, accounts, nurses by default) | EMR section filtering |
| Lab results are verified by a different person than the technician who entered them | `lab.service.verify` |
| Patients see lab results only once verified, and only their own | `listOrders` / `assertOrderAccess` |
| Pharmacy and reception cannot read or edit lab results; pharmacy cannot edit clinical notes | permissions (`lab.process`, `clinical.consult`) |
| Controlled medicines need `pharmacy.controlled` **and** a named witness; every unit is logged | `pharmacy.service.dispense`, `controlleddruglogs` |
| Expired stock can never be dispensed or received; stock can never go negative | `stock.service` (conditional decrements, expiry checks) |
| A purchase order cannot be approved by the person who raised it | `purchasing.service.actOnPurchaseOrder` |
| The stock ledger is append-only | update/delete hooks on `inventorytransactions` |
| Only doctors take emergency cases and record dispositions (except "left without being seen") | `emergency.service` (`emergency.treat` + doctor profile) |
| Only the attending doctor discharges an inpatient (or `emr.view_all`) | `ipd.service.discharge` |
| Ward notes: doctors write progress notes, nurses nursing notes; reception and billing cannot; billing roles see admissions without clinical notes | `ipd.service.addNote` / `getAdmission` |
| Bed occupancy cannot be set by hand — only via admit, transfer, discharge | `ipd.service.setBedStatus` |
| Insurance settlement requires both `insurance.manage` and `payments.receive` | `insurance.routes` |
| Staff see their own attendance, leave, payslips and reviews only (`/api/me`); payslip PDFs open only for the employee or payroll staff | `hr.service` `requireSelf`, `payroll.service.payslipData` |
| Leave is decided first by the employee's own reporting manager, then HR; nobody approves their own leave | `hr.service.managerDecision` / `hrDecision` |
| Salary details on an employee profile are visible only to payroll and HR | `hr.service.getEmployee` |
| A payroll run is approved by someone other than the person who prepared it; approved runs are frozen | `payroll.service.actOnRun` / `adjustItem` |
| An offer letter is approved by someone other than its author; hiring needs `recruitment.approve` and an accepted offer | `recruitment.service.actOnOffer` / `hire` |
| Attendance corrections require a reason and are audited with before/after | `hr.service.manualEntry` |
| Patients record doses only on their own schedules; staff need `medication.manage` plus care-team access (or dispensing rights) | `medication.service.assertMedicationAccess` |
| Only clinical staff can stop a medicine; the patient is notified | `medication.service.stopSchedule` |
| A purchase request is approved by someone other than the requester; only purchasing converts it to a PO | `purchasing.service.actOnPurchaseRequest` / `convertPurchaseRequest` |
| Lab orders are assigned by supervisors to users who hold `lab.process`; an assigned order can only be started by its technician or a supervisor | `lab.service.assignTechnician` / `startProcessing` |
| Uploaded lab reports are validated by content; patients see them only on their own verified orders | `validateUpload`, `lab.service.getAttachment` |
| Disabled payment methods are refused by the API, not just hidden | `catalog.requirePaymentMethod` |
| Each report has its own permission list; the catalogue only lists what the caller may run; runs and exports are audited | `reports.service.runReport` |

## Default role matrix

| Role | Key permissions |
|---|---|
| Super Admin | everything except `portal.self` |
| Hospital Admin | everything except `portal.self`, `emr.view_all`, `clinical.notes.view` |
| Receptionist | patients.view/create/update/documents, appointments.view/manage/checkin, billing.view, emergency.view/manage, ipd.view/manage |
| Nurse | patients.view, appointments.view, nursing.queue, vitals.record/view, emr.view, prescriptions.view, lab.results.view, emergency.view/manage, ipd.view/manage, medication.manage |
| Doctor | patients.view, vitals.view, emr.view, clinical.queue/consult, clinical.notes.view, prescriptions.create/view, lab.order, lab.results.view, emergency.view/treat, ipd.view/manage/discharge, medication.manage, reports.clinical |
| Accountant | patients.view, billing.view/manage, payments.receive, refunds.process, insurance.manage, dashboard.financial, reports.financial, services.manage, ipd.view |
| HR Manager | hr.employees/attendance/leave.approve, payroll.approve, recruitment.manage/approve, staff.view/manage, departments.manage, reports.hr |
| Payroll Officer | payroll.manage, hr.attendance, reports.hr |
| Recruitment Officer | recruitment.manage |
| Pharmacist | patients.view, prescriptions.view, pharmacy.dispense/controlled, inventory.view/manage, medication.manage |
| Lab Technician | patients.view, lab.process/verify/manage, lab.results.view |
| Inventory Manager | inventory.view/manage, purchasing.manage/approve |
| Management | dashboard.executive/financial, reports.* |
| Patient | portal.self |

Every role except Patient also gets `self.service` (My workspace).

The full catalogue with descriptions is visible in the Roles screen and at `GET /api/admin/permissions`.

## Controls checklist

| Control | Implementation |
|---|---|
| Password hashing | bcrypt cost 12; constant-time path for unknown emails |
| Password policy | ≥ 10 chars, upper, lower, digit, symbol (shared zod schema) |
| Lockout | 5 failures → 15 minutes; admins can unlock |
| Sessions | 15-min JWT access token + rotating opaque refresh token (hashed at rest, family revocation on reuse); httpOnly SameSite=Strict cookies; Secure in production |
| Session expiry | Tokens issued before a password change are rejected; deactivated users are cut off within 60 s |
| MFA | Fields reserved on `User` (`mfaEnabled`, `mfaSecret`); login flow ready to return a challenge |
| CSRF | SameSite=Strict + mandatory `X-Requested-With` header + Origin allow-list |
| XSS | React escaping, no `dangerouslySetInnerHTML`, helmet CSP, tokens unreachable from JS |
| Injection | All input passes zod schemas yielding primitives; `strictQuery`; regexes escaped |
| Rate limiting | 10/min on auth endpoints, 300/min per session elsewhere |
| File uploads | Extension + MIME + magic-byte agreement; size cap; random storage keys; `nosniff` on download |
| Errors | Problem JSON; stack traces only outside production |
| Logging | pino with redaction of cookies, auth headers, CNIC, phone, email, DOB, passwords; request bodies never logged |
| Audit | Append-only `AuditLog` with user, roles, action, module, entity, id, IP, before/after; writes join the business transaction |
| Transport | Terminate TLS at the reverse proxy; set `COOKIE_SECURE=true` |
