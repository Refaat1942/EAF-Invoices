# RESTORE-DATA.bat — replace the program's data with a .dump file
# (from the VPS, or one of this server's own backups). A safety backup is taken first.
# IMPORT-SOURCES.bat (-SourcesOnly) — same, then removes all cases (patients, invoices,
# daily entries...) and keeps only the data sources, settings and users.
param([string]$DumpFile, [switch]$SourcesOnly)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'common.ps1')

try {
  if (-not (Test-IsAdmin)) { throw 'Run RESTORE-DATA.bat as administrator.' }
  $config = Read-InstallConfig
  if (-not $config) { throw 'Run INSTALL.bat first.' }
  $pgPort = [int]$config.pg_port

  if (-not $DumpFile) {
    Write-Host 'Drag the .dump file onto RESTORE-DATA.bat, or paste its full path here:'
    $DumpFile = (Read-Host 'Path').Trim('"', ' ')
  }
  if (-not (Test-Path $DumpFile)) { throw "File not found: $DumpFile" }

  Write-Host ''
  if ($SourcesOnly) {
    Write-Host 'IMPORT DATA SOURCES from this file (price lists, items, doctors, stay types, settings, users):' -ForegroundColor Yellow
    Write-Host "  $DumpFile" -ForegroundColor Yellow
    Write-Host 'Patients, invoices and daily entries are NOT imported.' -ForegroundColor Yellow
    Write-Host 'WARNING: everything currently in THIS program (including any cases) will be replaced.' -ForegroundColor Yellow
  } else {
    Write-Host 'WARNING: all current data in the program will be REPLACED by this file:' -ForegroundColor Yellow
    Write-Host "  $DumpFile" -ForegroundColor Yellow
  }
  Write-Host '(a safety backup of the current data is taken first)' -ForegroundColor Yellow
  if (-not (Confirm-Yes)) { Write-Host 'Cancelled.'; exit 0 }

  Set-RuntimePath
  Write-Step 'Stopping the program'
  Stop-EafApp
  Start-Sleep -Seconds 3

  Write-Step 'Safety backup of current data'
  $safety = Join-Path $BackupsDir ('before-restore_' + (Get-Date -Format 'yyyy-MM-dd_HH-mm-ss') + '.dump')
  $ErrorActionPreference = 'Continue'
  $env:PGPASSWORD = $config.pg_superuser_password
  & (Join-Path $PgBin 'pg_dump.exe') -h localhost -p $pgPort -U postgres -Fc -f $safety $DbName 2>&1 | Out-Host
  $dumpCode = $LASTEXITCODE
  $ErrorActionPreference = 'Stop'
  if ($dumpCode -ne 0) { throw 'Safety backup failed — nothing was changed.' }
  Write-Ok $safety

  Write-Step 'Replacing the database'
  Invoke-Psql $pgPort $config.pg_superuser_password 'postgres' "DROP DATABASE IF EXISTS $DbName WITH (FORCE)" | Out-Null
  Invoke-Psql $pgPort $config.pg_superuser_password 'postgres' "CREATE DATABASE $DbName OWNER $DbUser ENCODING 'UTF8' TEMPLATE template0" | Out-Null
  $ErrorActionPreference = 'Continue'
  $env:PGPASSWORD = $config.pg_superuser_password
  & (Join-Path $PgBin 'pg_restore.exe') -h localhost -p $pgPort -U postgres -d $DbName --no-owner "--role=$DbUser" $DumpFile 2>&1 | Out-Host
  $restoreCode = $LASTEXITCODE
  $ErrorActionPreference = 'Stop'
  Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue
  Invoke-Psql $pgPort $config.pg_superuser_password $DbName "GRANT ALL ON SCHEMA public TO $DbUser" | Out-Null
  # pg_restore exits non-zero even for harmless warnings, so judge by whether the program's
  # tables arrived. If they did not, put the previous data back instead of starting empty.
  $tablesArrived = (Invoke-Psql $pgPort $config.pg_superuser_password $DbName "SELECT CASE WHEN to_regclass('public.users') IS NOT NULL AND to_regclass('public.services') IS NOT NULL THEN 1 ELSE 0 END") -match '1'
  if (-not $tablesArrived) {
    Write-Warn2 'The file could not be restored (no program tables in it) — putting the previous data back.'
    Invoke-Psql $pgPort $config.pg_superuser_password 'postgres' "DROP DATABASE IF EXISTS $DbName WITH (FORCE)" | Out-Null
    Invoke-Psql $pgPort $config.pg_superuser_password 'postgres' "CREATE DATABASE $DbName OWNER $DbUser ENCODING 'UTF8' TEMPLATE template0" | Out-Null
    $ErrorActionPreference = 'Continue'
    $env:PGPASSWORD = $config.pg_superuser_password
    & (Join-Path $PgBin 'pg_restore.exe') -h localhost -p $pgPort -U postgres -d $DbName --no-owner "--role=$DbUser" $safety 2>&1 | Out-Null
    Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue
    $ErrorActionPreference = 'Stop'
    Invoke-Psql $pgPort $config.pg_superuser_password $DbName "GRANT ALL ON SCHEMA public TO $DbUser" | Out-Null
    throw 'Nothing was imported; your previous data is back. If the messages above say "unsupported version", the file was made by a newer PostgreSQL (send a photo of this window).'
  }
  if ($restoreCode -ne 0) {
    Write-Warn2 "pg_restore reported warnings/errors (code $restoreCode). Check the program; the safety backup is: $safety"
    Write-Warn2 'If it says "unsupported version", the file was made by a newer PostgreSQL than this package (16).'
  } else {
    Write-Ok 'Data restored'
  }
  if ($SourcesOnly) {
    Write-Step 'Removing cases (patients, invoices, daily entries) — keeping data sources'
    $ErrorActionPreference = 'Continue'
    $env:PGPASSWORD = $config.pg_superuser_password
    $sqlOut = & (Join-Path $PgBin 'psql.exe') -h localhost -p $pgPort -U postgres -d $DbName -v ON_ERROR_STOP=1 -q -f (Join-Path $PSScriptRoot 'keep-sources.sql') 2>&1
    $sqlCode = $LASTEXITCODE
    Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue
    $ErrorActionPreference = 'Stop'
    if ($sqlCode -ne 0) {
      Write-Host ($sqlOut | Out-String)
      throw "Could not remove the cases — the full data is still there. Safety backup: $safety"
    }
    Write-Ok 'Cases removed; data sources, settings and users kept'
  }

  Write-Step 'Starting the program'
  Start-EafApp
  if (Wait-AppHttp ([int]$config.app_port) 180) { Write-Ok 'Program is running' } else { Write-Warn2 "Program did not answer yet — see $LogsDir\server.log" }
  Write-Host ''
  Write-Host 'Done. Users and passwords are now the ones from the imported file (the online ones).' -ForegroundColor Green
} catch {
  Write-Host "FAILED: $($_.Exception.Message)" -ForegroundColor Red
  try { Start-EafApp } catch { }
  exit 1
}
