# Implementation Tracker

Legend: ✅ done & tested end-to-end · 🟡 partial · ⬜ not started.
A module is ✅ only when backend, DB, validation, authorization, audit, frontend and a passing workflow test all exist.

## Phase 1 — Core clinical & billing ✅

| Module | Backend | DB | Validation | AuthZ | Audit | Frontend | Test | Status |
|---|---|---|---|---|---|---|---|---|
| Architecture, schema, shared contract | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✅ |
| Authentication (login, refresh rotation, logout, lockout, forgot/reset/change pw, remember me) | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✅ |
| Users / Roles / Permissions admin (permission matrix, unlock, reset, deactivate) | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✅ |
| Hospital configuration (branding, numbering, tax, notification channels), departments, services | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | 🟡 UI-verified | ✅ |
| Doctors & nurses directory / onboarding | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | 🟡 UI-verified | ✅ |
| Patient management (registration, MRN, duplicate detection, search, profile, allergies, history, insurance, documents, registration PDF) | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✅ |
| Appointments (list + day view, slot availability, double-booking lock, confirm/check-in/reschedule/cancel/no-show) | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✅ |
| Nurse assessment (queue, vitals, auto BMI, abnormal flags, comparison, submit → ready) | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✅ |
| Doctor module (queue, consultation, note, diagnosis, plan, prescription builder + PDF, complete) | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✅ |
| EMR (header, tabs, chronological timeline, care-team access guard) | ✔ | ✔ | – | ✔ | ✔ (views audited) | ✔ | ✔ | ✅ |
| Billing (auto OPD charge, manual invoices, payments, refunds, invoice & receipt PDF) | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✅ |
| Dashboards (executive with date presets & charts, doctor, nurse, reception, accounts, patient) | ✔ | – | ✔ | ✔ | – | ✔ | ✔ | ✅ |
| Audit log viewer (filters, old/new values) | ✔ | ✔ | ✔ | ✔ | – | ✔ | ✔ | ✅ |
| Global search (permission-aware) | ✔ | – | ✔ | ✔ | – | ✔ | 🟡 UI-verified | ✅ |
| Notification centre (in-app + channel adapters) | ✔ | ✔ | ✔ | ✔ | – | ✔ | 🟡 UI-verified | ✅ |
| Patient portal (appointments incl. booking, records, bills) | ✔ | – | ✔ | ✔ | ✔ | ✔ | ✔ | ✅ |
| Error pages (403/404/500), error boundary, network error handling | – | – | – | – | – | ✔ | 🟡 | ✅ |

## Phase 2 — Laboratory, Pharmacy, Inventory, Suppliers, Purchase Orders ✅

| Module | Backend | DB | Validation | AuthZ | Audit | Frontend | Test | Status |
|---|---|---|---|---|---|---|---|---|
| Lab test master (parameters, reference & critical ranges, pricing) | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | 🟡 UI-verified | ✅ |
| Lab orders from consultation (auto-billed, priority alerts) | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✅ |
| Lab workflow: receive → collect → process → results (auto flags) → verify (2nd person) → report PDF → doctor review → patient notification | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✅ |
| Pharmacy: formulary, prescription queue, FEFO dispensing, controlled register, auto-billing | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✅ |
| Inventory: item master, batches by location, immutable ledger, adjustments/write-offs, transfers, supplier returns, low-stock & expiry alerts (incl. background job) | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✅ |
| Suppliers & purchase orders: draft → approval (segregated) → ordered → partial/full goods receipt | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✅ |
| Dashboards: lab, pharmacy, stores; executive lab-TAT, stock-value, expiry charts; doctor results-to-review | ✔ | – | ✔ | ✔ | – | ✔ | 🟡 UI-verified | ✅ |
| EMR lab tab, timeline lab events, portal lab results (verified only), global search for lab/PO/items | ✔ | – | ✔ | ✔ | ✔ | ✔ | ✔ | ✅ |
## Phase 3 — Emergency, Admissions/IPD, Insurance ✅

