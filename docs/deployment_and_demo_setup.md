# Deployment and Demo Setup

How to run Medophelp for a demonstration on one machine, reset it safely, and what changes for a hosted deployment. Details live in `docs/SETUP.md` (local), `docs/DEPLOYMENT.md` (production topology, backups) and `docs/SECURITY.md`. No production secrets appear in this document.

## 1. Environment

| Component | Version used for this build | Notes |
|---|---|---|
| OS | Windows 11 (also runs on Linux/macOS) | |
| Node.js | 20 LTS or newer | `winget install OpenJS.NodeJS.LTS` |
| MongoDB | 7.0+ (tested with 9.0) as a **replica set** | Transactions require a replica set |
| MongoDB Database Tools | any recent | For `mongodump` / `mongorestore` (backups) |
| Browser | current Chrome / Edge | The manuals were captured with Chrome |

## 2. Install and database

```bash
npm install
```
```bash
npm run db:start
```

`db:start` starts `mongod` on `127.0.0.1:27018` (data in `.data/db`) and initiates replica set `rs0`. It is idempotent; run it after each reboot.

## 3. Environment variables (`server/.env`)

Copy `server/.env.example` to `server/.env`. Never commit `.env`.

| Variable | Demo value / rule | Production |
|---|---|---|
| `NODE_ENV` | `development` | `production` |
| `PORT` | `4000` | behind a reverse proxy |
| `TZ` | `Asia/Karachi` | hospital time zone (defines “today”) |
| `MONGODB_URI` | `mongodb://127.0.0.1:27018/hms?replicaSet=rs0` | credentials + `replicaSet`, from a secret store |
| `JWT_ACCESS_SECRET` | ≥ 32 random characters (generate, see `.env.example`) | fresh secret from a secret store |
| `ACCESS_TOKEN_TTL_MIN` / `REFRESH_TOKEN_TTL_DAYS` | `15` / `7` | per policy |
| `CORS_ORIGINS` | `http://localhost:5173` | public origin |
| `COOKIE_SECURE` | `false` | `true` (HTTPS) |
| `FILE_STORAGE_DIR`, `MAX_UPLOAD_MB` | `./storage`, `10` | durable volume / object storage |
| `LOG_LEVEL` | `info` | `info` |
| `SEED_DEMO_PASSWORD` | a development-only password you choose (≥ 10 chars, upper/lower/digit/symbol) | **unset** (seeding refuses to run in production) |
| `SMS_GATEWAY_URL`, `SMS_API_KEY`, `SMS_SENDER_ID` | blank → demo mode (SMS logged as “demo – not sent”) | provider endpoint, key from secret store, PTA-registered sender ID |
| `PAYMENT_REMINDER_DAYS` | `7` (`0` disables) | per finance policy |

The server validates all variables at start-up and refuses to start if a required one is missing or invalid. Blank optional values mean “not configured”.

Email and push notifications have no provider adapter in this version. They always run in demo mode, which **Administration → Hospital settings → Message delivery providers** shows as “Not configured — demo mode”.

## 4. Migrations

Data migrations run automatically when the API starts. To run them on their own:

```bash
npm run migrate
```

Migrations are forward-only and recorded in the `schemamigrations` collection, so each runs once.

## 5. Build and start

Development (two terminals):

```bash
npm run dev:server
```
```bash
npm run dev:client
```

Production build:

```bash
npm run build
```
```bash
npm start -w server
```

Then serve `client/dist` and proxy `/api` to the API from the same origin (see `docs/DEPLOYMENT.md`).

Health check: `http://localhost:4000/api/health` returns `{"status":"ok"}`.

## 6. Seeding demo data

```bash
npm run seed
```

The seed creates the synthetic “Shamsi Hospital” data set described in `docs/SETUP.md` §4: patients, staff, today's appointments, lab orders, stock, wards, payroll and more. **Seeding drops and recreates the database named in `MONGODB_URI`.** Always back up first (section 9).

Every name, CNIC, phone number and email in the seed is invented. Do not load real patient data into a demo environment.

## 7. Test accounts (development only)

All demo accounts use the value of `SEED_DEMO_PASSWORD` from your local `server/.env`. The password is deliberately not written in this document or in the user manuals.

