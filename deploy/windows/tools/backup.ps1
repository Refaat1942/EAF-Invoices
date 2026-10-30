# Daily backup (EAF-Backup scheduled task) and BACKUP-NOW.bat.
# Uses the program's own backup (pg_dump custom format, verified, old copies pruned).
param([switch]$Manual)
$ErrorActionPreference = 'Continue'
. (Join-Path $PSScriptRoot 'common.ps1')

New-Item -ItemType Directory -Force -Path $LogsDir, $BackupsDir | Out-Null
Set-RuntimePath
$nodeArgs = @('scripts\run-backup.js')
if ($Manual) { $nodeArgs += '--manual' }
$code = Invoke-NodeLogged $nodeArgs 'backup'
if ($Manual) {
  if ($code -eq 0) {
    Write-Host "Backup done. Files are in: $BackupsDir" -ForegroundColor Green
    Get-ChildItem $BackupsDir -Filter '*.dump' | Sort-Object LastWriteTime -Descending | Select-Object -First 3 Name, @{n='MB';e={[math]::Round($_.Length / 1MB, 2)}}, LastWriteTime | Format-Table | Out-Host
  } else {
    Write-Host "Backup FAILED — see $LogsDir\backup-errors.log" -ForegroundColor Red
  }
}
exit $code
