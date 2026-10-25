# API Reference

Base URL `/api`. JSON in and out. Authentication is by httpOnly cookies set at login.

**Every non-GET request must send `X-Requested-With: hms`** (CSRF guard).

## Conventions

* **Pagination**: `?page=1&pageSize=20` (max 100) → `{ items, page, pageSize, total }`
* **Search / filter / sort**: `search`, module-specific filters (documented below), `sort`
* **Dates**: calendar dates as `YYYY-MM-DD`, times as `HH:mm` (24h), instants as ISO-8601
* **Errors**: RFC 7807 problem JSON

```json
{ "type": "https://hms.local/problems/validation", "title": "Some fields are invalid", "status": 400,
  "code": "validation", "details": { "fieldErrors": { "phone": ["Enter a valid phone number"] } } }
```

| Status | `code` examples | When |
|---|---|---|
| 400 | `validation`, `bad_id`, `bad_json` | Input failed schema validation |
| 401 | `unauthorized` | No/expired session (client refreshes once, then redirects to login) |
| 403 | `forbidden` | Missing permission, not on the care team, CSRF header missing |
| 404 | `not_found` | Unknown record (or outside your hospital) |
| 409 | `invalid_transition`, `slot_taken`, `duplicate_patient`, `possible_duplicate`, `duplicate` | State conflict |
| 422 | `business_rule`, `allergy_conflict`, `wrong_password` | Business rule violated |
| 429 | `rate_limited` | Too many requests |
| 500 | `internal_error` | Unexpected; no stack trace in production |

## Auth — `/api/auth`
| Method | Path | Body | Notes |
|---|---|---|---|
| POST | `/login` | `{ email, password, rememberMe }` | 204 + cookies. 5 failures → 15 min lockout. Rate-limited 10/min |
| POST | `/refresh` | — | Rotates refresh token; reuse revokes the session family |
| POST | `/logout` | — | Revokes session family, clears cookies |
| GET | `/me` | — | Session user: roles, permissions, hospital, patientId/doctorId/nurseId |
| POST | `/forgot-password` | `{ email }` | Always 200 (no account enumeration) |
| POST | `/reset-password` | `{ token, password, confirmPassword }` | 30-min single-use token |
| POST | `/change-password` | `{ currentPassword, newPassword, confirmPassword }` | Revokes other sessions |

## Administration — `/api/admin`
| Method | Path | Permission |
|---|---|---|
| GET/PUT | `/hospital` | `system.config` |
| GET | `/departments?includeInactive` | signed-in |
| POST, PUT `/:id` | `/departments` | `departments.manage` |
| GET `?category` · POST · PUT `/:id` | `/services` | read: `services.manage`/`billing.*`; write: `services.manage` |
| GET | `/permissions` | `roles.manage` |
| GET · POST · PUT `/:id` | `/roles` | `roles.manage` (GET also `users.*`) |
| GET · POST · PATCH `/:id` | `/users` | `users.view` / `users.manage` |
| POST | `/users/:id/reset-password`, `/users/:id/unlock` | `users.manage` |
| GET | `/doctors?departmentId&availableOnly` | signed-in |
| GET | `/nurses` | `staff.view` |
| POST | `/staff` | `staff.manage` (creates employee + doctor/nurse profile) |
| PATCH | `/doctors/:id` | `staff.manage` (fees, schedule, availability) |

## Patients — `/api/patients`
| Method | Path | Permission | Notes |
|---|---|---|---|
| GET | `/?search&gender&page` | `patients.view` | search: name prefix, MRN, CNIC, phone |
| POST | `/duplicates` | `patients.create` | Pre-check for likely duplicates |
| POST | `/` | `patients.create` | Generates MRN. 409 `duplicate_patient` (same CNIC) or `possible_duplicate` (send `confirmNotDuplicate: true` to override) |
| GET | `/:id` | `patients.view` / `portal.self` (own) | |
| PATCH | `/:id` | `patients.update` | Audited with old/new values |
| GET | `/:id/registration-summary.pdf` | `patients.view` | |
| POST · DELETE `/:entryId` | `/:id/allergies`, `/:id/history`, `/:id/insurance` | `patients.update`, or clinician on the care team | Removal is soft |
| GET · POST (multipart `file`, `category`) | `/:id/documents` | `patients.documents` | PDF/PNG/JPEG, magic-byte checked |
| GET | `/:id/documents/:docId` | `patients.documents` / `portal.self` | Download (audited) |

