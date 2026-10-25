# Setup & Environment

## 1. Install

| Tool | Version | Windows install |
|---|---|---|
| Node.js | 20 LTS or newer | `winget install OpenJS.NodeJS.LTS` |
| MongoDB Server | 7.0+ (tested on 9.0) | `winget install MongoDB.Server` |
| Git | any | `winget install Git.Git` |

```bash
npm install
```

## 2. Database

MongoDB **must run as a replica set**: billing, payments and other multi-document operations use
transactions. For development:

```bash
npm run db:start
```

This starts `mongod` on `127.0.0.1:27018` with data in `.data/db` and initiates replica set `rs0`.
It is idempotent — run it after every reboot. (Linux/macOS: `mongod --dbpath .data/db --port 27018 --replSet rs0`, then `node scripts/init-replset.mjs`.)

## 3. Environment variables (`server/.env`)

Copy `server/.env.example`. Never commit `.env`.

| Variable | Required | Default | Purpose |
|---|---|---|---|
| `NODE_ENV` | | `development` | `production` disables stack traces in errors and demo seeding |
| `PORT` | | `4000` | API port |
| `TZ` | ✔ | — | Hospital time zone, e.g. `Asia/Karachi`. Defines "today" for queues and check-in |
| `MONGODB_URI` | ✔ | — | Must include `replicaSet=` |
| `JWT_ACCESS_SECRET` | ✔ | — | ≥ 32 random chars. `node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"` |
| `ACCESS_TOKEN_TTL_MIN` | | `15` | Access-token lifetime |
| `REFRESH_TOKEN_TTL_DAYS` | | `7` | Refresh-token lifetime ("remember me") |
| `CORS_ORIGINS` | | `http://localhost:5173` | Comma-separated browser origins allowed to call the API |
| `COOKIE_SECURE` | prod ✔ | `false` | `true` behind HTTPS |
| `FILE_STORAGE_DIR` | | `./storage` | Local document storage (swap adapter for S3/Blob in production) |
| `MAX_UPLOAD_MB` | | `10` | Upload size limit |
| `LOG_LEVEL` | | `info` | pino level |
| `SEED_DEMO_PASSWORD` | dev only | — | Password given to every demo account by `npm run seed` |
| `SMS_GATEWAY_URL`, `SMS_API_KEY`, `SMS_SENDER_ID` | | — | HTTP SMS gateway. Blank = demo mode (SMS logged as “demo – not sent”) |
| `PAYMENT_REMINDER_DAYS` | | `7` | Days after issue before unpaid-invoice reminders start (max 3, weekly). `0` disables |

Email and push notifications have no provider adapter in this version and always run in demo mode.

The server validates these at start-up and refuses to run if a required one is missing.

## 4. Seed demo data

```bash
npm run seed
```

Creates Shamsi Hospital with 13 departments, 8 services, 14 system roles, 10 doctors, 10 nurses,
5 lab technicians, 5 pharmacists (30 employees), 24 patients, 30 appointments across past/today/future
(with full clinical records for completed visits), invoices and payments, and for Phase 2:
5 suppliers, 22 medicines (3 controlled) and 6 supplies in 51 batches across Main Store and Pharmacy
(including a near-expiry, an expired and two low-stock items), 11 lab tests with reference/critical
ranges, 8 lab orders across every stage, and 5 purchase orders in every state.
Phase 3: 5 wards (general male/female, private, ICU, paediatric) with 44 beds, 7 current inpatients
(one admitted from the ER) and 2 discharged, 7 emergency cases across the workflow (a critical
unidentified patient waiting, one in treatment, discharged, admitted, left without being seen),
and insurance claims including a paid and a partially approved one. All Phase 3 data is created
through the real services, so occupancy, numbering, billing and audit match the app exactly.
Phase 4: office staff (HR, front desk, accounts, payroll and recruitment officers) as employees
linked to their logins (35 employees), reporting lines (nurses → head nurse, office → HR), contracts
and salary structures by grade, attendance from the start of last month to yesterday (late arrivals,
overtime, a few absences), approved and pending leave, last month's payroll processed through the
segregated prepare → approve → process flow (payslips for everyone), 3 performance reviews, 3 job
openings with 8 candidates across the pipeline, interviews with evaluations and one sent offer.
Phase 5: the portal patient has Metformin and Amlodipine (long-term) and a 5-day Ibuprofen course,
dispensed through the pharmacy service with reminder schedules started six days ago (mostly taken,
some missed and skipped); another patient's 30-day Losartan course ends in two days (refill reminder).

## 5. Demo accounts (development only)

All use the password you set in `SEED_DEMO_PASSWORD` in your local `server/.env` (never committed).
Choose your own value (at least 10 characters with upper and lower case, a digit and a symbol) and
use a different one for any shared environment.

| Email | Role | Lands on |
|---|---|---|
| superadmin@hospital.com | Super Admin | Executive dashboard (all permissions incl. all EMRs) |
| admin@hospital.com | Hospital Admin | Executive dashboard, administration |
| reception@hospital.com | Receptionist | Front desk: registration, appointments, check-in, ER quick registration, admissions & bed board |
| nurse@hospital.com | Nurse (head nurse) | Nursing queue & assessments, ER triage, ward notes & vitals; approves leave for the staff nurses (My workspace → My team) |
| doctor@hospital.com | Doctor (Dr. Ayesha Khan) | Consultation queue — has patients waiting today |
| accounts@hospital.com | Accountant | Billing, payments, refunds, insurance claims, financial dashboard |
| hr@hospital.com | HR Manager | HR dashboard, employees, attendance, leave approvals, payroll approval, offer approval & hiring |
| payroll@hospital.com | Payroll Officer | Payroll runs (prepare, adjust, submit, process), salary structures |
| recruitment@hospital.com | Recruitment Officer | Jobs, candidates, interviews, offer letters |
| lab@hospital.com | Lab Technician | Lab dashboard & worklist (receives, collects, enters results) |
| labsupervisor@hospital.com | Lab Technician | Verifies results entered by lab@ (verification needs a second person) |
| pharmacy@hospital.com | Pharmacist | Prescription queue, FEFO dispensing, controlled register |
| inventory@hospital.com | Inventory Manager | Stores dashboard, items & batches, purchase orders, goods receipt |
| management@hospital.com | Management | Executive & financial dashboards |
| patient@hospital.com | Patient | Patient portal: appointments, records, bills, **My medicines** (dose reminders & adherence) |

Every staff account also has **My workspace** (clock in/out, attendance, leave, payslips). Reports are
under **Administration → Reports** for anyone with access to at least one report.

## 6. Run

```bash
npm run dev:server
```
```bash
npm run dev:client
```

Web: http://localhost:5173 · API health: http://localhost:4000/api/health

The API applies pending data migrations at start-up (also `npm run migrate`). For a local backup
install MongoDB Database Tools (`winget install MongoDB.DatabaseTools`) and run `npm run db:backup`
(archives go to `backups/`, which is git-ignored).

Hospital-specific lists — appointment types, accepted payment methods, medicine categories and
when medication reminders start — are edited in **Administration → Hospital settings**.
Password-reset links are written to the API log in development (no email provider configured).
