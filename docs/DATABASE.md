# Database Design (MongoDB)

Document model with relational discipline: every reference is an `ObjectId` with a `ref`, every
business number has a unique index, and every operational collection is scoped by `hospitalId`.

## Conventions (applied by `basePlugin`)

| Field | Meaning |
|---|---|
| `_id` | ObjectId primary key |
| `hospitalId` | Tenant key, indexed, stamped on insert and **added to every query** from the request context |
| `createdAt`, `updatedAt` | Timestamps |
| `createdBy`, `updatedBy` | User ids from the request context |
| `isDeleted`, `deletedAt`, `deletedBy` | Soft delete (where enabled); hidden from queries by default |

Embedded child lists (allergies, history, insurance) use soft removal (`removedAt`, `removedBy`).
Medical and financial collections have **no delete endpoint at all**.

## Entity relationship overview

```
Hospital 1─* Department 1─* Doctor *─1 Employee 1─0..1 User *─* Role(permissions[])
    │                     └─* Nurse  *─1 Employee
    ├─* Service (price list)
    └─* Counter (numbering)

Patient 1─* PatientDocument
   │ (embeds allergies[], medicalHistory[], insurances[])
   ├─* Appointment *─1 Doctor        Appointment 1─0..1 SlotLock (double-booking guard)
   │        └─0..1 Visit
   ├─* Visit 1─* VitalSign
   │      ├─0..1 NursingAssessment ─1 VitalSign
   │      ├─* ClinicalNote
   │      ├─* Diagnosis
   │      ├─0..1 TreatmentPlan
   │      └─* Prescription (embeds items[])
   └─* Invoice (embeds items[]) 1─* Payment 1─* Refund

User 1─* RefreshToken, PasswordResetToken, Notification
AuditLog (append-only, references any entity by name + id)
```

## Collections (Phase 1)

| Collection | Key fields | Indexes / constraints |
|---|---|---|
| `hospitals` | code, name, branding, currency, defaultTaxRate, `numbering.*` formats, `notifications.*` | `code` unique |
| `departments` | code, name, isClinical, isActive | `(hospitalId, code)` unique among non-deleted |
| `services` | code, name, category, price, taxable | `(hospitalId, code)` unique |
| `roles` | name, permissions[], isSystem | `(hospitalId, name)` unique |
| `users` | email, fullName, passwordHash (select:false), roleIds[], lockout fields, patientId? | `email` unique (global) |
| `refreshtokens` | userId, tokenHash, familyId, expiresAt, revokedAt | `tokenHash` unique, TTL purge |
| `passwordresettokens` | userId, tokenHash, expiresAt, usedAt | `tokenHash` unique, TTL |
| `employees` | employeeNo, names, cnic, departmentId, designation, joiningDate, employmentType, userId | `(hospitalId, employeeNo)` unique |
| `doctors` | employeeId, userId, departmentId, specialization, fees, slotMinutes, duty hours, workingDays | `(hospitalId, licenseNumber)` unique |
| `nurses` | employeeId, userId, departmentId, licenseNumber | `(hospitalId, licenseNumber)` unique |
| `patients` | mrn, names, searchName, cnic, dateOfBirth, gender, bloodGroup, contact, emergency contact, allergies[], medicalHistory[], insurances[] | `(hospitalId, mrn)` unique; `(hospitalId, cnic)` unique partial; `(hospitalId, phone)`; `searchName` |
| `patientdocuments` | patientId, category, fileName, contentType, sizeBytes, storageKey | `patientId` |
| `appointments` | appointmentNo, patientId, doctorId, departmentId, date, startTime, endTime, type, status, tokenNumber, visitId, history[] | `(hospitalId, appointmentNo)` unique; `(hospitalId, doctorId, date, startTime)`; `(hospitalId, date, status)` |
| `slotlocks` | key = `doctorId|date|startTime`, appointmentId | `(hospitalId, key)` unique — guarantees no double booking under concurrency |
| `visits` | visitNo, patientId, doctorId, type (OPD/IPD/Emergency), status, startedAt/endedAt, chiefComplaint, followUpDate | `(hospitalId, visitNo)` unique |
| `vitalsigns` | patientId, visitId, BP, HR, temp, SpO2, RR, weight, height, **bmi (computed)**, pain, flags[] | `(hospitalId, patientId, recordedAt)` |
| `nursingassessments` | appointmentId, visitId, vitalSignId, symptoms, notes, nurse | `appointmentId` unique |
| `clinicalnotes` | visitId, type, chiefComplaint, content, author | soft delete; `(hospitalId, patientId, createdAt)` |
| `diagnoses` | visitId, icdCode, description, type, doctorId | soft delete (retraction) |
| `treatmentplans` | visitId, plan, followUpDate | `visitId` unique |
| `prescriptions` | prescriptionNo, patientId, visitId, doctorId, status, items[] | `(hospitalId, prescriptionNo)` unique |
| `invoices` | invoiceNo, patient snapshot (mrn, name), source, status, items[] (with `sourceRef`), subtotal, discountTotal, taxTotal, total, paid, refunded, balance | `(hospitalId, invoiceNo)` unique; `(hospitalId, balance)`; `(hospitalId, issuedAt)` |
| `payments` | receiptNo, invoiceId, amount, method, reference, receivedBy, refunded | `(hospitalId, receiptNo)` unique |
| `refunds` | refundNo, paymentId, invoiceId, amount, reason | `(hospitalId, refundNo)` unique |
| `notifications` | userId? / patientId?, type, title, message, link, priority, readAt, deliveries[] | `(hospitalId, userId, readAt, createdAt)` |
| `counters` | hospitalId, key, year, seq | `(hospitalId, key, year)` unique |
| `auditlogs` | userId, userName, roles, action, module, entity, entityId, ip, before, after, meta, at | `(hospitalId, at)`, `(entity, entityId, at)`; update/delete hooks throw |

