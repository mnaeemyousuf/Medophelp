# QA and Test Report

Run date: 18 Oct 2026. Every result below is from a command that ran in this session. Nothing is reported as passing without having run.

## 1. Summary

| Check | Command | Result |
|---|---|---|
| API test suite (unit + workflow + end-to-end) | `npm test` | **114 / 114 passed**, 9 files (latest run 25 Oct 2026, after the Medophelp rebrand, the idempotency race fix and the new verification tests) |
| Typecheck (shared, server, client; TypeScript `strict`) | `npm run typecheck` | **0 errors** |
| Production build (server tsup + client tsc/vite) | `npm run build` | **Succeeded** (client main chunk 464 kB / 140 kB gzip) |
| Lint | `npm run lint` (ESLint 9, typescript-eslint recommended, React Hooks rules; added 25 Oct) | **0 errors, 28 warnings** — all warnings are `no-explicit-any` in server code (mostly Mongoose query typing), kept visible as tracked debt. 6 genuine findings fixed (unused imports/variables, one expression statement); `any` allowed in test fixtures |
| Dependency audit (production deps) | `npm audit --omit=dev` | **4 moderate** advisories, 0 high/critical (§6) |
| Backup | `npm run db:backup` | `backups/hms-20261018-0021.gz` written |
| Restore drill | `scripts/restore.ps1` → `hms_restore_check` | 2,679 / 2,679 documents restored, 0 failures (after fixing the script, §5) |
| PDF manuals | `node tools/manuals/build-manuals.mjs` | **14 / 14 passed** automated validation; sample pages inspected visually (§7) |

The last code change (`server/src/config/env.ts`: blank optional variables treated as unset) was followed by a typecheck (0 errors) and the 11:21 full suite run (111/111).

## 2. Test inventory

| File | Tests | Covers |
|---|---|---|
| `phase1.workflow.test.ts` | 20 | Auth & security (anonymous refused, CSRF, lockout, refresh rotation and reuse, API-level permissions); registration, duplicate CNIC; validation; booking and double booking; status transitions; check-in; vitals with BMI; doctor consult with allergy-checked prescription; auto billing; payment and overpayment; portal isolation; audit; role permission changes |
| `phase2.workflow.test.ts` | 13 | Lab order → sample → results → flags → second-person verification → doctor review/print; role refusal; formulary prescribing; FEFO dispensing, over-dispense, controlled-drug witness; negative stock, write-off, transfer; PO segregated approval and partial receipt; audit and immutable ledger |
| `phase3.workflow.test.ts` | 15 | ER quick registration, CNIC match, triage alerts, take case, ER → admission in one transaction, LWBS; IPD admit/double-admit, transfer, ward notes, discharge and bed-day billing; insurance coverage/limits, partial approval, settlement, reject → reopen, role refusal; dashboards |
| `phase4.workflow.test.ts` | 15 | Clock in/out; HR register; close day; corrections; leave balances, overlap, manager → HR order, cancel, reject; payroll build, pay formula, segregated approval, own payslips only; recruitment pipeline with segregated offers; HR dashboard |
| `phase5.workflow.test.ts` | 11 | Medication schedules, doses, adherence, time windows, permissions, re-planning, stop, reminder engine; 17 reports, filters, Excel/PDF/CSV exports, per-report permissions |
| `completion.workflow.test.ts` | 20 | Configurable catalog; sorting; designations; prescribe-time schedules; follow-up fee; payment methods; therapeutic classes; appointment reminders; **payment reminders (new)**; lab assignment and uploads; purchase requests; report filters; migrations; audit |
| `e2e.workflow.test.ts` | 14 | Full journey (below) |
| `transactions.test.ts` | 3 | Re-entrant `withTransaction`; rollback |

## 3. End-to-end workflow test (`e2e.workflow.test.ts`)

Synthetic patient “Zara” (CNIC 42101-5550123-4). All 14 steps passed.