| Email | Role |
|---|---|
| superadmin@hospital.com | Super Admin |
| admin@hospital.com | Hospital Admin |
| reception@hospital.com | Receptionist |
| nurse@hospital.com | Nurse (head nurse; staff nurses are `nurse.*@hospital.com`) |
| doctor@hospital.com | Doctor |
| lab@hospital.com, labsupervisor@hospital.com | Lab Technician (two people, for the verification rule) |
| pharmacy@hospital.com | Pharmacist |
| inventory@hospital.com | Inventory Manager |
| accounts@hospital.com | Accountant |
| hr@hospital.com | HR Manager |
| payroll@hospital.com | Payroll Officer |
| recruitment@hospital.com | Recruitment Officer |
| management@hospital.com | Management |
| patient@hospital.com | Patient (portal) |

Automated tests use a separate database (`hms_test`) with their own password set in `server/vitest.config.ts`.

## 8. Launching a demo

1. `npm run db:start`
2. Back up (section 9), then `npm run seed` **on the day of the demo**. Queues such as nursing, doctor and the front desk show *today's* appointments, so data seeded on an earlier day shows empty queues.
3. `npm run dev:server` and `npm run dev:client`.
4. Open http://localhost:5173.
5. Suggested script — the full patient journey:
   1. reception registers and checks in a patient;
   2. the nurse records vitals;
   3. the doctor consults, prescribes and orders a CBC;
   4. the lab enters results and a second person (labsupervisor@) verifies;
   5. the pharmacy dispenses;
   6. accounts records the payment;
   7. the patient portal shows the prescription, the result and the bill.
6. In Hospital settings, show that SMS/email are in demo mode. Nothing is sent externally.

## 9. Safe demo reset, backup and restore

**Back up before any reseed or restore:**

```bash
npm run db:backup
```

* This writes `backups/hms-YYYYMMDD-HHMM.gz`. The `backups/` folder is git-ignored; archives older than 35 days are pruned, and monthly archives are kept for 12 months.
* This session's archives: `backups/hms-20261017-1159.gz`, `backups/hms-20261017-2330.gz` and `backups/hms-20261018-0021.gz`. The last one was taken immediately before the final reseed on 18 Oct 2026.

**Reset the demo:** back up, then `npm run seed`.

**Restore an archive.** Test it first into a scratch database:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/restore.ps1 -Archive backups/hms-20261018-0021.gz -TargetUri "mongodb://127.0.0.1:27018/hms_restore_check?replicaSet=rs0"
```

```bash
node scripts/count-docs.mjs "mongodb://127.0.0.1:27018/?replicaSet=rs0" hms_restore_check
```

* `restore.ps1` restores into the database named in `-TargetUri` (or `-ToDb`) and uses `--drop` on that database only. Never point it at a live database outside an incident.
* **Fixed on 18 Oct 2026:** earlier versions passed the URI's database straight to `mongorestore`. For archive restores, that either restored nothing or wrote back into the original `hms` namespace.
* **Drill on 18 Oct 2026:** `hms-20261018-0021.gz` was restored into `hms_restore_check`. All 2,679 documents restored with 0 failures, and the live `hms` database was unaffected (API health OK).

## 10. Regenerating the user manuals

Run these with the API and web client running, after a fresh seed:

```bash
npx --prefix server tsx tools/manuals/export-roles.ts
```
```bash
node tools/manuals/capture.mjs
```
```bash
node tools/manuals/build-manuals.mjs
```
```bash
node tools/manuals/role-matrix.mjs
```

* `capture.mjs` signs in with the demo accounts. It reads `SEED_DEMO_PASSWORD` from `server/.env` and never prints it.
* `build-manuals.mjs` writes the 14 PDFs and `tools/manuals/build/validation.json`.
* The tools need the `tools/manuals` dependencies (`npm install --prefix tools/manuals`) and a local Chrome or Edge.

## 11. Before any hosted or production use

* Use HTTPS, `COOKIE_SECURE=true`, a single origin and secrets from a secret store.
* Use a three-node replica set (or a managed service) with scheduled, encrypted off-site backups.
* Run one API instance only — or move the rate limiter, principal cache and background jobs to Redis or a worker first.
* Configure an SMS provider and verify delivery with a test number.
* Remove all demo accounts and data. Never run `npm run seed` against production.
* Complete the items in `docs/release_readiness_report.md`.
