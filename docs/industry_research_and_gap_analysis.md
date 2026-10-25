# Industry Research and Gap Analysis

Prepared 17–18 Oct 2026 for the Medophelp MVP. Desk research only.

## Method and limits

* **What was done:** about 20 web searches, plus reading publicly available documentation of four open-source hospital systems (OpenMRS, Bahmni, GNU Health, OpenEMR), peer-reviewed or indexed papers, regulator pages and industry/vendor sources.
* **What was not done:** no interviews, surveys or site visits. No user statistics were collected. Nothing in this document comes from a stakeholder conversation.
* **Labels used throughout:**
  * **[Fact]** — stated by the cited source. It is summarised, not quoted at length.
  * **[Inference]** — our reasoning from the facts.
  * **[Recommendation]** — what we propose.
* **Source quality:** sources vary. Where a source is a press article, a vendor page or a bill that is not law, this is said explicitly. Figures are given as the source reports them; check the definitions in the source before reuse.
* **Legal statements** are limited to what the sources say. They are not legal advice. Pakistan-specific obligations must be confirmed by counsel before go-live.

## 1. Reference systems

| System | What it is [Fact] | Relevant lessons | Source |
|---|---|---|---|
| OpenMRS | Open-source medical record platform used widely in low- and middle-income countries. Its appointment-scheduling module documents appointment types, provider schedules and blocks. | Configurable appointment types and provider schedules are a baseline expectation. **[Inference]** | https://openmrs.atlassian.net/wiki/spaces/docs/pages/25475777 |
| Bahmni | Hospital system distribution combining OpenMRS (EMR), Odoo (ERP/billing/stock) and OpenELIS (lab). AGPL licensed. | Real hospitals need EMR, lab, billing and stock *connected*. Integrating three products adds operational complexity. A single integrated data model avoids that. **[Inference]** | https://bahmni.atlassian.net/wiki/x/KIDg |
| GNU Health | Free hospital and health information system. Its feature list covers patient management, lab, pharmacy/stock, inpatient (bed management), surgery and health-promotion functions. | Confirms the module breadth expected of an HIS: lab, pharmacy, stock, beds and billing. **[Inference]** | https://docs.gnuhealth.org/his/features.html |
| OpenEMR | Open-source EHR and practice management system. Release notes (5.0.1 blog) list clinical, scheduling and billing improvements. | Practice-management features such as scheduling and billing are core, not add-ons. **[Inference]** | open-emr.org project blog (release 5.0.1 post) |

## 2. Pain points and evidence

| # | Pain point | Evidence (source) | Label |
|---|---|---|---|
| P1 | HIS projects fail or stall from poor usability, insufficient training, resistance to change and infrastructure limits. | Rahman & Islam 2024, *Bangladesh Journal of Medical Science* — https://www.banglajol.info/index.php/BJMS/article/view/72094. Verbeke et al., IOS Press proceedings — https://ebooks.iospress.nl/pdf/doi/10.3233/978-1-61499-564-7-482 | Fact |
| P2 | Pakistan-specific HIS adoption barriers at a large public hospital (PIMS, Islamabad). | Malik & Khan 2009 — https://crpit.scem.westernsydney.edu.au/abstracts/CRPITV97Malik.html | Fact (dated: 2009) |
| P3 | Missed appointments; SMS reminders reduce no-shows. | Randomised trial of 161,587 patients reported no-shows falling from 21.1 % to 14.2 % with SMS reminders — https://www.ncbi.nlm.nih.gov/pmc/articles/PMC7310733 | Fact |
| P4 | Medicine stock-outs, overstock and expiry are common in facility pharmacies. | BMC Health Services Research 2023 — https://link.springer.com/article/10.1186/s12913-023-10096-4 (reported 85.6 % stock-out, 50.6 % overstock and 15.2 % expiry; see the paper for definitions and setting). | Fact |
| P5 | Revenue leakage from missed charge capture. | HFMA cites charge-capture losses of up to about 1 % of net charges — https://www.hfma.org/revenue-cycle/charge-capture/55358/ (US industry association). | Fact (US context) |
| P6 | Alert fatigue and EHR usability problems lead clinicians to ignore warnings. | https://pmc.ncbi.nlm.nih.gov/articles/PMC7266506 | Fact |
| P7 | Emergency department crowding; door-to-doctor time is a key measure. | https://pmc.ncbi.nlm.nih.gov/articles/PMC2850834 | Fact |
| P8 | Duplicate patient records. Master patient index tools still mis-identify a share of patients. | Industry press (hcinnovationgroup.com; fiercehealthcare.com) reports about 93 % correct identification for EMPI tools. Treat as indicative: press, not peer-reviewed. | Fact (press) |
| P9 | Duplicate financial transactions on network retries. The idempotency-key pattern is being standardised. | IETF HTTPAPI draft “The Idempotency-Key HTTP Header Field” — https://datatracker.ietf.org/doc/draft-ietf-httpapi-idempotency-key-header/ ; practitioner article (dzone.com “art of idempotency”). | Fact (draft standard) |
| P10 | Medical record amendments must keep the original and the audit trail. | Common record-keeping practice. Example legislative text: West Virginia HB5476 (a *bill*, not enacted law; cited only as an illustration of the practice). | Fact (bill) / Inference |

