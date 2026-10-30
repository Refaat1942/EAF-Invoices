# RESTORE-DATA.bat — replace the program's data with a .dump file
# (from the VPS, or one of this server's own backups). A safety backup is taken first.
param([string]$DumpFile)
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
  Write-Host 'WARNING: all current data in the program will be REPLACED by this file:' -ForegroundColor Yellow
  Write-Host "  $DumpFile" -ForegroundColor Yellow
  Write-Host '(a safety backup of the current data is taken first)' -ForegroundColor Yellow
  if ((Read-Host 'Type YES to continue') -cne 'YES') { Write-Host 'Cancelled.'; exit 0 }

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
  if ($restoreCode -ne 0) {
    Write-Warn2 "pg_restore reported warnings/errors (code $restoreCode). Check the program; the safety backup is: $safety"
  } else {
    Write-Ok 'Data restored'
  }

  Write-Step 'Starting the program'
  Start-EafApp
  if (Wait-AppHttp ([int]$config.app_port) 180) { Write-Ok 'Program is running' } else { Write-Warn2 "Program did not answer yet — see $LogsDir\server.log" }
  Write-Host ''
  Write-Host 'Done. Users and passwords are now the ones from the restored data.' -ForegroundColor Green
} catch {
  Write-Host "FAILED: $($_.Exception.Message)" -ForegroundColor Red
  try { Start-EafApp } catch { }
  exit 1
}
