# Developer Guide — Adding a Module

Worked example: the Phase 2 **Laboratory** module. Follow the same steps for any module.

## 1. Shared contract (`shared/src`)
1. **Permissions** — add codes to `PERMISSIONS` in `permissions.ts` and to the right roles in
   `DEFAULT_ROLE_PERMISSIONS` (e.g. `lab.process`, `lab.verify` already exist).
2. **Enums & workflow** — add statuses to `enums.ts` and a transition table to `workflows.ts`:
   ```ts
   export const labOrderWorkflow: Workflow<LabOrderStatus> = {
     name: 'Lab order',
     transitions: { Ordered: ['SamplePending', 'Cancelled'], SamplePending: ['SampleCollected'], /* … */ },
   };
   ```
3. **Schemas** — create `schemas/lab.ts` with zod schemas for every request body/query and
   export it from `index.ts`. The same schema validates the form and the API.

## 2. Server (`server/src/modules/lab`)
| File | Contents |
|---|---|
| `lab.models.ts` | Mongoose schemas. Apply `basePlugin` (`{ softDelete: true }` where records may be retracted). Add unique indexes for business numbers and compound indexes for list filters. Spread `tenantField`/`softDeleteFields` into the definition if code reads those fields. |
| `lab.service.ts` | All business logic. Use `withTransaction()` for multi-document writes, `assertTransition()` for status changes, `nextNumber('labOrder', hospital.numbering.labOrder, code)` for numbers, `recordAudit()` for every sensitive change (pass `before`/`after`), `notify()` for user-facing events, `assertClinicalAccess()` before returning patient data. Call other modules only via their services (e.g. `billing.addCharges({ sourceRef: \`lab:${order._id}\` … })`). |
| `lab.routes.ts` | `Router()` with `requirePermission(...)`, `validate(schema, 'body'|'query'|'params')`, `ah(async …)`. No logic beyond calling one service function. |

Mount the router in `src/app.ts` under the authenticated `api` router.
Add a `SequenceKey` in `core/numbering/numbering.ts` if the module needs a new number series.

## 3. Client (`client/src`)
1. Add types to `types.ts`.
2. Create `pages/lab/*.tsx` using the UI kit (`components/ui`), `Field`/`handleFormError`, and
   TanStack Query (`api.get/post`). Use `zodResolver(sharedSchema)` for forms.
3. Register routes in `app/App.tsx` wrapped in `guard([...permissions], <Page/>)`.
4. In `app/nav.ts` remove the `phase` flag from the module's nav item so it becomes active.
5. Status colours: add new statuses to `STATUS_TONE` in `components/ui/badge.tsx`.

## 4. Data migrations
Mongoose builds indexes and new fields default themselves, but existing data sometimes has to
change (new permissions for system roles, defaults for new settings, counter fixes). Add a
migration to `server/src/migrations/migrations.ts`:

```ts
{ id: '004-short-name', description: 'What and why', async up(hospitalId) { /* idempotent */ return 'summary'; } }
```

Migrations run once per database, in order, for every hospital (with that hospital in context),
and are recorded in `schemamigrations`. They run automatically when the API starts and with
`npm run migrate`. Never edit or reorder an applied migration — add a new one.

## 5. Background jobs
Periodic work (stock alerts, medication reminders, appointment reminders) lives in
`<module>.jobs.ts` with a `run…Pass(now)` function (testable with an injected clock) and a
`schedule…()` timer started in `server.ts`. Loop over hospitals with `runWithContext({ hospitalId })`.

## 6. Configurable lists
Anything a hospital may want to change (appointment types, payment methods, medicine categories)
goes in `hospitals.catalog` (`catalogSchema` in shared, `organization/catalog.ts` on the server,
`useCatalog()` in the client) — never in an enum the UI hard-codes.

## 7. Tests & docs
* Add a `tests/<module>.workflow.test.ts` that walks the module's workflow over HTTP, including
  permission denials and invalid transitions. Make tests independent of the wall clock (book with
  `freeSlot`, give the test doctor 00:00–23:59 duty, compute dates relative to today).
* Update `docs/API.md`, `docs/DATABASE.md`, `docs/SECURITY.md` and the tracker.

## Rules that keep the codebase healthy
* No business rules in React components — compute on the server; the client may preview using
  `@hms/shared` helpers (BMI, line totals) but the server result is authoritative.
* Never trust client totals, statuses or ids for ownership — recompute and re-check.
* Never hard-delete medical or financial data; never log patient identifiers.
* Every new route needs a permission and a validation schema; every state change needs an audit entry.