## 3. Pakistan context

| Topic | Finding | Label | Source |
|---|---|---|---|
| Data protection law | The Personal Data Protection Bill (2023 draft) is **not enacted** as of the sources consulted. The draft treats health data as sensitive personal data. The Prevention of Electronic Crimes Act 2016 (PECA) applies to unauthorised access to information systems and data. | Fact (status may change — re-check before go-live) | Chambers & Partners *Data Protection & Privacy 2026 — Pakistan* practice guide (practiceguides.chambers.com); DLA Piper *Data Protection Laws of the World — Pakistan*; absco.pk legal commentary |
| Healthcare regulator | Punjab Healthcare Commission (PHC) licenses healthcare establishments in Punjab and applies Minimum Service Delivery Standards (MSDS), which include record keeping. | Fact | https://en.wikipedia.org/wiki/Punjab_Healthcare_Commission ; https://punjab.gov.pk/node/2310 |
| Controlled medicines | Record keeping for controlled and scheduled drugs is governed through DRAP and the provincial Drug Sale Rules. | Fact | https://pid.gov.pk/site/press_detail/7782 |
| Bulk SMS | Commercial/bulk SMS in Pakistan uses sender IDs registered with PTA and the operators. The anti-spam regulations (2009) and the Do-Not-Call register (short code 3627) apply. | Fact (vendor compliance article) | telerivet.com blog — Pakistan SMS compliance (PTA) |
| Tax on hospital services | Whether provincial sales tax applies to hospital services was contested in reporting (2022). The status is unclear. | Fact that it was contested; current status **unverified** | propakistani.pk (17 Feb 2022 article) |
| National ID | CNIC format 12345-1234567-1 is the standard identifier. | Fact (NADRA format, widely documented) | — |
| Currency | PKR. | Fact | — |
| Urdu | Patient-facing material in Urdu is likely needed for many patients. | Inference (no survey done) | — |

**[Recommendation]** Do not claim compliance with any Pakistani law or PHC standard on the strength of this software alone. The system provides supporting controls: role-based access, audit trail, consent log, record versioning and two-person approvals. Compliance depends on the hospital's policies and must be assessed by its advisers.

## 4. Proposed features

Each entry: pain point → evidence → stakeholder → solution → business value → complexity → priority → MVP or later → dependencies/risks.

### F1. Consent and communication preferences (append-only)
* **Pain point / evidence:** SMS channels require consent and opt-out handling (P3; PTA and DNCR rules). NHS Wales information-governance guidance on SMS consent and opt-out (dhcw.nhs.wales/ig) is used as a practice example. Health data is sensitive under the draft PDPB.
* **Stakeholder:** patients, reception, compliance.
* **Solution:**
  * Record consent per type: treatment, data sharing, SMS, email, app.
  * Record the method (written, verbal or portal) and who recorded it, as an append-only history.
  * Patients manage their communication preferences in the portal.
  * Notifications honour opt-outs (status “Opted out”).
