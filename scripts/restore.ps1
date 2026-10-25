<#
  Restores an archive written by backup.ps1 / backup.sh.

  DESTRUCTIVE for the target database (uses --drop). Point -TargetUri at a fresh/staging replica set
  for restore drills; restore into production only during an incident, after taking a fresh backup.

  .\scripts\restore.ps1 -Archive .\backups\hms-20261016-0200.gz -TargetUri "mongodb://127.0.0.1:27018/hms_restore?replicaSet=rs0"
  restores the archive's "hms" database into "hms_restore" (the database named in the URI).
  Check with: node scripts/count-docs.mjs "mongodb://127.0.0.1:27018/?replicaSet=rs0" hms_restore
#>
param(
  [Parameter(Mandatory = $true)][string]$Archive,
  [Parameter(Mandatory = $true)][string]$TargetUri,
  [string]$FromDb = 'hms',
  [string]$ToDb
)
$ErrorActionPreference = 'Stop'
if (-not (Test-Path $Archive)) { throw "Archive not found: $Archive" }
$restore = Get-Command mongorestore -ErrorAction SilentlyContinue
if (-not $restore) {
  $candidate = Get-ChildItem 'C:\Program Files\MongoDB\Tools\*\bin\mongorestore.exe' -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($candidate) { $restore = $candidate.FullName } else { throw 'mongorestore not found. Install MongoDB Database Tools.' }
} else { $restore = $restore.Source }

# mongorestore ignores the database in --uri for archive restores and would write back into the
# original namespace ($FromDb). Take the target database from the URI unless -ToDb is given, so a
# drill aimed at ".../hms_restore" can never overwrite "hms".
if (-not $ToDb -and $TargetUri -match '^mongodb(\+srv)?://[^/]+/([^/?]+)') { $ToDb = $Matches[2] }
if (-not $ToDb) { throw 'Name the target database in -TargetUri (…/dbname?…) or pass -ToDb.' }
Write-Output "Restoring '$FromDb' from $Archive into database '$ToDb' (existing collections there are dropped)."
# Connect without a database in the URI (a database there acts as a namespace filter on the
# archive) and select/rename namespaces explicitly instead.
$serverUri = $TargetUri -replace '^(mongodb(\+srv)?://[^/]+)/[^?]*', '$1/'
$restoreArgs = @("--uri=$serverUri", '--gzip', "--archive=$Archive", '--drop', "--nsInclude=$FromDb.*")
if ($ToDb -ne $FromDb) { $restoreArgs += @("--nsFrom=$FromDb.*", "--nsTo=$ToDb.*") }
& $restore @restoreArgs
if ($LASTEXITCODE -ne 0) { throw "mongorestore failed with exit code $LASTEXITCODE" }
Write-Output 'Restore complete. Verify with GET /api/health and an audit-log spot check.'