## Appointments — `/api/appointments`
| Method | Path | Permission | Notes |
|---|---|---|---|
| GET | `/availability?doctorId&date` | `appointments.view`/`portal.self` | Slot grid with availability |
| GET | `/?from&to&doctorId&departmentId&patientId&status` | `appointments.view`/`portal.self` | Portal users see only their own |
| POST | `/` | `appointments.manage`/`portal.self` | `{ patientId, doctorId, date, startTime, type, reason }`. Validates duty hours, working day, slot grid, past time, patient overlap; 409 `slot_taken` on double booking |
| POST | `/:id/confirm` · `/:id/check-in` · `/:id/no-show` | manage / `appointments.checkin` | Check-in opens a Visit and assigns a token |
| POST | `/:id/cancel` `{ reason }` · `/:id/reschedule` `{ date, startTime, doctorId? }` | manage / portal (cancel own) | Releases / moves the slot lock |

## Clinical — `/api/clinical`
| Method | Path | Permission | Notes |
|---|---|---|---|
| GET | `/emr/:patientId` | `emr.view` (care team) / `emr.view_all` / `portal.self` | Sections filtered by permission; access audited |
| GET · POST | `/patients/:id/vitals` | `vitals.view` / `vitals.record` | BMI + abnormal flags computed server-side |
| GET | `/nursing/queue` | `nursing.queue` | Today's CheckedIn / NurseAssessment |
| GET · POST `/start` · POST `/submit` | `/nursing/appointments/:id` | `vitals.record` | Submit → `WaitingForDoctor`, notifies doctor |
| GET | `/doctor/queue` | `clinical.queue` | waiting / inConsultation / upcoming / completed |
| GET · POST `/start` · POST `/complete` | `/doctor/appointments/:id` | `clinical.consult` (own patients only) | Complete requires note + diagnosis; closes visit; posts consultation fee |
| PUT | `/visits/:visitId/note` | `clinical.consult` | Create or amend (author only; audited) |
| POST · DELETE `/:id` | `/visits/:visitId/diagnoses` | `clinical.consult` | Delete = retraction (soft) |
| PUT | `/visits/:visitId/treatment-plan` | `clinical.consult` | |
| POST | `/visits/:visitId/prescriptions` | `prescriptions.create` | Numbered, allergy-checked (422 `allergy_conflict`), notifies patient |
| GET | `/prescriptions/:id` · `/prescriptions/:id/pdf` | `prescriptions.view`/`pharmacy.dispense`/`portal.self` | |
| POST | `/prescriptions/:id/cancel` | `prescriptions.create` (prescriber) | |

## Billing — `/api/billing`
| Method | Path | Permission | Notes |
|---|---|---|---|
| GET | `/invoices?status&source&patientId&from&to&outstandingOnly&search` | `billing.view`/`portal.self` | Returns `totals` for the filter |
| POST | `/invoices` | `billing.manage` | Manual invoice; totals computed server-side |
| GET | `/invoices/:id` · `/invoices/:id/pdf` | `billing.view`/`portal.self` | Includes payments and refunds |
| POST | `/invoices/:id/lines` · `/issue` · `/cancel` | `billing.manage` | Lines only on drafts; cancel only without payments |
| POST | `/invoices/:id/payments` `{ amount, method, reference }` | `payments.receive` | Transactional; cannot exceed balance; reference required for non-cash |
| POST | `/invoices/:id/refunds` `{ paymentId, amount, reason }` | `refunds.process` | Up to the payment's refundable amount |
| GET | `/payments/:id/receipt` | `billing.view`/`payments.receive`/`portal.self` | PDF |

Other modules post charges through `billingService.addCharges({ …, sourceRef })`, which is idempotent per `sourceRef`.