1. Reception registers the patient. The same CNIC again → **409**.
2. Appointment booked and checked in. The same slot again → **409**.
3. Nurse records vitals: BMI 25.9 calculated; `TEMP` and `HR` flagged.
4. Doctor sees the patient in the queue. A **pharmacist editing the note → 403**. Amending the note keeps one earlier version with a reason. A diagnosis is recorded.
5. Doctor prescribes paracetamol from the formulary (9-dose schedule created) and orders a CBC; the consultation is completed.
6. Lab receives the order, collects, starts and enters results. **The same technician verifying → 403.** The supervisor verifies; the report PDF is produced.
7. The doctor is notified and reviews the result.
8. Pharmacy dispenses with `Idempotency-Key`. A retry is **replayed** (header `Idempotent-Replayed: true`) and stock falls by exactly 9. Reusing the key with a different body → **422**.
9. OPD, Laboratory and Pharmacy invoices were generated automatically.
10. Payment with an idempotency key:
    * replayed on retry; reused key with a different amount → **422**;
    * PartiallyPaid → Paid; receipt PDF produced;
    * **reception refund → 403**; the accountant refunds 100.
11. Reception enables portal access; a second attempt → **409**. Signing in with the temporary password works, but other APIs return **403 `password_change_required`** until the password is changed.
12. The patient sees their own prescription, verified lab result and bills. Requests for another patient's records are refused.
13. The patient opts out of SMS. With SMS and email enabled, the delivery result is `{Sms: 'OptedOut', Email: 'Logged'}`. Integrations all report unconfigured.
14. Audit actions exist for each step.

## 4. Explicit role-restriction checks (automated)

| Restriction | Test |
|---|---|
| Anonymous requests refused (401) | phase1 |
| Writes without the CSRF header refused | phase1 |
| Permissions enforced at the API, not just hidden in the UI | phase1 |
| Nurse cannot write doctor notes | phase1 |
| Pharmacist cannot edit clinical notes | e2e 4 |
| Pharmacy and reception cannot touch lab results | phase2 |
| Same technician cannot verify own results | phase2, e2e 6 |
| Nurse cannot dispense | phase2 |
| Requester cannot approve own PO / purchase request | phase2, completion |
| Reception cannot write ward notes; only the attending doctor discharges | phase3 |
| Non-billing roles cannot manage insurance claims | phase3 |
| Patients have no self-service; staff cannot read the HR register | phase4 |
| Payroll preparer cannot approve; payroll officers cannot approve at all | phase4 |
| Offer drafter cannot approve | phase4 |
| Employees see only their own payslips | phase4 |
| Staff without medication rights refused; patient cannot reach another record | phase5 |
| Per-report permissions | phase5 |
| Receptionist cannot refund | e2e 10 |
| Portal patient sees only own data | phase1, e2e 12 |
| Temporary password blocks all non-auth APIs | e2e 11 |

## 5. Defects found and fixed in this pass

| # | Defect | Found by | Fix | Verified |
|---|---|---|---|---|
| 1 | Temporary/reset passwords enforced only in the browser | Code audit | API returns 403 `password_change_required` | e2e 11 |
| 2 | Double payment/refund/dispense possible on retry or double click | Audit | Idempotency middleware + client keys | e2e 8, 10 |
| 3 | Unconfigured SMS/email recorded as “Sent” | Audit | Delivery statuses Logged/Skipped/OptedOut | e2e 13 |
| 4 | No way to give a newly registered patient portal access | Gap analysis | Portal access card + API | e2e 11 |
| 5 | Clinical notes overwritten on edit | Research (record integrity) | Version history with reason | e2e 4 |
| 6 | Test suite failed after 19:00 (no same-day slots) | Full run at 23:43 | `tests/setup-clock.ts` | 111/111 at 11:07 and earlier 00:13 run of completion suite |
| 7 | Mobile bottom-bar labels all read “My” | Screenshot review | `shortLabel()` in `Layout.tsx` | Screenshot `patient-mobile-home.png` |
| 8 | Money shown as “PKR 3,212.5” | Screenshot review | `money()` shows 2 decimals for fractions | Screenshot |
| 9 | Copying `.env.example` (blank `SMS_GATEWAY_URL=`) stopped the server from starting; example listed variables the server never reads | Doc review | Blank = unset; example corrected | Manual check (`gateway configured: false`) |
| 10 | `restore.ps1` passed the URI database to an archive restore: restored 0 documents into a scratch DB, and could target `hms` | Restore drill | Target DB from URI + `nsInclude/nsFrom/nsTo` | Drill 2,679/2,679 |
| 11 | Idempotency record was marked done on the response `finish` event, so a retry arriving immediately could get 409 `request_in_progress` (seen 25 Oct under load) | Full suite run with dev servers active | Outcome stored before the response is sent; keys released if a response bypasses `res.json` | e2e 14/14 twice, full suite 8/8 files |
| 12 | Log redaction covered only one level of nesting: a CNIC at `data.patient.cnic` reached the log in clear text | New redaction test (probe) | Sensitive keys redacted at top level and two levels down | `verification.test.ts` |

