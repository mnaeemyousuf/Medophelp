# Medophelp User Manuals

One A4 PDF manual per role that exists in the application. Regenerated on 25 Oct 2026 with the Medophelp brand (logo, brand line, colours and fonts) from the running demonstration build (software version 1.0.0, MVP demonstration build).

| # | File | Role in the system | Combined responsibilities documented |
|---|---|---|---|
| 01 | `01_Super_Admin_User_Manual.pdf` | Super Admin | All staff permissions, including all-patient EMR |
| 02 | `02_Hospital_Admin_User_Manual.pdf` | Hospital Admin | Configuration and operations; no all-patient EMR or clinical notes |
| 03 | `03_Receptionist_User_Manual.pdf` | Receptionist | Registration, appointments, consent, portal access, ER registration, admissions |
| 04 | `04_Nurse_User_Manual.pdf` | Nurse | Head nurse and staff nurses share this role |
| 05 | `05_Doctor_User_Manual.pdf` | Doctor | OPD, ER, IPD discharge, lab review |
| 06 | `06_Lab_Technician_User_Manual.pdf` | Lab Technician | Includes verification and test master (there is no separate Lab Manager role) |
| 07 | `07_Pharmacist_User_Manual.pdf` | Pharmacist | Dispensing, controlled register, pharmacy stock |
| 08 | `08_Inventory_Procurement_User_Manual.pdf` | Inventory Manager | Includes procurement (there is no separate Procurement role) |
| 09 | `09_Accountant_User_Manual.pdf` | Accountant | Billing, refunds, insurance |
| 10 | `10_HR_Manager_User_Manual.pdf` | HR Manager | Includes payroll approval and offer approval (no separate HR Executive role) |
| 11 | `11_Payroll_Officer_User_Manual.pdf` | Payroll Officer | |
| 12 | `12_Recruitment_Officer_User_Manual.pdf` | Recruitment Officer | |
| 13 | `13_Patient_Portal_User_Manual.pdf` | Patient | Desktop and mobile |
| 14 | `14_Management_Reporting_User_Manual.pdf` | Management | Read-only dashboards and reports |

There are exactly 14 roles in the application (`shared/src/permissions.ts`), matching the original specification. No manual was written for a role the system does not have; combined responsibilities are described inside the role that holds them. Full permissions: `docs/role_permission_matrix.md`.

## Contents of each manual

Each manual contains:

* a cover page (product, role, version, date);
* a contents page with page numbers;
* an introduction (the role's menus, permissions and reports, all generated from the source code);
* sign-in and first-time setup;
* a dashboard guide;
* module-by-module guides;
* workflows, troubleshooting, best practices and security, glossary, and a support page.

Every feature guide covers:

* purpose, who can use it, prerequisites and navigation;
* steps, with screenshots;
* fields;
* a synthetic example;
* the expected result;
* validation rules, common errors, warnings and next steps.

Notes on content:

* Error and validation messages are quoted from the source code.
* Troubleshooting rows say whether they were verified against this build.
* The support page holds placeholders. No support email or phone number has been invented.
* Demo passwords are not printed.

## Screenshots (`assets/`)

* 119 PNG screenshots captured from the rebranded running application by `tools/manuals/capture.mjs` on 24 Oct 2026, after a fresh synthetic seed.
* Desktop viewport 1440×900 (device scale 1.25). The patient portal also has 390×844 phone captures (`*-mobile-*`).
* `assets/manifest.json` lists every file with its title, role and capture time.
* **All data shown is synthetic.** Names such as “Ayesha Khan”, “Hina Rashid” or “Maryam Sheikh”, and the CNICs and phone numbers shown, are invented by the seed or the capture script. They are not real patients or staff.
* No screenshot was fabricated or edited. Every screenshot step in the final capture succeeded, so there are no missing-screenshot blockers.

## Validation

`tools/manuals/build-manuals.mjs` validates each PDF after a two-pass build and writes `tools/manuals/build/validation.json`. It checks:

* the file opens with pdf.js;
* the page count;
* extractable text on every page;
* embedded images ≥ figures;
* every TOC page number matches the page where the heading appears;
* no missing screenshots;
* nothing wider than the printable area.

Result: **14/14 passed**. Sample pages were also rendered to images and inspected visually.

## Regenerate

See `docs/deployment_and_demo_setup.md` §10.