## Laboratory — `/api/laboratory` (Phase 2)
| Method | Path | Permission | Notes |
|---|---|---|---|
| GET · POST · PUT `/:id` | `/tests` | read: `lab.order`/`lab.manage`/`lab.process`; write: `lab.manage` | Test master with parameters, reference and critical ranges |
| POST | `/visits/:visitId/orders` `{ testIds, priority, clinicalNotes }` | `lab.order` (assigned doctor, open visit) | Creates the order and an issued Laboratory invoice; Urgent/STAT alerts lab staff |
| GET | `/orders?statuses=&status=&patientId=&priority=&mine=` | lab staff / `lab.results.view` (care team, `mine` = my orders) / `portal.self` (own, Verified only) | |
| GET | `/orders/:id` · `/orders/:id/report` (PDF, Verified only) | same as above | |
| POST | `/orders/:id/receive` → `/collect` → `/start` | `lab.process` | Ordered → SamplePending → SampleCollected → InProgress |
| PUT | `/orders/:id/results` `{ results: [{ itemId, parameter, value }], comments, draft }` | `lab.process` | Server flags N/L/H/LL/HH; final save needs every parameter → Completed |
| POST | `/orders/:id/verify` · `/orders/:id/reject { reason }` | `lab.verify` | Verifier must differ from the technician; verify notifies doctor (Critical priority if any LL/HH) and patient |
| POST | `/orders/:id/cancel { reason }` | `lab.process` or ordering doctor | Before processing; voids unpaid lab invoice |
| POST | `/orders/:id/review` | `lab.results.view` (doctor) | Doctor acknowledges a verified report |
| GET | `/stats` | lab staff / executive | Stage counts and 30-day turnaround per test |

## Pharmacy — `/api/pharmacy` (Phase 2)
| Method | Path | Permission | Notes |
|---|---|---|---|
| GET | `/formulary?search=` | `prescriptions.create`/`pharmacy.dispense`/`inventory.view` | Medicines with usable (non-expired) pharmacy stock |
| GET | `/queue` | `pharmacy.dispense` | Active/partially dispensed prescriptions with stock readiness |
| GET | `/prescriptions/:id` | `pharmacy.dispense` | Lines, matched stock item, batches, FEFO preview |
| POST | `/prescriptions/:id/dispense` `{ lines: [{ prescriptionItemId, itemId, quantity }], witnessName, notes }` | `pharmacy.dispense` (+ `pharmacy.controlled` for controlled items) | One transaction: FEFO stock issue, prescription status, controlled register, Pharmacy invoice. 422 `insufficient_stock`, over-dispensing, missing witness |
| GET | `/dispenses` · `/controlled-register` | `pharmacy.dispense` · `pharmacy.controlled` | History and controlled-drug register |

## Inventory — `/api/inventory` (Phase 2)
| Method | Path | Permission | Notes |
|---|---|---|---|
| GET · POST · PUT `/:id` | `/items?search&category&lowStock&controlled` | `inventory.view` / `inventory.manage` | Item master (medicines + supplies) |
| GET | `/items/:id` | `inventory.view` | Item, batches (FEFO order), last 100 ledger rows |
| POST | `/adjustments` `{ batchId, type: Adjustment|Damage|Expiry|Consumption, quantity, reason }` | `inventory.manage` | Count corrections may be ±; never below zero |
| POST | `/transfers` `{ batchId, to, quantity }` · `/returns` `{ batchId, quantity, reason }` | `inventory.manage` (`purchasing.manage` for returns) | Store ↔ pharmacy; return to supplier |
| GET | `/transactions?type&itemId` · `/alerts?days=90` · `/summary` | `inventory.view` | Ledger, low stock & expiry, dashboard summary |

## Purchasing — `/api/purchasing` (Phase 2)
| Method | Path | Permission | Notes |
|---|---|---|---|
| GET · POST · PUT `/:id` | `/suppliers` | read: `purchasing.manage`/`inventory.view`; write: `purchasing.manage` | |
| GET · POST · PUT `/:id` | `/orders` | `purchasing.manage` (GET also `purchasing.approve`) | Totals computed server-side; edit only in Draft |
| POST | `/orders/:id/submit` · `/order` · `/cancel {note}` | `purchasing.manage` | Draft → PendingApproval; Approved → Ordered; cancel only before any receipt |
| POST | `/orders/:id/approve` · `/reject {note}` | `purchasing.approve` | The person who raised the PO cannot approve it |
| POST | `/orders/:id/receive` `{ location, invoiceRef, lines: [{ lineId, quantity, batchNo, expiryDate }] }` | `purchasing.manage`/`inventory.manage` | Creates/tops up batches, ledger rows; → PartiallyReceived/Received; rejects expired lots and over-receipt |