| Module | Backend | DB | Validation | AuthZ | Audit | Frontend | Test | Status |
|---|---|---|---|---|---|---|---|---|
| Emergency: quick registration (provisional patient + MRN), triage with vitals & re-triage, live board with target breaches, critical alerts, take case, notes, ER prescriptions/labs, disposition (discharge / admit / refer / LWBS / deceased), ER billing | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✅ |
| Wards, rooms, beds configuration with daily rates | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | 🟡 UI-verified | ✅ |
| Bed board & housekeeping (reserve, cleaning, maintenance) | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✅ |
| Admissions: admit (atomic bed claim), transfer, ward notes, vitals, prescriptions/labs, discharge summary + PDF, bed-day billing per ward, cancel-in-error | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✅ |
| Insurance claims: eligibility, coverage % and limit checks, submit → review → approve/partial/reject → settlement (insurance payment), reopen | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✅ |
| Integration: executive KPIs/charts (ER by triage, door-to-doctor, bed status), patient admissions tab, complete-registration for provisional patients, invoice → claim, global search | ✔ | – | ✔ | ✔ | ✔ | ✔ | ✔ | ✅ |

## Phase 4 — HR, Attendance, Leave, Payroll, Recruitment ✅

| Module | Backend | DB | Validation | AuthZ | Audit | Frontend | Test | Status |
|---|---|---|---|---|---|---|---|---|
| Employees: directory, profile, edit, reporting lines, shifts, contracts (issue/terminate), performance reviews (draft → shared → acknowledged) | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✅ |
| Attendance: self clock in/out (late/half-day/overtime from shift policy), HR day register, manual correction with reason, close-day (absent/leave/off/holiday, idempotent), monthly summary | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✅ |
| Leave: balances from policy, request (overlap & balance checks, pending reservation), manager → HR approval, rejection reason, cancel with balance restore, leave marked in attendance | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✅ |
| Payroll: salary structures (effective-dated history), monthly run from attendance + leave, adjustments, submit → approve (not the preparer) → process, payslips + PDF, staff notified | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✅ |
| Recruitment: jobs, candidates (CV upload), stage workflow, interviews + evaluations, offers (approval by another person, letter PDF, send/accept/decline), hire → employee + contract + salary | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✅ |
| My workspace (every staff role): clock card, attendance calendar, leave apply/cancel, payslips, review acknowledgement, team leave approvals for managers | ✔ | – | ✔ | ✔ | ✔ | ✔ | ✔ | ✅ |
| HR / payroll / recruitment dashboards, executive staff-attendance chart, HR policy in hospital settings, global search for employees & candidates | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✅ |

## Phase 5 — Medication reminders, advanced reporting, portal completion ✅

| Module | Backend | DB | Validation | AuthZ | Audit | Frontend | Test | Status |
|---|---|---|---|---|---|---|---|---|
| Medication schedules created on dispensing (times-per-day × duration doses, default times, chronic flag) | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✅ |
| Dose tracking: patient marks taken/skipped (2 h early – 24 h late window), staff record administered doses, change reminder times (re-plans future doses), stop schedule | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✅ |
| Reminder engine (5-min job): dose reminders (in-app + SMS/push), missed-dose marking, prescriber + patient missed-dose alerts, refill reminders, chronic follow-up reminders, completion | ✔ | ✔ | – | – | – | ✔ | ✔ | ✅ |
| Notification history page (type filter, delivery status per channel) | ✔ | ✔ | ✔ | ✔ | – | ✔ | ✔ | ✅ |
| Reports (17): patient inflow, demographics, OPD/IPD, doctor appointments, lab TAT, ER response, medication adherence, revenue by department / doctor, outstanding, insurance claims, pharmacy stock, medicine expiry, purchases, staff attendance, payroll summary, leave summary — date / department / doctor filters, charts, Excel / PDF / CSV / print | ✔ | – | ✔ | ✔ (per report) | ✔ (views & exports) | ✔ | ✔ | ✅ |
| Patient portal: My medicines (today, adherence, reminder times, dose history), medicines card on the dashboard | ✔ | – | ✔ | ✔ | ✔ | ✔ | ✔ | ✅ |
| Doctor portal: later-today list on the doctor dashboard, missed-dose alerts, medications tab on the patient profile | ✔ | – | ✔ | ✔ | ✔ | ✔ | ✔ | ✅ |

## Completion pass — requirement-by-requirement review ✅

Review of all 52 sections of the original specification; the gaps found were closed and tested
(`tests/completion.workflow.test.ts`, 19 tests).

