# Medophelp Architecture (MERN)

## 1. Shape of the system

```
┌───────────────────────────────┐        ┌──────────────────────────────────────────┐       ┌──────────────────┐
│ client/  React 18 + Vite + TS │  HTTPS │ server/  Node 20 + Express + TS          │       │ MongoDB 7/8      │
│ Tailwind, React Router,       │ ─────▶ │ modular monolith: src/modules/<module>   │ ────▶ │ replica set      │
│ TanStack Query, RHF + zod     │ cookies│ Mongoose, zod, JWT, pdfkit               │       │ (transactions)   │
└───────────────────────────────┘        └──────────────────────────────────────────┘       └──────────────────┘
                 ▲                                         │
                 └──────── shared/  (zod schemas, permission catalogue, enums, workflows) ─────┘
```

npm workspaces: `shared`, `server`, `client`. The `shared` package is the single definition of
validation schemas, enums, workflow transition tables and the permission catalogue, so the browser
and the API can never disagree about what is valid.

## 2. Server layout

```
server/src
  config/env.ts               zod-validated environment (fails fast on missing secrets)
  core/
    context.ts                AsyncLocalStorage request context (userId, hospitalId, role, ip)
    db.ts                     connection + withTransaction() helper
    errors.ts                 AppError, NotFoundError, ForbiddenError, ConflictError, ValidationError
    plugins/
      base.plugin.ts          hospitalId scoping, createdBy/updatedBy, timestamps, soft delete
    middleware/
      authenticate.ts         verifies access-token cookie, loads context
      authorize.ts            requirePermission('patients.create')
      validate.ts             zod body/query/params validation
      csrf.ts                 mutating requests must carry X-Requested-With + same Origin
      error-handler.ts        AppError → RFC 7807 problem JSON; no stack traces in production
      rate-limit.ts
    audit/                    AuditLog model (append-only) + audit.record()
    numbering/                atomic per-hospital/year counters → MRN, INV, RX, ER...
    notifications/            notify() → in-app row + email/sms/push channel adapters
    storage/                  FileStorage interface, local-disk adapter, upload validation
    pdf/                      branded pdfkit document builders
  modules/<module>/
    <module>.model.ts         Mongoose schema + indexes
    <module>.service.ts       business logic (no req/res)
    <module>.routes.ts        Express router: authenticate → authorize → validate → service
  seed/                       realistic demo data
  app.ts / server.ts
```

Rules:
* Routes contain **no business logic**: they validate, call one service function and serialise.
* Modules call each other only through **service functions** (Pharmacy calls
  `billingService.addCharges`, never `Invoice.create`). That is the seam for later extraction
  into separate services.
* Every route declares a permission. Data-level rules (doctor ↔ patient care relationship,
  patient portal ↔ own record) live in `patients/access.ts`.

## 3. Cross-cutting concerns

| Concern | Implementation |
|---|---|
| **Multi-hospital** | Every operational collection has `hospitalId`. The base plugin adds `hospitalId` from the request context to every query and insert, so a forgotten filter can't leak another hospital's data. Numbering formats, tax, branding are per-hospital documents. |
| **Soft delete** | `isDeleted/deletedAt/deletedBy`; base plugin hides deleted docs by default. Medical and financial collections expose no delete route. |
| **Audit** | `audit.record({ action, module, entity, entityId, before, after })` called by services inside the same transaction. Sensitive fields (`passwordHash`, tokens) are stripped. The AuditLog model throws on any update/delete operation; only the `audit.view` permission can read it. Login, failed login, logout, EMR view and PDF downloads are audited too. |
| **AuthN** | Access JWT (15 min) + opaque refresh token (7 days, stored SHA-256 hashed, rotated on every refresh, reuse revokes the whole token family). Both in `httpOnly; SameSite=Strict` cookies — tokens never reach JS. bcrypt (cost 12). Lockout: 5 failures → 15 min. Password policy: ≥ 10 chars with upper, lower, digit, symbol. MFA fields reserved on the user. |
| **AuthZ** | Roles hold permission codes. Permissions are resolved per request from a 60 s in-memory cache keyed by role ids, so an admin's change applies within a minute without re-login. |
| **CSRF** | SameSite=Strict cookies + mandatory `X-Requested-With: hms` header on non-GET requests + Origin allow-list. |
| **Validation** | Same zod schema on client (form) and server (middleware). Mongoose schema validation and unique indexes as the last line. |
| **Workflows** | `shared/workflows.ts` holds transition tables; `assertTransition(machine, from, to)` throws 409 on illegal moves. |
| **Numbering** | `counters` collection, `findOneAndUpdate({hospitalId,key,year}, {$inc:{seq:1}}, {upsert:true})` is atomic ⇒ never duplicates. Unique index on every business number as second guard. |
| **Transactions** | Billing, payments, dispensing, stock movements run in `withTransaction()` (MongoDB replica set required — the dev script starts a single-node replica set). |
| **Security headers** | helmet, CORS allow-list, `express-mongo-sanitize`-equivalent key stripping (`$`/`.` keys rejected by zod `strict()`), body size limit, upload MIME + magic-byte checks. |
| **Logging** | pino with redaction of `req.headers.cookie`, `authorization`, and any `cnic/phone/email` paths. Request bodies are not logged. |

## 4. Client layout

```
client/src
  app/                router, providers, layout (sidebar, topbar, breadcrumbs, mobile bottom nav)
  components/ui/      Button, Input, Select, Textarea, Dialog, Drawer, Tabs, Badge, Card, DataTable, Pagination, EmptyState, ConfirmDialog
  components/form/    FormField helpers bound to react-hook-form + zod
  lib/api.ts          fetch wrapper (credentials, CSRF header, silent refresh on 401, problem → ApiError)
  lib/auth.tsx        current user + can('perm') hook
  modules/<module>/   pages, components and query hooks per module
```

Permission checks in the client only hide UI; the API enforces every rule independently.

## 5. Path to microservices
Each `server/src/modules/<x>` owns its collections and exposes a service API. To extract one,
move the folder into its own Express app, replace in-process service calls with HTTP/queue
clients, and point it at its own database.

## 6. Backup & recovery
* `mongodump --gzip --archive` nightly to object storage (35-day retention, monthly kept 1 year).
* Production on a 3-node replica set (or Atlas) with continuous oplog backup ⇒ point-in-time restore.
* Monthly restore drill. Backup credentials come from the environment/secret store only.
See `docs/DEPLOYMENT.md`.