## Emergency — `/api/emergency` (Phase 3)
| Method | Path | Permission | Notes |
|---|---|---|---|
| GET | `/board` | `emergency.view` | Active cases sorted by triage rank then arrival; waiting minutes, target breaches, today's counts, avg door-to-doctor |
| GET | `/cases?status&active&from&to&search` · `/cases/:id` | `emergency.view` | History; case detail with triage history, events, vitals, notes, prescriptions, labs |
| POST | `/cases` `{ patientId? | name, gender, age, cnic, emergencyContact…, arrivalMode, presentingComplaint, triageLevel? }` | `emergency.manage`/`emergency.treat` | Quick registration. New patients get a provisional record with an MRN; a matching CNIC reuses the existing patient; one open case per patient (422 `duplicate_er_case`). Critical/Urgent alerts doctors |
| POST | `/cases/:id/triage` `{ level, notes, vitals? }` | `emergency.manage`/`emergency.treat` | Re-triage appends history; vitals saved to the ER visit |
| POST | `/cases/:id/take` | `emergency.treat` (doctor) | → InTreatment, stops the door-to-doctor clock; handover if already in treatment |
| POST | `/cases/:id/notes` `{ note }` | `emergency.manage`/`emergency.treat` | Doctor → progress note, nurse → nursing note (in the EMR) |
| POST | `/cases/:id/disposition` `{ type, notes, referredTo?, admission? { bedId, reason, attendingDoctorId?, expectedDischarge? } }` | treating doctor (LWBS: `emergency.manage`) | One transaction: closes the ER visit, admits to a bed if `Admitted`, bills `ER-CONS` if a doctor saw the patient |

Doctors prescribe and order labs from an ER case through the usual `/clinical/visits/:visitId/prescriptions` and `/laboratory/visits/:visitId/orders` using the case's `visitId`.

## Admissions / IPD — `/api/ipd` (Phase 3)
| Method | Path | Permission | Notes |
|---|---|---|---|
| GET · POST · PUT `/:id` | `/wards` | read `ipd.view`; write `ipd.config` | Ward with type, floor, daily rate |
| POST | `/rooms` · `/beds` | `ipd.config` | Bed may override the ward rate |
| GET | `/beds/board` | `ipd.view` | Wards → rooms → beds with occupant, totals by status |
| POST | `/beds/:id/status` `{ status, note, reservedForPatientId? }` | `ipd.manage` | Housekeeping only (Available/Reserved/Cleaning/Maintenance); occupancy is never set by hand (422) |
| GET · POST | `/admissions` `{ patientId, bedId, attendingDoctorId, source, reason, provisionalDiagnosis?, expectedDischarge?, assignedNurseId? }` | read `ipd.view`/`portal.self`; admit `ipd.manage` | Atomic bed claim (409 `bed_unavailable`); one active admission per patient (409 `already_admitted`); opens an IPD visit |
| GET | `/admissions/:id` | `ipd.view`/`portal.self` | Clinical sections (notes, vitals, prescriptions, labs) only for the care team; billing roles see the admin record |
| POST | `/admissions/:id/transfer` `{ bedId, reason }` | `ipd.manage` | Closes the bed stay, old bed → Cleaning |
| POST | `/admissions/:id/notes` `{ note }` | doctors (progress) / nurses (nursing) on the care team | Append-only |
| POST | `/admissions/:id/discharge` `{ type, finalDiagnosis, treatmentGiven, conditionAtDischarge, medications?, instructions?, followUpDate? }` | `ipd.discharge`, attending doctor | Bills bed-days per stay at each ward's rate (IPD invoice), bed → Cleaning |
| POST | `/admissions/:id/cancel { reason }` | `ipd.manage` | Within 24 h and before treatment; no charges |
| GET | `/admissions/:id/discharge-summary.pdf` · `/stats` | `ipd.view` | |