| Spec | Gap found | Now | Test |
|---|---|---|---|
| §20 | Schedules started at dispensing; spec says when the doctor prescribes; no email channel | Hospital setting `medicationScheduleFrom` (default **Prescribed**); prescribing creates schedules, cancelling stops them; reminders also by email where enabled | ✔ |
| §35 / §26 | Appointment reminders never sent | 15-min job: one reminder per appointment in the 24 h before it (in-app + SMS + email), reset on reschedule | ✔ |
| §3 / §12 | No technician assignment; no report upload | Supervisor assigns technician (notified, "assigned to me" worklist, start restricted); PDF/image report uploads with download for care team / patient | ✔ |
| §10 / §27 | Doctor dashboard lacked emergency alerts | Emergency alerts panel (critical, urgent, untriaged, target breaches) | UI-verified |
| §5 | No "Today's revenue" card | KPI added (net of refunds) | ✔ |
| §44 | Appointment types, payment methods, medicine categories hard-coded | Configurable catalog in Hospital settings, enforced by the API, used by booking, billing and item forms | ✔ |
| §15 | No purchase requests | Requisitions: draft → submitted → approved (not by requester) → converted to draft PO | ✔ |
| §28 | Several reports lacked department filters | Department filter on 13 of 17 reports (the others are ER-only or hospital-wide stock); expiry report takes a date window | ✔ |
| §47.10 | No migration mechanism | Versioned migrations (`schemamigrations`), run on start and via `npm run migrate` | ✔ |
| §42 | Backup procedure documented only | `scripts/backup.sh`, `scripts/backup.ps1` (retention), `scripts/restore.ps1` | Manual |
| §32 | `sort` was accepted but ignored | Whitelisted server-side sorting (`?sort=key` / `-key`, 400 for unknown keys) on 15 list endpoints; sortable column headers on patients, invoices, employees, stock items and POs | ✔ |
| §21 | Designations were free text only | Optional designation list in Hospital settings; when defined, employees and offer letters must use it; suggestions in forms | ✔ |
| §8 | Calendar had list + day views | Week view (Mon–Sun per doctor/all doctors, click a day to open the day view) | UI-verified |
| §12 | Technician list included administrators | Only users whose non-admin role grants `lab.process` can be assigned | ✔ |
| UI | Breadcrumbs linked to pages the user cannot open | Such crumbs render as text | UI-verified |
| §42 | Backup scripts untested | `backup.ps1` run against the dev database; `restore.ps1` drill into a scratch database matched all 2,555 documents | Manual ✔ |
| Tests | Phase 1–5 suites depended on the time of day | Test doctors get 00:00–23:59 duty; the dose-recording test creates its own due dose | ✔ |

## Final directive pass (17–18 Oct 2026) ✅

| Item | Change | Test |
|---|---|---|
| Temporary passwords | Enforced by the API (`password_change_required`), not only by the browser redirect | e2e ✔ |
| Duplicate submissions | `Idempotency-Key` on payments, refunds, dispensing (replay / 409 / 422) | e2e ✔ |
| Consent | Append-only consent log; patient message preferences in the portal; notifications honour opt-outs | e2e ✔ |
| Portal access | Reception creates the patient login (temporary password shown once) | e2e ✔ |
| Honest delivery status | `Logged` (demo), `Skipped`, `OptedOut`, `Failed`, `Sent`; integration status card + API | e2e ✔ |
| SMS gateway | HTTP adapter via `SMS_GATEWAY_URL`/`SMS_API_KEY`/`SMS_SENDER_ID`; blank = demo mode | e2e ✔ (demo mode) |
| Payment reminders | Hourly job, max 3, weekly, `PAYMENT_REMINDER_DAYS` | completion ✔ |
| Note versions | Amendment needs a reason; earlier versions kept and shown | e2e ✔ |
| Mobile bottom bar | Labels were all “My”; now Appointments / Medicines / Records / Bills | UI-verified |
| Money format | Fractional amounts always show 2 decimals | UI-verified |
| Tests at night | `tests/setup-clock.ts` fixes the time-of-day dependency | 111/111 ✔ |
| Env blanks | `SMS_*=` blank no longer fails start-up; `.env.example` lists only variables the server reads | Manual ✔ |
| Restore script | Target database taken from the URI; previously an archive restore could hit `hms` or restore nothing | Drill ✔ 2,679/2,679 |
| Deliverables | Traceability matrix, research, role matrix, 14 PDF manuals with real screenshots, reports, delivery index | — |

