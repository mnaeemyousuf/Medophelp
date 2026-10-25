# Deployment, Backup & Recovery

## Topology

```
Internet ─TLS─▶ Reverse proxy (nginx / Caddy / cloud LB)
                 ├─ /        → client/dist (static files)
                 └─ /api/*   → Node API (2+ instances, PM2 or containers)
                                  └─ MongoDB replica set (3 nodes or Atlas) + object storage
```

Serve the SPA and the API from **one origin** so SameSite=Strict cookies work without CORS.

## Build & run

```bash
npm ci
```
```bash
npm run build
```
```bash
NODE_ENV=production node --env-file=server/.env server/dist/server.js
```

Production `.env` essentials: `NODE_ENV=production`, `COOKIE_SECURE=true`, a fresh
`JWT_ACCESS_SECRET` from your secret store, `MONGODB_URI` with credentials and `replicaSet`,
`CORS_ORIGINS` set to the public origin, `TZ` set to the hospital time zone. Leave
`SEED_DEMO_PASSWORD` unset — seeding refuses to run in production anyway.

Running more than one API instance: replace the in-memory principal cache and rate-limit store
with Redis (both are isolated behind small modules: `identity/principal.ts`, `app.ts`).

## Migrations

Data migrations (`server/src/migrations`) run automatically when the API starts and can be run
on their own before switching traffic:

```bash
NODE_ENV=production node --env-file=server/.env server/dist/migrations/run.js
```

## Backups

Ready-made scripts (connection string from `MONGODB_URI` in the environment — never in the script):

* Linux: `scripts/backup.sh` — cron `0 2 * * * /opt/hms/scripts/backup.sh`; set `BACKUP_UPLOAD_CMD`/`BACKUP_UPLOAD_TARGET` to ship archives to object storage.
* Windows: `scripts/backup.ps1` (or `npm run db:backup`) — register with Task Scheduler (command in the script header).
* Restore drill: `scripts/restore.ps1 -Archive … -TargetUri <staging replica set>` (uses `--drop`; never point it at production outside an incident).

Both backup scripts keep 35 days of dailies and 12 monthly (1st-of-month) archives; adjust with parameters/env vars.

| What | How | Retention |
|---|---|---|
| Nightly full | `mongodump --uri "$MONGODB_URI" --gzip --archive=hms-$(date +%F).gz` → object storage (encrypted bucket, versioning on) | 35 days |
| Monthly | Copy of the 1st-of-month archive | 12 months |
| Point-in-time | Replica set oplog backup (Atlas continuous backup, or Percona Backup for MongoDB) | 7 days PITR |
| Documents | Object-storage versioning + cross-region replication | Same as clinical record policy |

Credentials for backup jobs come from the scheduler's secret store — never from the repository.

## Recovery

* **RPO** ≤ 5 minutes (oplog), **RTO** ≤ 1 hour.
* Restore: `mongorestore --gzip --archive=… --drop` into a fresh replica set, then replay oplog
  to the target time, point the API at it, verify with `/api/health` and an audit-log spot check.
* Run a restore drill monthly into staging and record the result.

## Data retention

Medical records and the audit log are never hard-deleted by the application. Legal retention
(e.g. minimum years for medical records) is enforced by archival jobs that move cold data to
cheaper storage, not by deletion. Refresh/reset tokens expire automatically via TTL indexes.