## Numbering

`counters` holds one document per hospital, key and year (year `0` for formats without a year token,
such as `EMP-{n:5}`, so those never reset). `findOneAndUpdate({$inc:{seq:1}}, {upsert:true})`
is atomic, so concurrent registrations always receive different numbers; the unique index on each
business number is a second safety net. Formats live on the hospital (`{code}-{yyyy}-{n:6}` →
`SH-2026-000001`) and are editable in **Hospital settings**.

## Collections (Phase 2)

| Collection | Key fields | Indexes / constraints | Maps to spec tables |
|---|---|---|---|
| `labtests` | code, name, category, sampleType, price, turnaroundHours, parameters[] (unit, type, refLow/High, criticalLow/High, refText) | `(hospitalId, code)` unique among non-deleted | LabTests |
| `laborders` | orderNo, patientId, visitId, doctorId, priority, status, items[] (test snapshot, price, results[] with value/unit/refRange/flag), sample{}, technician, verifiedBy/At, reviewedAt, hasAbnormal/hasCritical, invoiceId, history[] | `(hospitalId, orderNo)` unique; `(hospitalId, status, createdAt)`; `(hospitalId, doctorId, status)` | LabOrders, LabOrderItems, LabResults (the report is rendered from a Verified order — LabReports) |
| `items` | sku, name, category (Medicine / Surgical Supplies / Consumables / General Medical Supplies), genericName, form, strength, unit, defaultSupplierId, purchase/selling price, reorderLevel, isControlled, **currentStock**, stockByLocation{Main Store, Pharmacy} | `(hospitalId, sku)` unique; `searchName`; `category` | Medicines + InventoryItems |
| `batches` | itemId, batchNo, location, expiryDate, mfgDate, quantity (≥ 0), unitCost, supplierId | `(hospitalId, itemId, batchNo, location)` unique; FEFO index `(itemId, location, expiryDate)`; expiry index | MedicineBatches |
| `inventorytransactions` | itemId, batchId, type, signed quantity, balanceAfter, unitCost, refType/refId/refNo, reason, byName, at | `(hospitalId, itemId, at)`; `(hospitalId, type, at)`; update/delete hooks throw | InventoryTransactions |
| `suppliers` | code, name, contact, phone, email, address, taxNumber, paymentTermsDays | `(hospitalId, code)` unique | Suppliers |
| `purchaseorders` | poNo, supplierId, status, items[] (qty, receivedQuantity, price, discount, tax, total), totals, expectedDelivery, approvedBy/At, orderedAt, history[] | `(hospitalId, poNo)` unique | PurchaseOrders, PurchaseOrderItems |
| `goodsreceipts` | grnNo, poId, supplierId, location, invoiceRef, lines[] (batchId, batchNo, expiry, qty, unitCost) | `(hospitalId, grnNo)` unique | Goods receipt |
| `dispenses` | dispenseNo, prescriptionId, patient snapshot, lines[] (item, qty, price, FEFO allocations[]), total, invoiceId, witnessName | `(hospitalId, dispenseNo)` unique | Dispensing history |
| `controlleddruglogs` | item, batchNo, quantity, balanceAfter, patient, prescription, prescriber, dispensedBy, witnessName | `(hospitalId, at)` | Controlled medicine log |

