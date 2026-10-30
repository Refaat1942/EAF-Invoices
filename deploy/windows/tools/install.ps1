# EAF-Invoices — one-click offline installer for Windows (run via INSTALL.bat as administrator).
# Safe to run again: every step checks what already exists and keeps existing data.
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'common.ps1')

function Fail([string]$Text) {
  Write-Host ''
  Write-Host "FAILED: $Text" -ForegroundColor Red
  Write-Host "Take a photo of this window and send it." -ForegroundColor Red
  exit 1
}

try {
  if (-not (Test-IsAdmin)) { Fail 'Run INSTALL.bat with right-click > Run as administrator.' }
  foreach ($p in @($NodeExe, (Join-Path $PgBin 'postgres.exe'), (Join-Path $AppDir 'server.js'))) {
    if (-not (Test-Path $p)) { Fail "Package is incomplete, missing: $p  (extract the whole ZIP again)." }
  }

  Write-Step 'Preparing folders'
  # Files extracted from a downloaded ZIP are marked as "from the internet"; clear that.
  Get-ChildItem -Path $Root -Recurse -File -ErrorAction SilentlyContinue | Unblock-File -ErrorAction SilentlyContinue
  foreach ($d in @($DataDir, $LogsDir, $BackupsDir)) { New-Item -ItemType Directory -Force -Path $d | Out-Null }
  # data\ holds the database and passwords: Administrators, SYSTEM and the installing user only
  # (SIDs work on any Windows language). PostgreSQL's setup runs without the Administrators group,
  # so the installing user needs its own entry; the database service (NETWORK SERVICE) may enter.
  $me = '*' + [Security.Principal.WindowsIdentity]::GetCurrent().User.Value + ':(OI)(CI)F'
  & icacls $DataDir /inheritance:r /grant:r '*S-1-5-32-544:(OI)(CI)F' '*S-1-5-18:(OI)(CI)F' $me '*S-1-5-20:(RX)' | Out-Null
  Write-Ok $Root

  $config = Read-InstallConfig
  if (-not $config) {
    $config = [pscustomobject]@{
      app_port = (Find-FreePort @(8080, 8081, 8082, 8088, 8090, 17159))
      pg_port = (Find-FreePort @(5433, 5434, 5435, 5436))
      pg_superuser_password = (New-HexSecret 24)
      installed_at = (Get-Date).ToString('s')
    }
    Save-InstallConfig $config
  }
  $appPort = [int]$config.app_port
  $pgPort = [int]$config.pg_port
  Write-Ok "Program port $appPort, database port $pgPort"

  # ── PostgreSQL ──────────────────────────────────────────────
  Write-Step 'Database (PostgreSQL)'
  if (-not (Test-Path (Join-Path $PgData 'PG_VERSION'))) {
    $pwFile = Join-Path $DataDir 'pw.tmp'
    Write-Utf8NoBom $pwFile $config.pg_superuser_password
    try {
      $ErrorActionPreference = 'Continue'
      & (Join-Path $PgBin 'initdb.exe') -D $PgData -U postgres -E UTF8 --no-locale -A scram-sha-256 "--pwfile=$pwFile" 2>&1 | Out-Host
      $code = $LASTEXITCODE
      $ErrorActionPreference = 'Stop'
      if ($code -ne 0) { Fail 'initdb could not create the database folder.' }
    } finally { Remove-Item -Force $pwFile -ErrorAction SilentlyContinue }
    Add-Content -Path (Join-Path $PgData 'postgresql.conf') -Encoding ASCII -Value @(
      '', '# EAF-Invoices', "port = $pgPort", "listen_addresses = 'localhost'"
    )
    Write-Ok 'Database folder created'
  } else {
    Write-Ok 'Database folder already exists (kept)'
  }
  # The PostgreSQL service runs as NETWORK SERVICE (S-1-5-20); it must own its data folder.
  & icacls $PgData /grant '*S-1-5-20:(OI)(CI)F' /T /Q | Out-Null

  $svc = Get-Service -Name $PgService -ErrorAction SilentlyContinue
  if ($svc) {
    $imagePath = (Get-ItemProperty "HKLM:\SYSTEM\CurrentControlSet\Services\$PgService").ImagePath
    if ($imagePath -notlike "*$PgBin*") {
      Write-Warn2 'Folder was moved — re-registering the database service'
      Stop-Service $PgService -Force -ErrorAction SilentlyContinue
      & sc.exe delete $PgService | Out-Null
      Start-Sleep -Seconds 2
      $svc = $null
    }
  }
  if (-not $svc) {
    $ErrorActionPreference = 'Continue'
    & (Join-Path $PgBin 'pg_ctl.exe') register -N $PgService -D $PgData -S auto 2>&1 | Out-Host
    $code = $LASTEXITCODE
    $ErrorActionPreference = 'Stop'
    if ($code -ne 0) { Fail 'Could not register the PostgreSQL service.' }
  }
  Set-Service -Name $PgService -StartupType Automatic
  if ((Get-Service $PgService).Status -ne 'Running') { Start-Service $PgService }
  if (-not (Wait-Postgres $pgPort 90)) { Fail "PostgreSQL did not start. Check $PgData\log" }
  Write-Ok "PostgreSQL service '$PgService' is running"

  # ── Program database + .env ─────────────────────────────────
  Write-Step 'Program database and settings'
  $envExists = Test-Path $EnvFile
  $dbPassword = $null
  if ($envExists) {
    $m = [regex]::Match([IO.File]::ReadAllText($EnvFile), "(?m)^DATABASE_URL=postgresql://${DbUser}:([^@]+)@")
    if ($m.Success) { $dbPassword = $m.Groups[1].Value }
  }
  if (-not $dbPassword) { $dbPassword = New-HexSecret 16 }

  $roleExists = (Invoke-Psql $pgPort $config.pg_superuser_password 'postgres' "SELECT 1 FROM pg_roles WHERE rolname='$DbUser'") -match '1'
  if ($roleExists) {
    Invoke-Psql $pgPort $config.pg_superuser_password 'postgres' "ALTER ROLE $DbUser WITH LOGIN PASSWORD '$dbPassword'" | Out-Null
  } else {
    Invoke-Psql $pgPort $config.pg_superuser_password 'postgres' "CREATE ROLE $DbUser LOGIN PASSWORD '$dbPassword'" | Out-Null
  }
  $dbExists = (Invoke-Psql $pgPort $config.pg_superuser_password 'postgres' "SELECT 1 FROM pg_database WHERE datname='$DbName'") -match '1'
  if (-not $dbExists) {
    Invoke-Psql $pgPort $config.pg_superuser_password 'postgres' "CREATE DATABASE $DbName OWNER $DbUser ENCODING 'UTF8' TEMPLATE template0" | Out-Null
  }
  Invoke-Psql $pgPort $config.pg_superuser_password $DbName "GRANT ALL ON SCHEMA public TO $DbUser" | Out-Null
  Write-Ok "Database '$DbName' and user '$DbUser' ready"

  $adminPassword = $null
  if (-not $envExists) {
    $adminPassword = New-AdminPassword
    $backupPath = $BackupsDir.Replace('\', '/')
    $envText = @(
      'NODE_ENV=production'
      "PORT=$appPort"
      'HOST=0.0.0.0'
      "DATABASE_URL=postgresql://${DbUser}:${dbPassword}@localhost:$pgPort/$DbName"
      "SESSION_SECRET=$(New-HexSecret 32)"
      "APP_SECRET=$(New-HexSecret 32)"
      'ALLOWED_ORIGINS='
      'PUBLIC_APP_URL='
      "ADMIN_PASSWORD=`"$adminPassword`""
      "BACKUP_DIR=$backupPath"
      'BACKUP_RETENTION_DAYS=30'
    ) -join "`r`n"
    Write-Utf8NoBom $EnvFile ($envText + "`r`n")
    Write-Ok 'Settings file app\.env created'
  } else {
    $text = [IO.File]::ReadAllText($EnvFile)
    $text = Set-EnvValue $text 'DATABASE_URL' "postgresql://${DbUser}:${dbPassword}@localhost:$pgPort/$DbName"
    $text = Set-EnvValue $text 'PORT' "$appPort"
    Write-Utf8NoBom $EnvFile $text
    Write-Ok 'Settings file app\.env already exists (kept)'
  }
  $origins = @(Update-AllowedOrigins $appPort)
  & icacls $EnvFile /inheritance:r /grant:r '*S-1-5-32-544:F' '*S-1-5-18:F' | Out-Null

  # ── Firewall ────────────────────────────────────────────────
  Write-Step 'Windows Firewall'
  Get-NetFirewallRule -DisplayName $FwRule -ErrorAction SilentlyContinue | Remove-NetFirewallRule
  New-NetFirewallRule -DisplayName $FwRule -Direction Inbound -Protocol TCP -LocalPort $appPort -Action Allow -Profile Any | Out-Null
  Write-Ok "Port $appPort open for the local network"

  # ── Scheduled tasks: program at startup, backup at 03:00 ────
  Write-Step 'Automatic start and daily backup'
  $ps = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
  $principal = New-ScheduledTaskPrincipal -UserId 'NT AUTHORITY\SYSTEM' -LogonType ServiceAccount -RunLevel Highest
  $settings = New-ScheduledTaskSettingsSet -ExecutionTimeLimit ([TimeSpan]::Zero) -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -MultipleInstances IgnoreNew

  $appAction = New-ScheduledTaskAction -Execute $ps -Argument ("-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"" + (Join-Path $PSScriptRoot 'run-app.ps1') + "`"")
  Register-ScheduledTask -TaskName $AppTask -Action $appAction -Trigger (New-ScheduledTaskTrigger -AtStartup) -Principal $principal -Settings $settings -Force | Out-Null

  $bkAction = New-ScheduledTaskAction -Execute $ps -Argument ("-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"" + (Join-Path $PSScriptRoot 'backup.ps1') + "`"")
  $bkSettings = New-ScheduledTaskSettingsSet -ExecutionTimeLimit (New-TimeSpan -Hours 2) -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable
  Register-ScheduledTask -TaskName $BackupTask -Action $bkAction -Trigger (New-ScheduledTaskTrigger -Daily -At 3am) -Principal $principal -Settings $bkSettings -Force | Out-Null
  Write-Ok "Tasks '$AppTask' (at startup) and '$BackupTask' (daily 03:00) registered"

  # ── Start ───────────────────────────────────────────────────
  Write-Step 'Starting the program (first start creates the tables, may take a minute)'
  Stop-EafApp
  Start-Sleep -Seconds 2
  Start-EafApp
  if (-not (Wait-AppHttp $appPort 180)) { Fail "The program did not start. See $LogsDir\server.log" }
  Write-Ok "Program is running on port $appPort"

  # ── Summary ─────────────────────────────────────────────────
  $lanLinks = @($origins | Where-Object { $_ -notmatch 'localhost|127\.0\.0\.1' })
  $info = @(
    'برنامج الفواتير EAF-Invoices — بيانات الدخول'
    '================================================'
    ''
    'على السيرفر نفسه:'
    "    http://localhost:$appPort"
    ''
    'من باقي أجهزة الشبكة (اكتب واحد منهم في Chrome أو Edge):'
  ) + ($lanLinks | ForEach-Object { "    $_" }) + @(
    ''
  )
  if ($adminPassword) {
    $info += @(
      'المستخدم الأول:'
      '    اسم المستخدم:  admin'
      "    كلمة المرور:   $adminPassword"
      '    (غيّرها من الإعدادات ← المستخدمين بعد أول دخول)'
      ''
    )
  } else {
    $info += @('المستخدمين وكلمات المرور: زي ما هي (التثبيت اتعمل قبل كده).', '')
  }
  $info += @(
    'مهم:'
    '  - البرنامج بيشتغل لوحده مع تشغيل السيرفر — مش محتاج تفتح أي حاجة.'
    "  - نسخة احتياطية تلقائية كل يوم الساعة 3 الفجر في: $BackupsDir"
    '    انقل النسخ لفلاشة أو هارد خارجي كل أسبوع.'
    '  - لو الموظفين هيدخلوا بعنوان تاني (اسم جهاز أو دومين): اكتبه في EXTRA-ADDRESSES.txt ثم شغّل START.bat'
    '  - احتفظ بالورقة دي في مكان آمن.'
  )
  $infoFile = Join-Path $Root 'LOGIN-INFO.txt'
  Write-Utf8Bom $infoFile (($info -join "`r`n") + "`r`n")
  & icacls $infoFile /inheritance:r /grant:r '*S-1-5-32-544:F' '*S-1-5-18:F' | Out-Null

  Write-Host ''
  Write-Host '=================================================' -ForegroundColor Green
  Write-Host '  INSTALLATION COMPLETE' -ForegroundColor Green
  Write-Host "  Open on this server:  http://localhost:$appPort" -ForegroundColor Green
  foreach ($l in $lanLinks) { Write-Host "  From other computers: $l" -ForegroundColor Green }
  Write-Host '  Login details: LOGIN-INFO.txt (opening now)' -ForegroundColor Green
  Write-Host '=================================================' -ForegroundColor Green
  Start-Process notepad.exe -ArgumentList "`"$infoFile`""
  Start-Process "http://localhost:$appPort"
  exit 0
} catch {
  Fail $_.Exception.Message
}
