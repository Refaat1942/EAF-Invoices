# CLEAR-CASES.bat — delete all cases (patients, invoices, daily entries) and start the
# numbering again from 1. Keeps data sources, prices, settings and users.
# A full backup is taken first, so this can be undone with RESTORE-DATA.bat.
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'common.ps1')

try {
  if (-not (Test-IsAdmin)) { throw 'Run CLEAR-CASES.bat as administrator.' }
  $config = Read-InstallConfig
  if (-not $config) { throw 'Run INSTALL.bat first.' }
  $pgPort = [int]$config.pg_port

  Write-Host ''
  Write-Host 'DELETE ALL CASES: patients, invoices, daily entries, payments, audit log.' -ForegroundColor Yellow
  Write-Host 'KEPT: price lists, items, doctors, stay types, settings, users and passwords.' -ForegroundColor Yellow
  Write-Host 'File numbers and invoice numbers start again from 1.' -ForegroundColor Yellow
  Write-Host '(a full backup is taken first)' -ForegroundColor Yellow
  if (-not (Confirm-Yes)) { Write-Host 'Cancelled.'; exit 0 }

  Set-RuntimePath
  Write-Step 'Stopping the program'
  Stop-EafApp
  Start-Sleep -Seconds 3

  Write-Step 'Backup of current data'
  $safety = Join-Path $BackupsDir ('before-clear-cases_' + (Get-Date -Format 'yyyy-MM-dd_HH-mm-ss') + '.dump')
  $ErrorActionPreference = 'Continue'
  $env:PGPASSWORD = $config.pg_superuser_password
  & (Join-Path $PgBin 'pg_dump.exe') -h localhost -p $pgPort -U postgres -Fc -f $safety $DbName 2>&1 | ForEach-Object { "$_" } | Out-Host
  $dumpCode = $LASTEXITCODE
  $ErrorActionPreference = 'Stop'
  if ($dumpCode -ne 0) { throw 'Backup failed — nothing was deleted.' }
  Write-Ok $safety

  Write-Step 'Deleting cases'
  $ErrorActionPreference = 'Continue'
  $sqlOut = & (Join-Path $PgBin 'psql.exe') -h localhost -p $pgPort -U postgres -d $DbName -v ON_ERROR_STOP=1 -q -f (Join-Path $PSScriptRoot 'clear-cases.sql') 2>&1
  $sqlCode = $LASTEXITCODE
  Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue
  $ErrorActionPreference = 'Stop'
  if ($sqlCode -ne 0) {
    Write-Host ($sqlOut | Out-String)
    throw 'Could not delete the cases — nothing was changed.'
  }
  Write-Ok 'Cases deleted; data sources, settings and users kept'

  Write-Step 'Starting the program'
  Start-EafApp
  if (Wait-AppHttp ([int]$config.app_port) 180) { Write-Ok 'Program is running' } else { Write-Warn2 "Program did not answer yet — see $LogsDir\server.log" }
  Write-Host ''
  Write-Host 'Done. Users: press Ctrl+F5 once in the browser.' -ForegroundColor Green
  Write-Host "To undo: drag $safety onto RESTORE-DATA.bat" -ForegroundColor Green
} catch {
  Write-Host "FAILED: $($_.Exception.Message)" -ForegroundColor Red
  try { Start-EafApp } catch { }
  exit 1
}