**Stock integrity.** `items.currentStock` and `stockByLocation` are denormalised totals maintained in
the same transaction as the batch change and its ledger row (`inventory/stock.service.ts` is the only
writer). Decrements use `findOneAndUpdate({ quantity: { $gte: n } })`, so concurrent dispenses cannot
drive a batch negative. Expired batches stay on hand (and in `currentStock`) until written off; FEFO
dispensing never touches them.

## Collections (Phase 3)

| Collection | Key fields | Indexes / constraints | Maps to spec tables |
|---|---|---|---|
| `emergencycases` | caseNo, patientId, visitId (Emergency), arrivalAt, arrivalMode, presentingComplaint, status, triageLevel/triageRank (current), triage[] (level, notes, vitalSignId, at, by), assignedDoctor, treatmentStartedAt, disposition{type, notes, referredTo, admissionId}, invoiceId, events[] | `(hospitalId, caseNo)` unique; board index `(status, triageRank, arrivalAt)` | EmergencyCases, TriageRecords |
| `wards` | code, name, type, departmentId, floor, chargePerDay | `(hospitalId, code)` unique | Wards |
| `rooms` | wardId, roomNo | `(hospitalId, wardId, roomNo)` unique | Rooms |
| `beds` | wardId, roomId, bedNo, chargePerDay?, status, currentAdmissionId, reservedForPatientId | `(hospitalId, roomId, bedNo)` unique; `status` | Beds |
| `admissions` | admissionNo, patientId, visitId (IPD), source, emergencyCaseId, attending doctor, assigned nurse, current bedId/wardId, stays[] (bed, ward, rate, from, to), reason, provisionalDiagnosis, admittedAt, expectedDischargeAt, status, notes[] (Progress/Nursing/Event), discharge{…}, invoiceId | `(hospitalId, admissionNo)` unique; **one active admission per patient** (unique partial on `status: 'Admitted'`) | Admissions, Discharges (discharge details live on the admission they close) |
| `insuranceclaims` | claimNo, patient & invoice snapshot, policy snapshot (provider, policyNumber, coverage %, limit, expiry), claim/approved/rejected/paid amounts, status, submitted/decided/paid dates, payerReference, paymentId, history[], isLive | `(hospitalId, claimNo)` unique; **one live claim per invoice** (unique partial on `isLive`) | InsuranceClaims |

**Bed integrity.** A bed is claimed with one conditional update (`status ∈ {Available, Reserved-for-this-patient}` → `Occupied`), so two admissions can never take the same bed. Bed-day charges are derived from `admissions.stays`, so transfers bill each ward at its own rate.

## Collections (Phase 4)

| Collection | Key fields | Indexes / constraints | Maps to spec tables |
|---|---|---|---|
| `employees` (extended) | + reportingManagerId, shiftStart/End, exitDate, hiredFromCandidateId | `(hospitalId, employeeNo)` unique | Employees |
| `contracts` | employeeId, contractNo, type, start/end, basicSalary, notice, probation, terms, status, termination | `(hospitalId, contractNo)` unique | EmployeeContracts |
| `performancereviews` | employeeId, period, rating 1–5, goals/strengths/improvements, status (Draft → Submitted → Acknowledged), reviewer, employeeComment | `(hospitalId, employeeId, period)` unique | PerformanceReviews |
| `attendances` | employeeId, departmentId, date (`YYYY-MM-DD`), clockIn/Out, status, late/early/worked/overtime minutes, source (Self/Manual/System), note, leaveRequestId | `(hospitalId, employeeId, date)` **unique**; `(hospitalId, date, status)` | Attendance |
| `leaverequests` | requestNo, employee snapshot, managerId, type, from/to, days, halfDay, reason, status, managerDecision{}, hrDecision{}, cancellation | `(hospitalId, requestNo)` unique; `(employeeId, from, to)` for overlap checks | LeaveRequests |
| `leavebalances` | employeeId, year, type, entitled, used, pending | `(hospitalId, employeeId, year, type)` unique | LeaveBalances |
| `salarystructures` | employeeId, effectiveFrom, basic, allowances[], deductions[], taxPercent, overtimeRatePerHour?, bank | `(employeeId, effectiveFrom desc)` | SalaryStructures |
| `payrollruns` | runNo, period, workingDays, status, totals, employees, preparedBy (createdBy), approvedBy/At, processedAt, history[], isLive | `(hospitalId, runNo)` unique; **one live run per period** (unique partial on `isLive`) | PayrollRuns |
| `payrollitems` | runId, employee snapshot, salary snapshot, attendance inputs (present/absent/leave/overtime), computed allowances/overtime/gross/deductions/tax/net, bonus/otherDeduction + note | `(hospitalId, runId, employeeId)` unique | PayrollItems |
| `payslips` | payslipNo, runId, itemId, employeeId, period, gross, totalDeductions, net | `(hospitalId, payslipNo)` unique; `(hospitalId, employeeId, period)` unique | Payslips |
| `jobpostings` | jobNo, title, departmentId, type, openings/filled, description, requirements, salary range, closingDate, status | `(hospitalId, jobNo)` unique | JobPostings |
| `candidates` | jobId, name, gender, contact, cnic, source, experience, expected salary, stage, history[], resume{storageKey}, employeeId | `(hospitalId, jobId, email)` unique | Candidates |
| `interviews` | candidateId, jobId, scheduledAt, duration, mode, location, panel[], status, evaluation{scores, overall, recommendation, comments} | `(hospitalId, scheduledAt)` | Interviews |
| `offerletters` | offerNo, candidate snapshot, designation, department, type, basic + allowances, joining/expiry dates, terms, status, approvedBy, history[] | `(hospitalId, offerNo)` unique | OfferLetters |

