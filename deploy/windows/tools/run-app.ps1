# Launched by the "EAF-Invoices" scheduled task (as SYSTEM) at every Windows start.
# Keeps the program running: if node exits unexpectedly it is started again.
$ErrorActionPreference = 'Continue'
. (Join-Path $PSScriptRoot 'common.ps1')

New-Item -ItemType Directory -Force -Path $LogsDir | Out-Null
$log = Join-Path $LogsDir 'launcher.log'
if ((Test-Path $log) -and ((Get-Item $log).Length -gt 5MB)) { Move-Item -Force $log (Join-Path $LogsDir 'launcher.prev.log') }
function Log([string]$Text) { Add-Content -Path $log -Value ("[{0}] {1}" -f (Get-Date -Format s), $Text) }

$config = Read-InstallConfig
if (-not $config) { Log 'Not installed yet — run INSTALL.bat'; exit 1 }
$appPort = [int]$config.app_port
$pgPort = [int]$config.pg_port

Set-RuntimePath
if (Test-Path $StopFlag) { Remove-Item -Force $StopFlag }

$svc = Get-Service -Name $PgService -ErrorAction SilentlyContinue
if ($svc -and $svc.Status -ne 'Running') { Start-Service $PgService -ErrorAction SilentlyContinue }
if (-not (Wait-Postgres $pgPort 180)) { Log 'PostgreSQL is not answering — starting the program anyway' }

$origins = Update-AllowedOrigins $appPort
Log ("Allowed addresses: " + ($origins -join ', '))

while ($true) {
  Log "Starting program on port $appPort (output: logs\server.log, logs\server-errors.log)"
  $code = Invoke-NodeLogged @('server.js') 'server'
  Log "Program exited (code $code)"
  if (Test-Path $StopFlag) { Log 'Stopped by STOP.bat'; break }
  Start-Sleep -Seconds 5
}