* **Business value:** lawful messaging; evidence trail for complaints.
* **Complexity:** low–medium. **Priority:** P1. **MVP:** yes — **implemented and tested** (`tests/e2e.workflow.test.ts` step 13).
* **Risks:** consent wording must be approved by the hospital.

### F2. Idempotent payments, refunds and dispensing
* **Pain point / evidence:** duplicate transactions on retries (P9). Revenue integrity (P5).
* **Stakeholder:** accounts, pharmacy, patients.
* **Solution:**
  * An `Idempotency-Key` header on payment, refund and dispense requests.
  * A retried request returns the stored response (`Idempotent-Replayed: true`); the operation is not repeated.
  * Reusing a key with a different body is refused (422). A request still in progress returns 409.
* **Business value:** no double charges, no double stock deductions.
* **Complexity:** medium. **Priority:** P1. **MVP:** yes — **implemented and tested** (e2e steps 8 and 10).
* **Risks:** keys are kept for 24 hours; clients must generate a new key for each intended operation (the UI does).

### F3. Honest delivery status and integration status
* **Pain point / evidence:** unconfigured channels must never appear operational (directive). Staff trust in alerts (P6).
* **Solution:**
  * Delivery statuses Sent / Logged (demo, not sent) / Skipped / Opted out / Failed.
  * The Hospital settings screen shows each provider as “Not configured — demo mode”.
  * A `GET /api/admin/integrations` endpoint reports the same.
* **Complexity:** low. **Priority:** P1. **MVP:** yes — **implemented and tested**.

### F4. SMS gateway interface for Pakistani bulk-SMS providers
* **Pain point / evidence:** P3 (no-show reduction); PTA sender-ID rules.
* **Solution:**
  * A generic HTTP gateway adapter (`SMS_GATEWAY_URL`, `SMS_API_KEY`, `SMS_SENDER_ID`).
  * Messages are capped at 300 characters, with a 10-second timeout.
  * Without configuration the system stays in demo mode.
* **Business value:** appointment, medicine and payment reminders by SMS.
* **Complexity:** low (adapter); the provider contract is external. **Priority:** P2. **Status:** **interface implemented; blocked by external dependency** (provider account and registered sender ID).
* **Risks:** provider API shapes differ, so a small mapping may be needed. Message content must avoid clinical details.

### F5. Payment reminders for outstanding balances
* **Pain point / evidence:** receivables follow-up (P5).
* **Solution:**
  * An hourly job reminds patients with balances still open after `PAYMENT_REMINDER_DAYS` (default 7).
  * At most three reminders, a week apart. Messages contain amounts only.
* **Complexity:** low. **Priority:** P2. **Status:** **implemented and tested** (completion suite “Payment reminders”).

### F6. Clinical note version history
* **Pain point / evidence:** record-amendment practice (P10). PHC record keeping (MSDS).
* **Solution:**
  * Amending a saved note requires a reason. The previous version is kept with author and time.
  * The EMR shows an “Amended” badge and the earlier versions.
* **Complexity:** low. **Priority:** P1. **Status:** **implemented and tested** (e2e step 4).

### F7. Portal access provisioning with forced password change
* **Pain point / evidence:** portal adoption needs a simple onboarding path (P1 usability). Temporary credentials must be replaced.
* **Solution:**
  * Reception enables portal access from the patient profile. A policy-compliant temporary password is shown once.
  * The server refuses every non-auth request until the password is changed (`password_change_required`).
* **Complexity:** low. **Priority:** P1. **Status:** **implemented and tested** (e2e step 11).

### F8. Urdu interface and Urdu SMS templates
* **Pain point / evidence:** inference only. No survey was done.
* **Solution:** an i18n framework, an RTL layout for Urdu, and Urdu message templates. Note that SMS in Urdu uses Unicode, so fewer characters fit per message segment.
* **Complexity:** medium–high. **Priority:** P3. **Status:** **not implemented (later)**.
* **Risks:** clinical terminology needs validation by native-speaking clinicians.

