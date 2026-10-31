# UPDATE.bat — update this installation from a newer package (drag the new ZIP, or the folder
# extracted from it, onto UPDATE.bat). Keeps data\, backups\, logs\, app\.env, the uploaded logo,
# EXTRA-ADDRESSES.txt and LOGIN-INFO.txt. A backup is taken first.
param([string]$Source)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'common.ps1')

$tempDir = $null
try {
  if (-not (Test-IsAdmin)) { throw 'Run UPDATE.bat as administrator.' }
  $config = Read-InstallConfig
  if (-not $config) { throw 'This folder is not installed yet — run INSTALL.bat instead.' }

  if (-not $Source) {
    Write-Host 'Drag the NEW package ZIP (or its extracted folder) onto UPDATE.bat, or paste its full path here:'
    $Source = (Read-Host 'Path').Trim('"', ' ')
  }
  if (-not (Test-Path $Source)) { throw "Not found: $Source" }

  if ((Get-Item $Source).PSIsContainer) {
    $newRoot = $Source
  } else {
    Write-Step 'Extracting the new package (can take a few minutes)'
    $tempDir = Join-Path $Root ('_update_' + (Get-Date -Format 'yyyyMMddHHmmss'))
    Expand-Archive -Path $Source -DestinationPath $tempDir -Force
    $newRoot = $tempDir
  }
  # The ZIP contains an EAF-Invoices-Offline folder; accept either level.
  if (-not (Test-Path (Join-Path $newRoot 'app\server.js'))) {
    $inner = Get-ChildItem -Path $newRoot -Directory | Where-Object { Test-Path (Join-Path $_.FullName 'app\server.js') } | Select-Object -First 1
    if (-not $inner) { throw 'This is not an EAF-Invoices offline package (app\server.js not found).' }
    $newRoot = $inner.FullName
  }
  if ((Resolve-Path $newRoot).Path -eq (Resolve-Path $Root).Path) { throw 'Choose the NEW package, not this installed folder.' }
  Write-Ok "New package: $newRoot"

  Write-Step 'Backup before updating'
  Set-RuntimePath
  $code = Invoke-NodeLogged @('scripts\run-backup.js', '--manual') 'backup'
  if ($code -ne 0) { throw "Backup failed — nothing was changed. See $LogsDir\backup-errors.log" }
  Write-Ok "Backup saved in $BackupsDir"

  Write-Step 'Stopping the program'
  Stop-EafApp
  Start-Sleep -Seconds 3

  Write-Step 'Updating program files'
  # /MIR mirrors the new files; excluded names are kept as they are here.
  & robocopy (Join-Path $newRoot 'app') $AppDir /MIR /NFL /NDL /NJH /NJS /NP /R:2 /W:2 /XF '.env' 'logo.*' | Out-Null
  if ($LASTEXITCODE -ge 8) { throw "Copying program files failed (robocopy code $LASTEXITCODE)." }
  & robocopy (Join-Path $newRoot 'tools') (Join-Path $Root 'tools') /MIR /NFL /NDL /NJH /NJS /NP /R:2 /W:2 | Out-Null
  & robocopy (Join-Path $newRoot 'runtime\node') $NodeDir /MIR /NFL /NDL /NJH /NJS /NP /R:2 /W:2 | Out-Null
  Get-ChildItem -Path $newRoot -File | Where-Object { $_.Name -like '*.bat' -or $_.Name -eq 'README-AR.txt' } |
    ForEach-Object { Copy-Item -Force $_.FullName (Join-Path $Root $_.Name) }
  Write-Ok 'Program, scripts and Node.js updated'

  # PostgreSQL: same major version only (a different major version cannot open the existing data).
  $newPg = Join-Path $newRoot 'runtime\pgsql\bin\postgres.exe'
  $dataMajor = (Get-Content (Join-Path $PgData 'PG_VERSION') -ErrorAction SilentlyContinue | Select-Object -First 1)
  $newVer = ''
  if (Test-Path $newPg) { $newVer = (& $newPg -V 2>$null) -replace '[^\d.]', '' }
  if ($newVer -and $dataMajor -and $newVer.Split('.')[0] -eq $dataMajor.Trim()) {
    Write-Step "Updating PostgreSQL to $newVer"
    Stop-Service $PgService -Force -ErrorAction SilentlyContinue
    & robocopy (Join-Path $newRoot 'runtime\pgsql') (Join-Path $Root 'runtime\pgsql') /MIR /NFL /NDL /NJH /NJS /NP /R:2 /W:2 | Out-Null
    Start-Service $PgService
    if (-not (Wait-Postgres ([int]$config.pg_port) 90)) { throw 'PostgreSQL did not start after the update.' }
    Write-Ok "PostgreSQL $newVer"
  } elseif ($newVer) {
    Write-Warn2 "PostgreSQL not changed (new $newVer, data is version $dataMajor)."
  }

  Write-Step 'Starting the program'
  Start-EafApp
  if (-not (Wait-AppHttp ([int]$config.app_port) 180)) {
    throw "The program did not start after the update. See $LogsDir\server-errors.log — the backup from before the update is in $BackupsDir"
  }
  Write-Host ''
  Write-Host '=================================================' -ForegroundColor Green
  Write-Host '  UPDATE COMPLETE — data, users and settings kept' -ForegroundColor Green
  Write-Host "  http://localhost:$($config.app_port)" -ForegroundColor Green
  Write-Host '  Users: press Ctrl+F5 once in the browser.' -ForegroundColor Green
  Write-Host '=================================================' -ForegroundColor Green
} catch {
  Write-Host "FAILED: $($_.Exception.Message)" -ForegroundColor Red
  Write-Host 'Take a photo of this window and send it.' -ForegroundColor Red
  try { if ($config) { Start-EafApp } } catch { }
  exit 1
} finally {
  if ($tempDir -and (Test-Path $tempDir)) { Remove-Item -Recurse -Force $tempDir -ErrorAction SilentlyContinue }
}