## Insurance — `/api/insurance` (Phase 3)
| Method | Path | Permission | Notes |
|---|---|---|---|
| GET | `/eligible-invoices?search` | `insurance.manage` | Outstanding invoices of insured patients without a live claim |
| GET · POST | `/claims` `{ invoiceId, insuranceId?, claimAmount?, notes? }` | `insurance.manage` | Amount defaults to coverage % of the invoice, capped by balance and remaining policy limit; 422 `policy_expired`, `limit_exceeded`; 409 `duplicate_claim` |
| GET · PATCH | `/claims/:id` | `insurance.manage` | Edit amount/notes while Draft |
| POST | `/claims/:id/submit` · `/review` · `/reopen` | `insurance.manage` | Draft → Submitted → UnderReview; Rejected → Draft |
| POST | `/claims/:id/decision` `{ decision, approvedAmount, payerReference?, notes? }` | `insurance.manage` | Approved (full) / PartiallyApproved (< claim) / Rejected (reason required) |
| POST | `/claims/:id/paid` `{ amount, payerReference }` | `insurance.manage` + `payments.receive` | Posts an `Insurance` payment on the invoice in the same transaction; remaining balance is the patient's share |

## HR — `/api/hr` (Phase 4)
| Method | Path | Permission | Notes |
|---|---|---|---|
| GET | `/employees?search&departmentId&employmentType&active=true|false|all&page&pageSize` | `hr.employees` / `hr.attendance` / `payroll.manage` | Includes today's attendance per row |
| POST · PUT | `/employees` · `/employees/:id` | `hr.employees` | Employee number from the never-resetting `EMP-{n:5}` sequence; deactivating sets the exit date |
| GET | `/employees/:id` | HR roles, or the employee themself (`self.service`) | Contracts, direct reports, leave balances, this month's attendance; salary history only for payroll/HR; reviews for HR or self |
| POST | `/employees/:id/contracts` · `/contracts/:id/terminate { reason }` | `hr.employees` | A new contract expires the active one |
| POST | `/employees/:id/reviews` `{ period, rating 1–5, goals?, strengths?, improvements?, submit }` | `hr.employees` | Nobody reviews themself; submitted reviews are locked and the employee is notified |
| GET | `/attendance/day?date&departmentId` · `/attendance/summary?period=YYYY-MM&departmentId&employeeId` | `hr.attendance` (+ `reports.hr` for summary) | |
| POST | `/attendance/manual` `{ employeeId, date, clockIn?, clockOut?, status?, note }` | `hr.attendance` | Reason required; audited as `attendance.corrected` / `manual_entry` |
| POST | `/attendance/close-day { date }` | `hr.attendance` | Marks Absent / OnLeave / WeeklyOff / Holiday for everyone without a record; idempotent; never overwrites punches |
| GET | `/leave?scope=mine|team|all&status=a,b&employeeId` | `self.service` (mine/team) · `hr.leave.approve` / `hr.employees` (all) | |
| POST | `/leave/:id/manager-decision` `{ approve, note? }` | the employee's reporting manager | Rejection needs a note |
| POST | `/leave/:id/hr-decision` `{ approve, note? }` | `hr.leave.approve` (not for own leave) | Approval moves pending → used and marks the days OnLeave |
| POST | `/leave/:id/cancel` | owner or `hr.leave.approve` | Not once approved leave has started; balance restored |
| GET | `/stats` | HR roles / `dashboard.executive` | Headcount, today, pending leave, 14-day trend |

## My workspace — `/api/me` (Phase 4, `self.service`)
| Method | Path | Notes |
|---|---|---|
| GET | `/attendance?period` · POST `/attendance/clock-in` · POST `/attendance/clock-out` | 409 `already_clocked_in` / `already_clocked_out`; 422 on approved leave |
| GET · POST | `/leave` `{ type, from, to, halfDay?, reason }` | 409 `leave_overlap`; 422 `insufficient_balance`; only sick leave may be back-dated |
| GET | `/payslips` | Own payslips only |
| POST | `/reviews/:id/acknowledge { comment? }` | Own submitted reviews |

