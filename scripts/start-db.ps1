# Starts a local single-node MongoDB replica set (rs0) on port 27018 for development.
# Transactions (billing, payments, stock) require a replica set; a plain mongod will not do.
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$dataDir = Join-Path $root '.data\db'
$logFile = Join-Path $root '.data\mongod.log'
New-Item -ItemType Directory -Force $dataDir | Out-Null

$mongod = Get-ChildItem 'C:\Program Files\MongoDB\Server\*\bin\mongod.exe' -ErrorAction SilentlyContinue |
  Sort-Object FullName -Descending | Select-Object -First 1
if (-not $mongod) { throw 'mongod.exe not found. Install MongoDB Server (winget install MongoDB.Server).' }

$listening = Get-NetTCPConnection -LocalPort 27018 -State Listen -ErrorAction SilentlyContinue
if ($listening) {
  Write-Output 'MongoDB already listening on 27018.'
} else {
  Start-Process -FilePath $mongod.FullName -WindowStyle Hidden -ArgumentList @(
    '--dbpath', "`"$dataDir`"", '--port', '27018', '--bind_ip', '127.0.0.1',
    '--replSet', 'rs0', '--logpath', "`"$logFile`"", '--logappend'
  )
  for ($i = 0; $i -lt 30; $i++) {
    Start-Sleep -Milliseconds 500
    if (Get-NetTCPConnection -LocalPort 27018 -State Listen -ErrorAction SilentlyContinue) { break }
  }
  Write-Output "mongod started ($($mongod.FullName))."
}

node (Join-Path $root 'scripts\init-replset.mjs')
