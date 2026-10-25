# Testing

## Automated (API, end to end)

```bash
npm run db:start
```
```bash
npm test
```

`server/tests/phase{1..5}.workflow.test.ts` boot the real Express app against a separate `hms_test`
database (dropped and re-seeded per file) and drive it over HTTP with cookie sessions, exactly as the
browser does. Appointment slots are taken from the availability API and dates are computed relative to
today. Between 19:00 and 07:00 `tests/setup-clock.ts` moves the clock (Date only) to 10:00 the same
day, because same-day booking has no free slots left late in the evening. Last run (25 Oct 2026):
**114/114 passing** (20 Phase 1 + 13 Phase 2 + 15 Phase 3 + 15 Phase 4 + 11 Phase 5 + 20 completion +
14 end-to-end + 3 verification (remember-me, log redaction) + 3 transaction tests). Lint: `npm run lint`
(0 errors; 28 `no-explicit-any` warnings tracked as debt). `e2e.workflow.test.ts` drives the whole journey (registration →
nursing → consultation → lab with second-person verification → idempotent dispensing → billing with
idempotent payment → portal access → consent opt-out → audit) with explicit role-restriction checks.

Backup/restore is verified manually: `npm run db:backup`, then
`scripts/restore.ps1 -Archive <file> -TargetUri "mongodb://127.0.0.1:27018/hms_restore_check?replicaSet=rs0"`
and `node scripts/count-docs.mjs "mongodb://127.0.0.1:27018/?replicaSet=rs0" hms_restore_check`.
Last drill 18 Oct 2026: 2,679 of 2,679 documents restored, 0 failures (restore script fixed the same
day so the target database always comes from the URI).

`transactions.test.ts` proves `withTransaction` is re-entrant: a nested call joins the outer
transaction, so an outer failure rolls back the inner writes too.

### Completion-pass coverage (`completion.workflow.test.ts`)
| Area | What is verified |
|---|---|
| Sorting | Patients by `mrn` / `-mrn` and invoices by `-total` come back in order; an unlisted key (`cnic`) → 400 naming the allowed keys |
| Designations | With a list defined, "Astronaut" → 422 `unknown_designation`, "staff nurse" (case-insensitive) accepted; clearing the list returns to free text |
| Catalog | Anyone reads it; reception cannot change it (403); admin adds a "Teleconsult" type, disables Online payments, adds a medicine category; removing a used code → 422; duplicate code → 400 |
| Booking & billing | Unknown type → 422; Teleconsult booked, consulted and billed at the follow-up fee with its label; Online payment → 422 `payment_method_disabled`, Cash accepted |
| Medication | Prescribing creates the schedule immediately (20 doses for 2×/day × 10 days); cancelling the prescription stops it with no pending doses |
| Inventory | Unknown therapeutic class → 422; configured class saved |
| Appointment reminders | One reminder (with SMS + email delivery records) an hour before; a second pass sends none |
| Laboratory | Technician list excludes administrators (assigning one → 422); nurse cannot assign (403); non-technician assignee → 422; assignment appears in "assigned to me"; PDF upload accepted, fake PDF → 422; supervisor downloads; patient 403; reception cannot upload |
| Purchase requests | Pharmacist creates PR-…; cannot approve (403); approving a draft → 409; reject needs reason; inventory manager approves and converts → Draft PO with the request quantity and reference; converting twice → 409; requester cannot approve own request (403) |
| Reports & dashboard | Department filter on outstanding, demographics, lab TAT, insurance, adherence (named in subtitle); expiry range keeps expired stock; today's revenue KPI |
| Migrations | Recorded run of 3 migrations restores a removed system-role permission; second run applies nothing |
| Audit | Catalog change, lab assignment/upload/download, purchase request lifecycle, medication schedule creation/stop all audited |