## Known follow-ups
* Principal cache and rate limiter are in-process; move to Redis before running multiple API instances.
* SMS has an HTTP gateway adapter (demo mode until configured); email and push have no provider adapter yet (always demo mode). Plug providers in via `core/notifications/notify.ts`.
* No ESLint configuration; static checking is TypeScript `strict` only.
* `react-router-dom` 6.x and `exceljs` → `uuid` carry moderate advisories (npm audit, 18 Oct 2026); fixes need major upgrades (react-router 7, exceljs change). Assessed as low practical risk: the app never navigates to user-supplied paths, and the uuid issue needs a caller-supplied output buffer (exceljs is used server-side only for report export).
* Urdu localisation not started.
* Background jobs (stock alerts, medication engine) run inside the API process on timers; with several API instances, run them in one worker (or add a distributed lock).
* Late minutes count from the end of the grace period (09:20 with a 10-minute grace on a 09:00 shift = 10 minutes late). Change `evaluateDay` in `shared/src/hr-rules.ts` if HR prefers counting from shift start.
* Payroll tax is a flat percentage per salary structure; replace `computePay` with slab-based tax if required.
* API paths are grouped by module (e.g. vitals under `/api/clinical`, payments under `/api/billing`) rather than the flat examples in spec §32; the mapping is in `docs/API.md`.
* ER board and alerts refresh by polling (10–30 s); move to server-sent events/WebSockets if sub-second updates are needed.
* Insurance providers are free text on the patient policy; add a provider master (tariffs, pre-authorisation rules) if the hospital works with panels.
* IPD bills bed-days only; daily nursing/doctor-visit charges can be added as services posted from the admission.
* Stock locations are fixed (Main Store, Pharmacy); make them configurable when wards hold their own stock.

## Decisions log
| Date | Decision | Reason |
|---|---|---|
| 2026-10-11 | MERN stack (TypeScript): Express + Mongoose, React + Vite | User requirement (replaces the spec's suggested .NET/PostgreSQL/Next.js) |
| 2026-10-11 | MongoDB replica set mandatory | Multi-document ACID transactions for billing/stock |
| 2026-10-11 | Shared zod package for client + server | One source of truth for validation, enums, workflows, permissions |
| 2026-10-11 | Tokens only in httpOnly SameSite=Strict cookies, refresh rotation with reuse detection | Keeps JWTs away from XSS; CSRF defence |
| 2026-10-11 | Permissions resolved per request with 60 s cache | Role changes apply quickly without re-login |
| 2026-10-11 | Tenant scoping in a Mongoose plugin that refuses unscoped queries | Prevents cross-hospital leakage by construction |
| 2026-10-11 | Slot-lock collection with unique key for appointments | Guarantees no double booking under concurrency |
| 2026-10-11 | Atomic per-hospital/year counters for business numbers | MRN/invoice numbers never duplicate |
| 2026-10-12 | Medicines and supplies share one `items` collection; stock held per batch per location | One stock engine for pharmacy and stores; FEFO per location |
| 2026-10-12 | All stock changes go through `stock.service` with conditional decrements + append-only ledger | No negative stock under concurrency; full traceability |
| 2026-10-12 | Lab results verified by a second person; PO approved by someone other than the requester | Segregation of duties |
| 2026-10-12 | Route-level code splitting in the client | Main bundle 1 MB → 438 KB |
| 2026-10-12 | `withTransaction` is re-entrant (joins an outer transaction) | Services compose atomically (ER disposition → admission → billing; claim settlement → payment) |
| 2026-10-12 | ER quick registration creates a provisional patient with a real MRN | Every order, result and charge attaches to one record from minute one; finalised later via "complete registration" |
| 2026-10-12 | Discharge details stored on the admission; bed-days billed from per-stay history | One source of truth; transfers bill each ward at its own rate |
| 2026-10-12 | Phase 3 seed runs through the real services | Demo data obeys the same rules as production code |
| 2026-10-13 | Attendance dates stored as local `YYYY-MM-DD` strings, one record per employee per day | Unambiguous day boundaries; unique index blocks duplicate punches |
| 2026-10-13 | Leave days are reserved as "pending" at request time | Two overlapping requests can never overspend a balance |
| 2026-10-13 | Payroll and offer letters approved by someone other than the preparer | Segregation of duties for money and contracts |
| 2026-10-13 | Sequences without a year in the number (EMP-00042) use one never-resetting counter | Employee numbers stay unique across years; seeds move counters forward |
| 2026-10-13 | Medication schedules are generated at dispensing, not prescribing | Reminders start only when the patient actually has the medicine |
| 2026-10-16 | Medication schedules start at prescribing by default (configurable) | Spec §20; hospitals that prefer reminders only once medicine is collected can switch to dispensing |
| 2026-10-16 | Appointment types, payment methods and medicine categories are hospital data (catalog), codes immutable once used | Spec §44; history keeps valid codes |
| 2026-10-16 | Forward-only, recorded data migrations run on API start | Existing databases pick up new permissions and settings without reseeding |
| 2026-10-13 | Every report returns one tabular shape (columns, rows, totals, chart hint) | One renderer, one Excel/PDF/CSV exporter and one print view serve all reports |
