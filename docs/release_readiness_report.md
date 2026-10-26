# Release Readiness Report

Date: 18 Oct 2026.

## Verdict

| Use | Ready? | Basis |
|---|---|---|
| **Stakeholder demonstration** (local machine, synthetic data) | **Yes** | 114/114 automated tests; full journey verified end to end; 14 role manuals; demo reset and restore verified |
| **Pilot with real patients** | **No — not yet** | Items in §3 must be done first |
| **Production** | **No** | As above, plus hosting, monitoring, legal review and user acceptance testing |

This report makes no claim of regulatory compliance, clinical safety certification or production readiness.

## 1. Quality gates

| Gate | Status |
|---|---|
| Automated tests | 114/114 pass (25 Oct 2026) |
| Typecheck | 0 errors |
| Build | Succeeds |
| Lint | ESLint: 0 errors, 28 warnings (`any`, tracked) |
| Dependency audit | 4 moderate, 0 high/critical |
| Backup / restore | Backup written; restore drill 2,679/2,679 documents |
| Manuals | 14/14 validated |
| Known open defects | None blocking the demo |

## 2. Security status

**Fixed in this pass:**

* temporary passwords are enforced server-side;
* idempotency on payments, refunds and dispensing;
* honest notification delivery status;
* blank environment values no longer crash start-up;
* the restore script can no longer restore into the wrong database.

**Already in place:**

* bcrypt (cost 12) password hashing;
* lockout after 5 failed attempts (15 minutes);
* httpOnly SameSite=Strict cookies with refresh rotation and reuse detection;
* CSRF header check;
* rate limiting and helmet;
* API-level permissions on every route;
* tenant scoping that refuses unscoped queries;
* upload content checks;
* immutable audit log;
* secrets read from the environment and validated at start-up.

## 3. Risks and blockers before real-patient use

| # | Risk | Severity | Mitigation / owner |
|---|---|---|---|
| 1 | No hosting, TLS, monitoring or alerting set up | High | IT: follow `docs/DEPLOYMENT.md`; add uptime and error monitoring |
| 2 | Backups are manual; no off-site, encrypted, scheduled copies; recovery targets in `DEPLOYMENT.md` (RPO 5 min / RTO 1 h) are **targets, not measured** | High | Schedule `backup.sh`/`backup.ps1`, ship off-site, run monthly drills |
| 3 | Legal position unverified: PDPB status, PECA, PHC MSDS, provincial drug rules, tax on services | High | Hospital legal adviser |
| 4 | No user acceptance testing or usability sessions with real staff | High | Hospital: structured UAT using the role manuals |
| 5 | SMS/email/push not configured; email and push have no adapter | Medium | Contract a PTA-compliant SMS provider; implement email adapter |
| 6 | Single API instance only (in-process rate limiter, cache, jobs) | Medium | Redis + single job worker before scaling out |
| 7 | Dependency advisories (npm audit, 26 Oct 2026): body-parser and multer DoS (high) **patched**; remaining: zod <4.6.6 memory exhaustion on oversized collections (high; bounded by the 1 MB request limit; fix needs Zod 4 migration), react-router 6 and exceljs→uuid (moderate) | Medium | Migrate to Zod 4; upgrade React Router 7 |
| 8 | No browser E2E in CI, no load or formal accessibility testing; 28 lint warnings | Medium | Engineering backlog |
| 9 | Payroll tax is a flat percentage | Medium (finance) | Configure per adviser or implement slabs |
| 10 | English-only UI | Medium (adoption) | Urdu localisation |
| 11 | Demo accounts share one development password | High if deployed | Never seed production; create real accounts with temporary passwords |

## 4. External services and keys still needed

| Service | Needed for | Configuration |
|---|---|---|
| SMS gateway (PTA-registered sender ID) | Appointment, medicine and payment reminders by SMS | `SMS_GATEWAY_URL`, `SMS_API_KEY`, `SMS_SENDER_ID` |
| Email provider (SMTP/API) | Password-reset emails, email reminders | Adapter not built yet |
| Push notification service | App push reminders | Adapter not built yet |
| Payment gateway | Online bill payment from the portal | Not built |
| Insurer e-claims interface | Electronic claim submission | Not built (claims tracked internally) |
| Hosting, domain, TLS certificate, managed MongoDB replica set, object storage | Any hosted use | `docs/DEPLOYMENT.md` |
| Secret store | JWT secret, DB credentials, provider keys | Environment / vault |

## 5. Demo checklist

1. `npm run db:start`
2. `npm run db:backup`
3. `npm run seed` (on the day of the demo)
4. `npm run dev:server` and `npm run dev:client`
5. Confirm http://localhost:4000/api/health returns `{"status":"ok"}`.
6. Follow the demo script in `docs/deployment_and_demo_setup.md` §8.