### Phase 5 coverage
| Area | What is verified |
|---|---|
| Schedules | Dispensing a seeded prescription creates one schedule per line with `timesPerDay × durationDays` doses; schedules are never duplicated |
| Portal | Patient sees medicines, adherence and today's doses; a due dose is marked taken once (second time 422); a future dose → 422 |
| Access | Reception cannot read or record doses (403); patients cannot use the staff endpoint or another patient's schedule (403) |
| Reminder times | Wrong number of times → 422; new times re-plan the same number of future doses at the new times |
| Stop | Patient cannot stop (403); reason required (400); pharmacist stops → pending doses cancelled, patient notified |
| Engine | Running the job 3 days ahead marks missed doses, alerts the prescriber with a High-priority `MissedDose` and the patient; a second pass sends no duplicate alerts |
| Reports | All 17 reports run and return consistent columns/rows; real data (inflow, appointments, reorder and expired stock, payroll, adherence); department filter narrows and is named in the subtitle |
| Exports | Excel (`PK` zip signature), PDF and CSV (exact header) downloads; exports audited |
| Report access | Invalid key / reversed dates → 400; nurse sees adherence but not revenue (403); accountant revenue ✓ attendance 403; HR attendance ✓ revenue 403; patients get an empty catalogue |

### Phase 4 coverage
| Area | What is verified |
|---|---|
| Attendance | Clock in once (second → 409), clock out (second → 409); patients have no self-service; staff cannot read the HR register (403); close-day marks absentees once (idempotent) and never overwrites punches; future day → 422; manual correction with reason → Late 35 min / overtime 105 min; missing reason → 400 |
| Leave | Request reserves pending days; overlap → 409; beyond balance → 422 `insufficient_balance`; HR before manager → 409; non-manager → 403; manager → HR approval, employee notified; cancel restores the balance; rejection needs a reason |
| Payroll | Run number format; one run per month (409); future month → 422; net pay equals `computePay`; adjustment recomputes; preparer cannot approve (403); payroll officer cannot approve (403); process before approval → 409; approved items locked (422); payslips issued; employee downloads own PDF, another's → 403 |
| Recruitment | Job and candidate; duplicate application → 409; stage skipping → 409; interview moves to Interview; evaluation overall = mean; offer number; author cannot approve (403); offer PDF; hire before acceptance → 422; hire creates employee (EMP number), contract and salary; second hire → 409; single-opening job closes |
| Cross-cutting | HR stats & 14-day trend; executive staff-attendance chart; 14 Phase 4 audit actions present |

### Phase 3 coverage
| Area | What is verified |
|---|---|
| ER registration | Unknown patient → provisional record with MRN + `ER-` case number; duplicate open case → 422; CNIC match reuses the existing patient; desk triage in one step |
| Triage | Critical triage with vitals; doctors receive a Critical `EmergencyAlert`; board sorted Critical first |
| ER treatment | Reception cannot take a case (403); discharge before treatment → 409; non-doctor disposition → 403; doctor note |
| ER → IPD | Disposition "Admitted" creates the admission, occupies the bed, bills the emergency consultation (2,500) — one transaction; LWBS creates no charge |
| Admission | Direct admission number format; same patient twice → 409; occupied bed → 409 `bed_unavailable` |
| Transfer & beds | Transfer creates a second stay; old bed → Cleaning; manual Occupied → 422; nurse marks bed cleaned |
| Ward notes | Nurse and doctor notes; reception 403; billing staff see only event notes |
| Discharge | Reception 403; attending doctor discharges; IPD invoice = 2 days × 5,000 (general) + 1 day × 15,000 (private) = 25,000; summary PDF; second discharge → 422 |
| Insurance | Claim over coverage % → 422; default amount = 80 % of 5,000 = 4,000 (within 5,000 limit); duplicate claim → 409; settle before approval → 409; partial approval 3,000 → settlement posts an Insurance payment, invoice balance 2,000; remaining limit enforced (`limit_exceeded`); reject → reopen; expired policy → 422; nurse 403 |
| Dashboards & audit | ER, admission and occupancy KPIs; all Phase 3 actions audited |

