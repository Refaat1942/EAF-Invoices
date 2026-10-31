# RESET-ADMIN-PASSWORD.bat — set a new password for the "admin" user (e.g. after
# IMPORT-SOURCES replaced the users, and the online admin password is not known).
# Does not touch any other user or any data.
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'common.ps1')

try {
  if (-not (Test-IsAdmin)) { throw 'Run RESET-ADMIN-PASSWORD.bat as administrator.' }
  $config = Read-InstallConfig
  if (-not $config) { throw 'Run INSTALL.bat first.' }

  Write-Host 'Set a NEW password for the user:  admin' -ForegroundColor Yellow
  Write-Host '(8 characters or more, English letters/numbers; the keyboard must be on ENG)'
  $p1 = [string](Read-Host 'New password')
  $p2 = [string](Read-Host 'Type it again')
  $p1 = $p1.Trim(); $p2 = $p2.Trim()
  if ($p1.Length -lt 8) { throw 'The password must be at least 8 characters.' }
  if ($p1 -cne $p2) { throw 'The two passwords are different — nothing was changed.' }
  if ($p1 -match '[\s"]') { throw 'Do not use spaces or " in the password.' }

  Set-RuntimePath
  $code = Invoke-NodeLogged @('scripts\repair-system-access.js', '--reset-admin', "--password=$p1") 'reset-admin'
  if ($code -ne 0) { throw "Could not reset the password. See $LogsDir\reset-admin-errors.log" }

  Write-Host ''
  Write-Host '=================================================' -ForegroundColor Green
  Write-Host '  Password changed.' -ForegroundColor Green
  Write-Host '  Username: admin' -ForegroundColor Green
  Write-Host "  Password: $p1" -ForegroundColor Green
  Write-Host "  http://localhost:$($config.app_port)" -ForegroundColor Green
  Write-Host '=================================================' -ForegroundColor Green
} catch {
  Write-Host "FAILED: $($_.Exception.Message)" -ForegroundColor Red
  exit 1
}
