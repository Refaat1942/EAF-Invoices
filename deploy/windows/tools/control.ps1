# START.bat / STOP.bat / UNINSTALL.bat
param([ValidateSet('start', 'stop', 'uninstall')][string]$Action)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'common.ps1')

try {
  if (-not (Test-IsAdmin)) { throw 'Run as administrator.' }
  $config = Read-InstallConfig
  switch ($Action) {
    'start' {
      if (-not $config) { throw 'Run INSTALL.bat first.' }
      $svc = Get-Service -Name $PgService -ErrorAction SilentlyContinue
      if ($svc -and $svc.Status -ne 'Running') { Start-Service $PgService }
      Stop-EafApp
      Start-Sleep -Seconds 2
      Start-EafApp
      Write-Host 'Starting...'
      if (Wait-AppHttp ([int]$config.app_port) 120) {
        Write-Host "Program is running:  http://localhost:$($config.app_port)" -ForegroundColor Green
        foreach ($o in (Get-AllowedOrigins ([int]$config.app_port))) { Write-Host "  $o" }
      } else {
        Write-Host "Program did not answer — see $LogsDir\server.log" -ForegroundColor Red
      }
    }
    'stop' {
      Stop-EafApp
      Write-Host 'Program stopped (the database keeps running). Use START.bat to start it again.' -ForegroundColor Yellow
    }
    'uninstall' {
      Write-Host 'This removes the automatic start, the backup task, the firewall rule and the database service.'
      Write-Host "Your data is KEPT in: $DataDir and $BackupsDir" -ForegroundColor Yellow
      if ((Read-Host 'Type YES to continue') -cne 'YES') { Write-Host 'Cancelled.'; exit 0 }
      Stop-EafApp
      foreach ($t in @($AppTask, $BackupTask)) { Unregister-ScheduledTask -TaskName $t -Confirm:$false -ErrorAction SilentlyContinue }
      Get-NetFirewallRule -DisplayName $FwRule -ErrorAction SilentlyContinue | Remove-NetFirewallRule
      if (Get-Service -Name $PgService -ErrorAction SilentlyContinue) {
        Stop-Service $PgService -Force -ErrorAction SilentlyContinue
        $ErrorActionPreference = 'Continue'
        & (Join-Path $PgBin 'pg_ctl.exe') unregister -N $PgService 2>&1 | Out-Null
      }
      Write-Host 'Removed. Run INSTALL.bat again any time — it reuses the kept data.' -ForegroundColor Green
    }
  }
} catch {
  Write-Host "FAILED: $($_.Exception.Message)" -ForegroundColor Red
  exit 1
}