### F9. Clinical decision support beyond allergy warnings
* **Pain point / evidence:** P6 (alert fatigue).
* **Recommendation:** keep alerts minimal and advisory. Do **not** auto-prescribe or change doses (directive). Any future interaction checking must use a licensed, validated drug knowledge base.
* **Status:** **not implemented by design.** Only allergy matching and reference-range flags exist, and they are advisory.

### F10. FHIR interoperability
* **Evidence:** FHIR Patient and Encounter resources (learn.microsoft.com FHIR documentation).
* **Recommendation:** add a read-only FHIR export of Patient, Encounter and Observation when a partner system needs it.
* **Priority:** P3, later.

### F11. Electronic insurance claims and online payments
* **Status:** blocked by external dependency (insurer and payment-gateway contracts). Claims are tracked internally today.

## 5. Feature matrix

| Feature | Research finding | Existing support (before this session) | Business value | Priority | Implementation status |
|---|---|---|---|---|---|
| Duplicate patient detection | P8 duplicate records | ✔ CNIC uniqueness + name/DOB/phone match | Data quality | P1 | Implemented & tested (pre-existing) |
| SMS appointment reminders | P3 RCT: no-shows 21.1 % → 14.2 % | Reminder job; SMS adapter was a stub | Fewer no-shows | P1 | Interface implemented; provider **blocked (external)** |
| Consent & opt-out | PTA/DNCR; draft PDPB | ✖ | Lawful messaging | P1 | **Implemented & tested (new)** |
| Honest delivery status | Directive; P6 | ✖ (stubs reported “Sent”) | Trust | P1 | **Implemented & tested (new)** |
| Idempotent money/stock operations | P9 IETF draft | ✖ | No double charge/dispense | P1 | **Implemented & tested (new)** |
| FEFO dispensing, expiry & low-stock alerts | P4 stock-outs/expiry | ✔ | Less waste | P1 | Implemented & tested (pre-existing) |
| Auto charge capture (OPD, lab, pharmacy, IPD, ER) | P5 charge leakage | ✔ | Revenue | P1 | Implemented & tested (pre-existing) |
| Payment reminders | P5 receivables | ✖ | Collections | P2 | **Implemented & tested (new)** |
| Note version history | P10 amendments | ✖ (notes overwritten) | Record integrity | P1 | **Implemented & tested (new)** |
| Portal provisioning | P1 usability/adoption | ✖ | Patient engagement | P1 | **Implemented & tested (new)** |
| ER door-to-triage/doctor metrics | P7 | ✔ report + board | Throughput | P2 | Implemented & tested (pre-existing) |
| Lab turnaround & critical alerts | P6/P7 | ✔ | Safety | P1 | Implemented & tested (pre-existing) |
| Bed occupancy board | GNU Health/Bahmni scope | ✔ | Capacity | P2 | Implemented & tested (pre-existing) |
| Backups & restore drill | Operational resilience | ✔ scripts | Continuity | P1 | Implemented; drill done (manual) |
| Urdu UI/SMS | Inference | ✖ | Accessibility | P3 | Not implemented (later) |
| FHIR export | Interoperability | ✖ | Integration | P3 | Not implemented (later) |
| e-Claims / online payment | Market practice | ✖ | Cash flow | P3 | Blocked (external contracts) |
| Advanced CDS | P6 alert fatigue | Allergy + range flags only | Safety (if validated) | — | Deliberately not implemented |

## 6. Conclusions

* **[Inference]** The MVP's module breadth is comparable to the reference systems' core: registration, scheduling, EMR, lab, pharmacy/stock, beds and billing.
* **[Inference]** The most valuable gaps for a Pakistani private hospital demo were trust and integrity features: consent, honest messaging, duplicate-proof payments and record versioning. These are now in place.
* **[Recommendation]** Before go-live:
  * contract an SMS provider with a PTA-registered sender ID;
  * confirm legal obligations (PDPB status, PHC MSDS, provincial drug rules, tax treatment);
  * run usability sessions with real staff, which have not been done;
  * plan Urdu localisation.
