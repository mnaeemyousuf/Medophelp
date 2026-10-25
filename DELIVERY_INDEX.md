# Delivery Index

Medophelp (MERN hospital management system) — final directive delivery, 18 Oct 2026; Medophelp rebrand, 25 Oct 2026.

Verification status: **Verified** = checked by a command or inspection in this session · **Generated** = produced from source data by a script that ran · **Written** = authored document, reviewed against the code.

## Branding (25 Oct 2026)

| Path | Purpose |
|---|---|
| `branding/BRAND_GUIDE.md` | Logo usage, colour palette with contrast ratios, typography, visual style |
| `branding/logo/` | Master logo set: 8 SVG (outlined text), 14 PNG, `favicon.ico` |
| `shared/src/brand.ts` | Brand name, brand line, colours and chart order used by client, server and manual builder |
| `client/public/favicon.svg`, `favicon.ico`, `apple-touch-icon.png`, `site.webmanifest`, `brand/` | Icons and logos served by the web app |
| `tools/brand/build-brand.mjs` | Regenerates the logo set |

## Reports (`docs/`)

| Path | Purpose | Status |
|---|---|---|
| `docs/requirements_traceability_matrix.md` | Baseline plus 95 requirements with status, evidence, gaps and test results; 91.5 % verified complete | Written; status counts computed by script |
| `docs/industry_research_and_gap_analysis.md` | OpenMRS/Bahmni/GNU Health/OpenEMR and Pakistan context, cited sources, feature matrix | Written (desk research, no interviews) |
| `docs/role_permission_matrix.md` | 14 roles × permissions, menus, reports, approvals, sensitive data, notifications | Generated from `shared/src/permissions.ts` and `client/src/app/nav.ts` |
| `docs/mvp_implementation_report.md` | What the MVP contains and what this pass delivered | Written |
| `docs/qa_and_test_report.md` | Test runs, E2E steps, role restrictions, defects fixed, audit, PDF validation | Verified (results from commands run) |
| `docs/release_readiness_report.md` | Verdict (demo yes / pilot & production no), risks, external services needed | Written |
| `docs/deployment_and_demo_setup.md` | Environment, DB, migrations, env vars, build/start, seeding, test accounts, demo launch, safe reset, backup/restore | Verified (backup and restore drill run) |

## Existing technical documentation (updated)

| Path | Purpose | Status |
|---|---|---|
| `docs/API.md` | API reference, plus idempotency, consents, portal access, integrations, `password_change_required` | Updated |
| `docs/DATABASE.md` | Collections, plus consents, idempotency records, note versions, reminder fields | Updated |
| `docs/IMPLEMENTATION_TRACKER.md` | Phase tracker, plus the final-directive pass | Updated |
| `docs/TESTING.md` | How to run the tests (111) and restore drill | Updated |
| `docs/SETUP.md` | Local setup and environment variables | Updated (SMS vars) |
| `docs/ARCHITECTURE.md`, `docs/SECURITY.md`, `docs/DEPLOYMENT.md`, `docs/DEVELOPER_GUIDE.md`, `README.md` | Architecture, security, production topology, developer guide | Unchanged this pass |

## User manuals (`deliverables/user_manuals/`)

| Path | Role | Pages | Status |
|---|---|---|---|
| `01_Super_Admin_User_Manual.pdf` | Super Admin | 42 | Verified |
| `02_Hospital_Admin_User_Manual.pdf` | Hospital Admin | 41 | Verified |
| `03_Receptionist_User_Manual.pdf` | Receptionist | 39 | Verified |
| `04_Nurse_User_Manual.pdf` | Nurse | 34 | Verified |
| `05_Doctor_User_Manual.pdf` | Doctor | 43 | Verified |
| `06_Lab_Technician_User_Manual.pdf` | Lab Technician | 36 | Verified |
| `07_Pharmacist_User_Manual.pdf` | Pharmacist | 36 | Verified |
| `08_Inventory_Procurement_User_Manual.pdf` | Inventory Manager | 36 | Verified |
| `09_Accountant_User_Manual.pdf` | Accountant | 38 | Verified |
| `10_HR_Manager_User_Manual.pdf` | HR Manager | 41 | Verified |
| `11_Payroll_Officer_User_Manual.pdf` | Payroll Officer | 34 | Verified |
| `12_Recruitment_Officer_User_Manual.pdf` | Recruitment Officer | 30 | Verified |
| `13_Patient_Portal_User_Manual.pdf` | Patient | 27 | Verified |
| `14_Management_Reporting_User_Manual.pdf` | Management | 26 | Verified |
| `README.md` | Index, combined roles, screenshot and validation notes | Written |
| `assets/*.png` (119) and `assets/manifest.json` | Real screenshots (synthetic data) | Verified (captured from the running app) |

“Verified” for a PDF means it passed the automated checks recorded in `tools/manuals/build/validation.json`: it opens, has extractable text, embedded images ≥ figures, correct TOC page numbers and no overflow.

## Tooling (`tools/manuals/`)

| Path | Purpose |
|---|---|
| `export-roles.ts` | Exports role → permission → menu → report data from the source |
| `capture.mjs` | Captures the screenshots from the running app |
| `content/*.mjs` | Manual content (common, per feature, per role) |
| `build-manuals.mjs` | Builds the 14 PDFs (two-pass TOC) and validates them |
| `render-pages.mjs` | Renders PDF pages to PNG for visual checks |
| `role-matrix.mjs` | Generates `docs/role_permission_matrix.md` |

## Code changed in this pass (main items)

* **Server**
  * `server/src/core/middleware/idempotency.ts` (new) and `auth.ts`
  * `server/src/core/notifications/notify.ts`
  * `server/src/config/env.ts`
  * patients: `consent.service.ts`, `portal-access.service.ts`
  * `billing/billing.jobs.ts`
  * clinical note versions
* **Client**
  * `client/src/pages/patients/ConsentCard.tsx`
  * `client/src/app/Layout.tsx`
  * `client/src/lib/utils.ts` and `client/src/lib/api.ts`
* **Tests:** `server/tests/e2e.workflow.test.ts` (new), `server/tests/setup-clock.ts` (new), completion suite (payment reminders)
* **Scripts:** `scripts/restore.ps1` (target fix), `scripts/count-docs.mjs` (new)
* **Config:** `server/.env.example`

## Data safety

* Backups taken before each reseed: `backups/hms-20261017-1159.gz`, `backups/hms-20261017-2330.gz`, `backups/hms-20261018-0021.gz` (git-ignored).
* The dev database holds synthetic data only. The restore drill database `hms_restore_check` can be dropped at any time.
