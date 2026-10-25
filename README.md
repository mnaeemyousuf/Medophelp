# Medophelp — Smarter Healthcare. Seamless Operations.

**Medophelp** is a modular, multi-hospital-ready hospital management system built on **MongoDB, Express, React and Node** (TypeScript end to end).

**Phase 1** (complete, tested): authentication, users/roles/permissions, hospital configuration, patient registration with MRN, appointments, nurse pre-consultation, doctor consultation, EMR, prescriptions, billing (invoices, payments, refunds, receipts), dashboards, global search, notifications and an immutable audit log.

**Phase 2** (complete, tested): laboratory (test master, orders from consultation, sample → results with automatic flags → second-person verification → PDF report → doctor review), pharmacy (formulary, FEFO dispensing, controlled-drug register), inventory (batches by location, immutable stock ledger, adjustments, transfers, low-stock and expiry alerts) and purchasing (suppliers, purchase orders with segregated approval, goods receipt into batches). Lab and pharmacy charges are billed automatically.

**Phase 3** (complete, tested): emergency department (seconds-fast quick registration with a provisional MRN, colour-coded triage, live board with target breaches and critical alerts, treatment, disposition), admissions/IPD (bed board, atomic bed allocation, transfers, ward notes, discharge summary PDF, bed-day billing per ward) and insurance claims (coverage % and limit checks, approval/partial/rejection, settlement posted to the invoice).

**Phase 4** (complete, tested): HR (employees, contracts, performance reviews, reporting lines), attendance (self clock in/out with late/overtime rules, HR register, corrections, close-day), leave (balances, manager → HR approval), payroll (salary structures, monthly runs from attendance and leave, segregated approval, payslip PDFs), recruitment (jobs, candidates, interviews, offers with approval, hire → employee) and **My workspace** self-service for every staff member.

**Completion pass** (tested): configurable appointment types / payment methods / medicine categories, medication schedules from the moment of prescribing, appointment reminders, lab technician assignment and report uploads, purchase requests before POs, department filters across reports, today's revenue KPI, versioned data migrations and backup/restore scripts. See the requirement-by-requirement table in `docs/IMPLEMENTATION_TRACKER.md`.

**Phase 5** (complete, tested): medication reminders (schedules created at dispensing, dose reminders, missed-dose tracking and prescriber alerts, refill and follow-up reminders, adherence), patient portal "My medicines", notification history, and a report centre with 17 clinical, financial, stores and HR reports — filters, charts and Excel / PDF / CSV / print export.

```
Reception ─▶ Register patient (MRN) ─▶ Book appointment ─▶ Check-in (visit + token)
   ─▶ Nurse assessment (vitals, BMI, abnormal flags) ─▶ Doctor queue ─▶ Consultation
   ─▶ Note · Diagnosis · Prescription (allergy-checked) · Plan ─▶ Complete
   ─▶ Lab order ─▶ Sample · Results · Verify · Report ─▶ Doctor review
   ─▶ Pharmacy dispenses (FEFO) ─▶ Stock decreases ─▶ Lab/pharmacy/OPD invoices
   ─▶ Payment · Receipt · Refund ─▶ Patient portal
```

## Quick start (Windows, development)

Prerequisites: Node 20+ and MongoDB Server 7+ (`winget install OpenJS.NodeJS.LTS MongoDB.Server`).

```bash
npm install
```
```bash
npm run db:start
```
```bash
copy server\.env.example server\.env
```
Edit `server/.env`: set `JWT_ACCESS_SECRET` (32+ random chars) and `SEED_DEMO_PASSWORD`. Then:
```bash
npm run seed
```
```bash
npm run dev:server
```
```bash
npm run dev:client
```
Open http://localhost:5173. Demo accounts are listed in [docs/SETUP.md](docs/SETUP.md).

## Repository layout

| Path | What it is |
|---|---|
| `shared/` | Zod schemas, enums, permission catalogue, workflow transition tables, clinical rules — used by **both** server and client |
| `server/` | Express API, modular monolith (`src/modules/<module>`), Mongoose models, audit, numbering, PDF, tests |
| `client/` | React 18 + Vite + Tailwind SPA, role-aware layout, module pages |
| `scripts/` | Local MongoDB replica-set launcher |
| `docs/` | Architecture, database, API, security, setup, deployment, testing, developer guide, tracker |

## Documentation

- [Architecture](docs/ARCHITECTURE.md)
- [Database design](docs/DATABASE.md)
- [API reference](docs/API.md)
- [Roles, permissions & security](docs/SECURITY.md)
- [Setup & environment variables](docs/SETUP.md)
- [Deployment, backup & recovery](docs/DEPLOYMENT.md)
- [Testing](docs/TESTING.md)
- [Developer guide — adding a module](docs/DEVELOPER_GUIDE.md)
- [Implementation tracker](docs/IMPLEMENTATION_TRACKER.md)

## Commands

| Command | Does |
|---|---|
| `npm run db:start` | Start local MongoDB single-node replica set on port 27018 (transactions need it) |
| `npm run seed` | Drop and re-create demo data (refuses in production) |
| `npm run dev:server` / `npm run dev:client` | API on :4000, web on :5173 (proxies `/api`) |
| `npm test` | End-to-end API tests (51) against a separate `hms_test` database |
| `npm run typecheck` | Type-check all three packages |
| `npm run build` | Production build of server (`server/dist`) and client (`client/dist`) |