### Phase 2 coverage
| Area | What is verified |
|---|---|
| Lab ordering | Doctor orders CBC + FBS during consultation; order number format; Laboratory invoice created with both test prices |
| Lab workflow | Worklist; skipping sample collection → 409; receive → collect (barcode = order no.) → start; incomplete final entry → 422; flags computed server-side (Hb 6.5 → LL, platelets 420 → H); `hasCritical` |
| Verification | Same technician cannot verify (403); a second lab user verifies; verified orders cannot be reopened (409); patient portal sees only own verified orders |
| Doctor | Critical-priority notification; review; report PDF; EMR shows the verified order |
| Access | Pharmacy cannot enter results, reception cannot read lab orders (403) |
| Dispensing | Formulary shows usable stock; nurse cannot dispense (403); **FEFO**: 40 units from the batch expiring in ~25 days first, then the next; the expired batch is untouched; stock −50; Pharmacy invoice = 50 × selling price |
| Pharmacy rules | Over-dispensing → 422; insufficient stock → 422 `insufficient_stock` with stock unchanged (rollback); controlled medicine without witness → 422, with witness → logged in the register |
| Inventory | Write-off larger than batch → 422; expired batch written off; store → pharmacy transfer; nurse cannot adjust (403) |
| Purchasing | Totals; ordering before approval → 409; self-approval → 403; approval without permission → 403; partial receipt → PartiallyReceived; expired lot and over-receipt → 422; full receipt → Received and stock +40; cancel after receipt → 422 |
| Audit | lab, dispensing, stock and purchasing actions all audited; ledger rows immutable |

| Area | What is verified |
|---|---|
| Security | anonymous calls → 401; writes without CSRF header → 403; lockout after 5 failures; refresh-token rotation and reuse detection; HR/nurse/reception blocked from patients/billing/audit at the API |
| Registration | MRN format `SH-YYYY-NNNNNN`; duplicate CNIC blocked; likely-duplicate warning; server-side field validation |
| Appointments | booking; double booking rejected (409); invalid status transition rejected (409); check-in opens visit and token |
| Nursing | queue; vitals; **BMI auto-calculated (26.1 for 80 kg/175 cm)**; abnormal BP flagged; status → Ready for doctor |
| Clinical | nurse cannot write doctor notes (403); doctor queue; EMR shows vitals and allergies; completion blocked without note/diagnosis; allergy-conflicting prescription blocked; prescription number & PDF |
| Billing | consultation invoice auto-generated; overpayment rejected; partial → paid; receipt PDF; partial refund re-opens balance |
| Portal | patient sees own EMR & invoices only; 403 for anyone else's |
| Audit | every sensitive action present; audit entries cannot be modified |
| Admin | role permission change; dashboard KPIs |

## Manual smoke test (UI)

1. `reception@` → Register patient → MRN shown → Book appointment for today with `doctor@` → Check in.
2. `nurse@` → Nursing queue → Start assessment → enter vitals (watch BMI and red highlights) → Submit.
3. `doctor@` → My consultations → See patient → Start → note, diagnosis, prescription → Complete.
4. `accounts@` → Billing → open the new OPD invoice → Record payment → Print receipt.
5. `patient@` → My records / My bills / My medicines → mark today's dose as taken.
6. `nurse.<name>@` (any staff nurse) → My workspace → Clock in → Leave → Apply; `nurse@` → My workspace → My team → Approve; `hr@` → Leave approvals → Approve.
7. `payroll@` → Payroll → New payroll run → Submit; `hr@` → Approve; `payroll@` → Process → open a payslip.
8. `recruitment@` → Recruitment → candidate → Shortlist → Schedule interview → Evaluate → Move to Selected → Draft offer → Submit; `hr@` → Approve → Mark as sent → Accepted → Hire.
9. `admin@` → Reports → Revenue by department → Run → Excel / PDF / Print.
10. `admin@` → Audit log shows each step with old/new values.

## Static checks

```bash
npm run typecheck
```