## Payroll — `/api/payroll` (Phase 4)
| Method | Path | Permission | Notes |
|---|---|---|---|
| GET · POST | `/salary/:employeeId` `{ effectiveFrom, basic, allowances[], deductions[], taxPercent, overtimeRatePerHour?, bankName?, bankAccount? }` | read: `payroll.manage`/`payroll.approve`; write: `payroll.manage` | Effective-dated; history kept; audited `salary.changed` |
| GET · POST | `/runs` · `{ period: YYYY-MM }` | `payroll.manage` (create) | One live run per month, none for future months (409 `duplicate_run`) |
| GET | `/runs/:id` | payroll roles | Items, payslip ids, totals by department |
| POST | `/runs/:id/regenerate` | `payroll.manage` | Draft only |
| PATCH | `/items/:id { bonus, otherDeduction, note? }` | `payroll.manage` | Draft/Review only |
| POST | `/runs/:id/submit` · `/approve` · `/reject` · `/process` · `/cancel` `{ note? }` | approve/reject: `payroll.approve` (not the preparer); others `payroll.manage` | Process issues payslips and notifies staff |
| GET | `/payslips/:id/pdf` | payroll roles, or the employee | Audited `payslip.viewed` |

## Recruitment — `/api/recruitment` (Phase 4)
| Method | Path | Permission | Notes |
|---|---|---|---|
| GET | `/stats` · `/jobs?status` · `/candidates?jobId&stage&search` · `/candidates/:id` · `/interviews/upcoming` | `recruitment.manage` / `recruitment.approve` | |
| POST · PUT | `/jobs` · `/jobs/:id` | `recruitment.manage` | |
| POST | `/candidates` | `recruitment.manage` | Open jobs only; 409 `duplicate_application` |
| POST | `/candidates/:id/stage { stage, note? }` | `recruitment.manage` | Workflow-checked; Offer/Hired only via the offer and hire actions |
| POST · GET | `/candidates/:id/resume` (multipart `file`, PDF) | manage / read | |
| POST | `/interviews` `{ candidateId, scheduledAt, durationMinutes, mode, location?, panel[] }` · `/interviews/:id/evaluation` · `/interviews/:id/status { Cancelled|NoShow }` | `recruitment.manage` (evaluation: read roles) | Shortlisted/Interview candidates only; no past times |
| POST | `/offers` · `/offers/:id/submit|approve|reject|send|accept|decline|withdraw` | approve/reject: `recruitment.approve` (not the drafter); others `recruitment.manage` | Selected candidates only; one open offer per candidate |
| GET | `/offers/:id/pdf` | read roles | Offer letter |
| POST | `/candidates/:id/hire` | `recruitment.approve` | Needs an accepted offer; creates employee + contract + salary; fills/closes the job |

## Sorting

Paginated lists accept `?sort=key` (ascending) or `?sort=-key` (descending). Keys are whitelisted per
endpoint; an unknown key returns 400 with the allowed keys in `details.fieldErrors.sort`.

| Endpoint | Sort keys |
|---|---|
| `/patients` | name, mrn, registered, dateOfBirth, city |
| `/billing/invoices` | created, issued, invoiceNo, total, balance, status |
| `/hr/employees` | name, employeeNo, designation, joiningDate |
| `/hr/leave` | requested, from, days, status |
| `/admin/users` | name, email, lastLogin, created |
| `/inventory/items` | name, sku, stock, category, reorderLevel |
| `/purchasing/orders` · `/purchasing/requests` | created, poNo/requestNo, total, status, expectedDelivery/neededBy, supplier |
| `/insurance/claims` | created, claimNo, amount, status, provider |
| `/ipd/admissions` · `/emergency/cases` | admitted/arrival, number, status (+ triage for ER) |
| `/recruitment/candidates` | updated, applied, name, stage, experience |
| `/pharmacy/dispenses` | dispensed, dispenseNo, total |