**Payroll integrity.** Pay is computed by `computePay` in `shared/src/hr-rules.ts` (the same function the tests use): daily rate = basic ÷ working days; absences and unpaid leave reduce taxable pay; tax = taxable × tax %. Items are frozen once a run is approved; processing writes payslips in the same transaction.

## Collections (Phase 5)

| Collection | Key fields | Indexes / constraints | Maps to spec tables |
|---|---|---|---|
| `medicationschedules` | patientId, prescriptionId/No, prescriptionItemId, doctor, medicine, dosage, instructions, timesPerDay, durationDays, times[], start/end, totalDoses, chronic, status (Active/Completed/Stopped), stop reason, refill/follow-up/missed-alert timestamps | `(hospitalId, prescriptionItemId)` **unique** (one schedule per prescription line) | MedicationSchedules |
| `medicationdoses` | scheduleId, patientId, medicine, scheduledAt, status (Pending/Taken/Skipped/Missed/Cancelled), remindedAt, recordedAt/By/Name, note | `(hospitalId, status, scheduledAt)` for the reminder job; `(hospitalId, patientId, scheduledAt)` | MedicationReminders, missed-dose tracking |

## Additions in the completion pass

| Collection / field | Purpose | Indexes / constraints |
|---|---|---|
| `hospitals.catalog` | appointmentTypes[] (code, label, feeBasis, isActive), paymentMethods[], medicineCategories[], designations[] (empty = free text), medicationScheduleFrom | Codes in use cannot be removed (checked on save) |
| `appointments.type` | Now a catalog code (was a fixed enum); `reminderSentAt` added for the 24-hour reminder | — |
| `items.therapeuticClass` | Medicine category from the catalog | indexed |
| `laborders.attachments[]` | Uploaded report files (name, type, size, storage key, uploader, time); `assignedByName`, `assignedAt` for technician assignment | — |
| `purchaserequests` | requestNo, status (Draft → Submitted → Approved/Rejected → Converted / Cancelled), requester, neededBy, justification, items[] (item snapshot, qty, stock at request, note), decision, poId/poNo, history[] | `(hospitalId, requestNo)` unique |
| `schemamigrations` | `_id` = migration id, description, appliedAt, per-hospital results | primary key |

## Additions for the final directive (18 Oct 2026)

| Collection / field | Purpose | Indexes / constraints |
|---|---|---|
| `patientconsents` | patientId, type (Treatment, DataSharing, SmsMessages, EmailMessages, PushNotifications), granted, method (Written/Verbal/Portal), note, recordedBy/Name, recordedByPatient, at | Append-only: update/delete hooks throw. Latest per type = current decision |
| `idempotencyrecords` | userId, key, route, bodyHash, state (processing/done), statusCode, response | `(hospitalId, userId, key)` **unique**; TTL 24 h on `createdAt` |
| `clinicalnotes.versions[]` | Previous chiefComplaint/content with savedAt, byName, reason; `amendedAt`, `amendmentReason` on the note | Earlier versions are never removed |
| `invoices.paymentReminders`, `invoices.lastPaymentReminderAt` | Overdue-balance reminder count (max 3) and last reminder time | — |
| `notifications.deliveries[].status` | Now `Sent`, `Logged`, `Failed`, `Skipped`, `OptedOut` | — |

Notification history uses the existing `notifications` collection (`deliveries[]` records each external channel's outcome). Reports read existing collections only; nothing is stored.
