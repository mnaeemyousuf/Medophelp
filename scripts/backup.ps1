<#
  Nightly MongoDB backup for Windows hosts (Task Scheduler).

  - Connection string comes from the MONGODB_URI environment variable (or server/.env in development);
    nothing secret lives in this file.
  - Writes a gzip archive per run to $BackupDir (default: .\backups), keeps $RetentionDays days of
    dailies plus the 1st-of-month archives for $MonthlyKeep months.
  - Requires MongoDB Database Tools (mongodump):  winget install MongoDB.DatabaseTools

  Schedule (daily 02:00):
    schtasks /Create /SC DAILY /ST 02:00 /TN "HMS backup" /TR "powershell -ExecutionPolicy Bypass -File C:\path\to\scripts\backup.ps1"
#>
param(
  [string]$BackupDir = (Join-Path $PSScriptRoot '..\backups'),
  [int]$RetentionDays = 35,
  [int]$MonthlyKeep = 12
)
$ErrorActionPreference = 'Stop'

$uri = $env:MONGODB_URI
if (-not $uri) {
  $envFile = Join-Path $PSScriptRoot '..\server\.env'
  if (Test-Path $envFile) {
    $line = Get-Content $envFile | Where-Object { $_ -match '^\s*MONGODB_URI\s*=' } | Select-Object -First 1
    if ($line) { $uri = ($line -split '=', 2)[1].Trim().Trim('"') }
  }
}
if (-not $uri) { throw 'MONGODB_URI is not set (environment or server/.env).' }

$dump = Get-Command mongodump -ErrorAction SilentlyContinue
if (-not $dump) {
  $candidate = Get-ChildItem 'C:\Program Files\MongoDB\Tools\*\bin\mongodump.exe' -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($candidate) { $dump = $candidate.FullName } else { throw 'mongodump not found. Install MongoDB Database Tools (winget install MongoDB.DatabaseTools).' }
} else { $dump = $dump.Source }

New-Item -ItemType Directory -Force $BackupDir | Out-Null
$stamp = Get-Date -Format 'yyyyMMdd-HHmm'
$archive = Join-Path $BackupDir "hms-$stamp.gz"

& $dump --uri="$uri" --gzip --archive="$archive" --quiet
if ($LASTEXITCODE -ne 0) { throw "mongodump failed with exit code $LASTEXITCODE" }
$size = [math]::Round((Get-Item $archive).Length / 1MB, 2)
Write-Output "Backup written: $archive ($size MB)"

# Retention: keep recent dailies and monthly archives (taken on the 1st).
$now = Get-Date
Get-ChildItem $BackupDir -Filter 'hms-*.gz' | ForEach-Object {
  if ($_.Name -notmatch '^hms-(\d{8})-\d{4}\.gz$') { return }
  $day = [datetime]::ParseExact($Matches[1], 'yyyyMMdd', $null)
  $isMonthly = $day.Day -eq 1
  $age = ($now - $day).TotalDays
  if (($isMonthly -and $age -gt ($MonthlyKeep * 31)) -or (-not $isMonthly -and $age -gt $RetentionDays)) {
    Remove-Item -LiteralPath $_.FullName -Confirm:$false
    Write-Output "Pruned: $($_.Name)"
  }
}