## Configuration catalog, lab assignment & uploads, purchase requests (completion pass)
| Method | Path | Permission | Notes |
|---|---|---|---|
| GET | `/admin/catalog` | signed-in | Appointment types (code, label, fee basis, active), accepted payment methods, medicine categories, medication-reminder start (`Prescribed`/`Dispensed`); defaults when not configured |
| PUT | `/admin/hospital` `{ …, catalog }` | `system.config` | Codes still used by appointments / items cannot be removed (422) — deactivate instead; duplicate codes → 400 |
| POST | `/appointments` `{ type }` | as before | `type` must be an active catalog code (422 otherwise); the consultation is billed at the type's fee basis and labelled with its name |
| POST | `/billing/invoices/:id/payments` | as before | 422 `payment_method_disabled` for methods switched off in the catalog (Insurance settlements always allowed) |
| GET | `/laboratory/technicians` · POST `/laboratory/orders/:id/assign { userId }` | `lab.verify` / `lab.manage` | Target must have a non-administrator role granting `lab.process`; technician notified; only the assignee (or a supervisor) can start processing |
| POST · PUT | `/hr/employees` · `/recruitment/offers` `{ designation }` | as before | When the catalog defines `designations`, the title must be one of them (422 `unknown_designation`); empty list = free text |
| GET | `/laboratory/orders?assignedToMe=true` | lab roles | Technician worklist |
| POST | `/laboratory/orders/:id/attachments` (multipart `file`, `description?`) | `lab.process` | PDF/PNG/JPEG, checked by extension + type + magic bytes |
| GET | `/laboratory/orders/:id/attachments/:attachmentId` | lab roles, care team, patient (verified orders only) | Audited `lab_report.downloaded` |
| GET · POST | `/purchasing/requests` `{ justification, neededBy?, items[{ itemId, quantity, note? }] }` | read: stores/pharmacy/purchasing; create: `inventory.manage` / `pharmacy.dispense` / `purchasing.manage` | Number `PR-YYYY-NNNNN`; stock on hand captured per line |
| GET · PUT | `/purchasing/requests/:id` | as above | Edit while Draft |
| POST | `/purchasing/requests/:id/submit` · `/cancel` · `/reopen` | requesters | Approvers notified on submit |
| POST | `/purchasing/requests/:id/approve` · `/reject { note }` | `purchasing.approve`, not the requester | Rejection needs a reason |
| POST | `/purchasing/requests/:id/convert { supplierId, expectedDelivery?, prices? }` | `purchasing.manage` | Creates a Draft PO (prices default to item purchase price) and marks the request Converted |

Prescriptions (`POST /clinical/visits/:visitId/prescriptions`) now create medication schedules immediately when the catalog's `medicationScheduleFrom` is `Prescribed` (default); cancelling a prescription stops them. Appointment reminders are sent by a 15-minute background job once per appointment in the 24 hours before it (in-app + SMS/email where enabled; reset on reschedule).

## Medications — `/api/medications` (Phase 5)
| Method | Path | Permission | Notes |
|---|---|---|---|
| GET | `/mine` | `portal.self` | Own schedules with today's doses, next dose, adherence |
| GET | `/patients/:patientId` | `medication.manage` + care-team access (or dispensing / `emr.view_all`) | |
| GET | `/schedules/:id/doses` | owner patient or `medication.manage` | |
| PUT | `/schedules/:id/times { times[] }` | owner patient or `medication.manage` | Must give exactly `timesPerDay` times; future pending doses re-planned |
| POST | `/schedules/:id/stop { reason }` | `medication.manage` | Pending doses → Cancelled; patient notified |
| POST | `/doses/:id { status: Taken|Skipped, note? }` | owner patient or `medication.manage` | From 2 h before to 24 h after the due time; 422 otherwise |

Schedules are created when the doctor prescribes (default) or when a line is first dispensed, per the hospital setting; dispensing always creates any missing schedule. A background job runs every 5 minutes: dose reminders, missed-dose marking (2 h after due), missed-dose alerts to the prescriber and patient (≥2 in 24 h, once a day), refill reminders 3 days before a long-term course ends, and follow-up reminders when it finishes.

## Reports — `/api/reports` (Phase 5)
| Method | Path | Permission | Notes |
|---|---|---|---|
| GET | `/` | signed-in | The reports the caller may run (catalogue in `shared/src/schemas/phase5.ts`) |
| GET | `/:key?from&to&departmentId&doctorId&format=json|xlsx|pdf|csv` | per report (`reports.clinical` / `reports.financial` / `reports.hr`, plus module roles for their own reports) | Defaults to the current month; exports are attachments (PDF inline). Views and exports are audited (`report.viewed` / `report.exported`) |