## 6. Dependency audit (production)

| Package | Severity | Advisory | Assessment |
|---|---|---|---|
| `react-router` / `react-router-dom` 6.x | Moderate | Open redirect via backslash in `<Link>`/`useNavigate`; SSR hydration issue | The app never navigates to user-supplied paths (notification links are server-generated) and does not use SSR. The fix requires React Router 7 (major upgrade). **Open.** |
| `uuid` via `exceljs` | Moderate | Missing buffer bounds check when a buffer is passed | Server-side report export only. The fix requires an exceljs change. **Open.** |

## 7. PDF manual validation

The validator (`tools/manuals/build-manuals.mjs`) checks for every PDF:

* the file exists and opens with pdf.js;
* the page count;
* extractable text (more than 5,000 characters, and no page under 20 characters);
* the number of embedded images is at least the number of figures;
* the TOC page numbers equal the page where each heading is found (two-pass build, then re-checked);
* no missing screenshots;
* no element wider than the printable area.

Results are in `tools/manuals/build/validation.json`. All 14 pass.

| Manual | Pages | Figures | TOC entries |
|---|---|---|---|
| 01 Super Admin | 42 | 24 | 27 |
| 02 Hospital Admin | 41 | 25 | 26 |
| 03 Receptionist | 39 | 23 | 27 |
| 04 Nurse | 34 | 16 | 25 |
| 05 Doctor | 43 | 24 | 30 |
| 06 Lab Technician | 36 | 19 | 25 |
| 07 Pharmacist | 36 | 20 | 23 |
| 08 Inventory & Procurement | 36 | 22 | 24 |
| 09 Accountant | 38 | 21 | 27 |
| 10 HR Manager | 41 | 26 | 28 |
| 11 Payroll Officer | 34 | 21 | 23 |
| 12 Recruitment Officer | 30 | 17 | 20 |
| 13 Patient Portal | 27 | 15 | 20 |
| 14 Management Reporting | 26 | 14 | 18 |

* **Visual check:** sample pages were rendered with `tools/manuals/render-pages.mjs` and inspected — cover, contents, dashboard and feature pages of the Receptionist manual. Headers, footers, page numbers and the TOC were correct, and screenshots were legible with no overflow.
* **Screenshots:** about 30 of the 119 were opened individually and confirmed to show the intended screen with synthetic data.
* **Capture details:** all screenshots come from the running app at 1440×900 (scale 1.25). The patient portal also has 390×844 mobile shots. Final capture was on 18 Oct 2026 after a reseed, with 0 failed capture steps.

## 8. Not tested / limitations

* No browser-automation E2E test suite (Playwright/Cypress) runs in CI. The UI was exercised through the screenshot capture script only, which fails a step when an expected button is missing.
* No load or performance test.
* No formal accessibility (WCAG) audit.
* Remember-me cookie lifetime and log redaction have no dedicated tests.
* SMS, email and push delivery to real providers was not tested (no providers configured). Only demo mode was exercised; the HTTP SMS gateway adapter has no automated test and has never sent a message.
* No usability testing with real hospital staff.