Department filter: patient-inflow, demographics, opd-ipd, doctor-appointments, lab-tat, medication-adherence, revenue-department, revenue-doctor, outstanding, insurance-claims, staff-attendance, payroll-summary, leave-summary. Emergency response is ER-only; pharmacy stock and purchases are hospital-wide; medicine expiry takes a date range as the expiry window (expired stock is always listed).

Report keys: `patient-inflow`, `demographics`, `opd-ipd`, `doctor-appointments`, `lab-tat`, `er-response`, `medication-adherence`, `revenue-department`, `revenue-doctor`, `outstanding`, `insurance-claims`, `pharmacy-stock`, `medicine-expiry`, `purchases`, `staff-attendance`, `payroll-summary`, `leave-summary`.

## Dashboard, search, notifications, audit
| Method | Path | Permission |
|---|---|---|
| GET | `/dashboard/summary?preset=today|yesterday|week|month|lastMonth|custom&from&to` | `dashboard.executive` / `dashboard.financial` (blocks filtered by permission) |
| GET | `/dashboard/front-desk` | `appointments.view` / `nursing.queue` |
| GET | `/search?q=` | signed-in; result groups filtered by permission |
| GET | `/notifications?unreadOnly&type&page&pageSize` · POST `/notifications/:id/read` · POST `/notifications/read-all` | own notifications |
| GET | `/audit?module&action&entity&entityId&userId&from&to&search` | `audit.view` (read-only; no write routes exist) |

## Final directive additions (18 Oct 2026)

### Idempotency keys
`POST /billing/invoices/:id/payments`, `POST /billing/invoices/:id/refunds` and `POST /pharmacy/prescriptions/:id/dispense` accept an optional `Idempotency-Key` header (8–100 characters `A–Z a–z 0–9 _ -`). Keys are scoped to hospital + user and kept for 24 h.

| Situation | Response |
|---|---|
| First request with the key | Processed normally; the response (status < 500) is stored |
| Same key, same body, already done | Stored response replayed with header `Idempotent-Replayed: true` — nothing is processed again |
| Same key, still processing | 409 `request_in_progress` |
| Same key, different body | 422 `idempotency_key_reused` |
| Original request failed with 5xx | Record discarded; the key may be retried |

The web client sends a new key each time a payment/refund dialog opens and after each successful dispense.

### Temporary passwords
While a user's `mustChangePassword` flag is set, every request outside `/api/auth/*` returns **403** `password_change_required` (“Change your temporary password before continuing”). `POST /auth/change-password` clears it.

### Consent and portal access — `/api/patients`
| Method | Path | Permission | Notes |
|---|---|---|---|
| GET | `/:id/consents` | `patients.view` or `portal.self` (own record only) | `{ current: [{type, granted|null, at, method, recordedByName}], history: [...] }` |
| POST | `/:id/consents` | `patients.update` or `portal.self` | Body `{ type: Treatment|DataSharing|SmsMessages|EmailMessages|PushNotifications, granted, method?: Written|Verbal, note? }`. Patients may change only the three message types (method forced to `Portal`). Append-only; audited `consent.granted` / `consent.withdrawn` |
| GET | `/:id/portal-account` | `patients.update` | `{ enabled, email, lastLoginAt, mustChangePassword }` |
| POST | `/:id/portal-account` | `patients.update` | Body `{ email }` → 201 `{ email, temporaryPassword }` (shown once). 409 if already enabled or email in use; 422 for provisional patients |
| POST | `/:id/portal-account/disable` | `patients.update` | Deactivates the Patient-role login |

### Integration status — `/api/admin`
| Method | Path | Permission | Notes |
|---|---|---|---|
| GET | `/integrations` | `system.config` | `[{ channel: Email|Sms|Push, configured, provider }]` — `provider` is `"Demo mode (not sent)"` when unconfigured, otherwise the gateway host |

Notification deliveries now record `Sent` (provider accepted), `Logged` (no provider — demo mode, not sent), `Skipped` (channel disabled in hospital settings), `OptedOut` (patient withdrew consent for that channel) or `Failed`.
