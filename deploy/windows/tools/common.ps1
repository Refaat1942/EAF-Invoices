# Shared paths and helpers for the EAF-Invoices offline Windows package.
# Windows PowerShell 5.1 compatible (no ternary / null-coalescing operators).

$Root       = Split-Path $PSScriptRoot -Parent
$AppDir     = Join-Path $Root 'app'
$NodeDir    = Join-Path $Root 'runtime\node'
$NodeExe    = Join-Path $NodeDir 'node.exe'
$PgBin      = Join-Path $Root 'runtime\pgsql\bin'
$DataDir    = Join-Path $Root 'data'
$PgData     = Join-Path $DataDir 'pgdata'
$ConfigFile = Join-Path $DataDir 'install.json'
$StopFlag   = Join-Path $DataDir 'STOP'
$LogsDir    = Join-Path $Root 'logs'
$BackupsDir = Join-Path $Root 'backups'
$EnvFile    = Join-Path $AppDir '.env'
$ExtraFile  = Join-Path $Root 'EXTRA-ADDRESSES.txt'

$PgService  = 'EAF-PostgreSQL'
$AppTask    = 'EAF-Invoices'
$BackupTask = 'EAF-Backup'
$FwRule     = 'EAF-Invoices'
$DbName     = 'eaf_invoices'
$DbUser     = 'eaf'

function Write-Step([string]$Text) { Write-Host ''; Write-Host "==> $Text" -ForegroundColor Cyan }
function Write-Ok([string]$Text)   { Write-Host "    OK  $Text" -ForegroundColor Green }
function Write-Warn2([string]$Text) { Write-Host "    !!  $Text" -ForegroundColor Yellow }

function Test-IsAdmin {
  $id = [Security.Principal.WindowsIdentity]::GetCurrent()
  return (New-Object Security.Principal.WindowsPrincipal($id)).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

function New-HexSecret([int]$Bytes = 32) {
  $b = New-Object byte[] $Bytes
  [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($b)
  return (-join ($b | ForEach-Object { $_.ToString('x2') }))
}

function New-AdminPassword {
  $chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789'
  $b = New-Object byte[] 12
  [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($b)
  return 'Eaf-' + (-join ($b | ForEach-Object { $chars[$_ % $chars.Length] }))
}

function Write-Utf8NoBom([string]$Path, [string]$Text) {
  [IO.File]::WriteAllText($Path, $Text, (New-Object Text.UTF8Encoding($false)))
}

function Write-Utf8Bom([string]$Path, [string]$Text) {
  [IO.File]::WriteAllText($Path, $Text, (New-Object Text.UTF8Encoding($true)))
}

function Read-InstallConfig {
  if (Test-Path $ConfigFile) { return (Get-Content -Raw -Path $ConfigFile | ConvertFrom-Json) }
  return $null
}

function Save-InstallConfig($Config) {
  Write-Utf8NoBom $ConfigFile ($Config | ConvertTo-Json)
}

function Test-PortFree([int]$Port) {
  try {
    $l = New-Object Net.Sockets.TcpListener([Net.IPAddress]::Any, $Port)
    $l.Start(); $l.Stop()
    return $true
  } catch { return $false }
}

function Find-FreePort([int[]]$Candidates) {
  foreach ($p in $Candidates) { if (Test-PortFree $p) { return $p } }
  throw "No free port among: $($Candidates -join ', ')"
}

# IPv4 addresses of this machine's active network adapters (no loopback / link-local).
# Uses .NET so it works the same on every Windows version.
function Get-ServerIPv4 {
  $list = New-Object System.Collections.Generic.List[string]
  $preferred = New-Object System.Collections.Generic.List[string]
  foreach ($nic in [Net.NetworkInformation.NetworkInterface]::GetAllNetworkInterfaces()) {
    if ($nic.OperationalStatus -ne 'Up') { continue }
    if ($nic.NetworkInterfaceType -eq 'Loopback') { continue }
    $props = $nic.GetIPProperties()
    $hasGateway = @($props.GatewayAddresses | Where-Object { $_.Address.AddressFamily -eq 'InterNetwork' -and $_.Address.ToString() -ne '0.0.0.0' }).Count -gt 0
    foreach ($ua in $props.UnicastAddresses) {
      if ($ua.Address.AddressFamily -ne 'InterNetwork') { continue }
      $ip = $ua.Address.ToString()
      if ($ip.StartsWith('127.') -or $ip.StartsWith('169.254.')) { continue }
      if ($hasGateway) { $preferred.Add($ip) } else { $list.Add($ip) }
    }
  }
  return @($preferred) + @($list) | Select-Object -Unique
}

# Every address users may type in the browser: all server IPs, localhost, the computer
# name, plus anything listed in EXTRA-ADDRESSES.txt (one per line).
function Get-AllowedOrigins([int]$Port) {
  $origins = New-Object System.Collections.Generic.List[string]
  foreach ($ip in (Get-ServerIPv4)) { $origins.Add("http://${ip}:$Port") }
  $origins.Add("http://localhost:$Port")
  $origins.Add("http://127.0.0.1:$Port")
  if ($env:COMPUTERNAME) { $origins.Add(("http://" + $env:COMPUTERNAME.ToLower() + ":$Port")) }
  if (Test-Path $ExtraFile) {
    foreach ($raw in (Get-Content -Path $ExtraFile -Encoding UTF8)) {
      $line = $raw.Trim()
      if (-not $line -or $line.StartsWith('#')) { continue }
      $line = $line.TrimEnd('/')
      if ($line -match '^https?://') {
        $origins.Add($line.ToLower())
      } elseif ($line -match ':\d+$') {
        $origins.Add(('http://' + $line).ToLower())
      } else {
        $origins.Add(("http://${line}:$Port").ToLower())
      }
    }
  }
  return @($origins | Select-Object -Unique)
}

function Set-EnvValue([string]$Text, [string]$Key, [string]$Value) {
  $line = "$Key=$Value"
  $pattern = '(?m)^' + [regex]::Escape($Key) + '=[^\r\n]*'
  if ([regex]::IsMatch($Text, $pattern)) { return [regex]::Replace($Text, $pattern, { param($m) $line }) }
  if ($Text -and -not $Text.EndsWith("`n")) { $Text += "`r`n" }
  return $Text + $line + "`r`n"
}

# Refresh ALLOWED_ORIGINS / PUBLIC_APP_URL in app\.env (run at every start, so a changed IP
# or a new line in EXTRA-ADDRESSES.txt only needs a restart).
function Update-AllowedOrigins([int]$Port) {
  if (-not (Test-Path $EnvFile)) { return $null }
  $origins = @(Get-AllowedOrigins $Port)
  $text = [IO.File]::ReadAllText($EnvFile)
  $text = Set-EnvValue $text 'ALLOWED_ORIGINS' ($origins -join ',')
  $text = Set-EnvValue $text 'PUBLIC_APP_URL' $origins[0]
  Write-Utf8NoBom $EnvFile $text
  return $origins
}

function Set-RuntimePath {
  $env:Path = "$PgBin;$NodeDir;" + $env:Path
}

function Wait-Postgres([int]$Port, [int]$Seconds = 90) {
  $deadline = (Get-Date).AddSeconds($Seconds)
  while ((Get-Date) -lt $deadline) {
    & (Join-Path $PgBin 'pg_isready.exe') -h localhost -p $Port -q 2>$null
    if ($LASTEXITCODE -eq 0) { return $true }
    Start-Sleep -Seconds 2
  }
  return $false
}

function Wait-AppHttp([int]$Port, [int]$Seconds = 120) {
  $deadline = (Get-Date).AddSeconds($Seconds)
  while ((Get-Date) -lt $deadline) {
    try {
      $r = Invoke-WebRequest -UseBasicParsing -TimeoutSec 5 -Uri "http://localhost:$Port/"
      if ($r.StatusCode -eq 200) { return $true }
    } catch { }
    Start-Sleep -Seconds 3
  }
  return $false
}

function Stop-EafApp {
  New-Item -ItemType File -Force -Path $StopFlag | Out-Null
  try { Stop-ScheduledTask -TaskName $AppTask -ErrorAction SilentlyContinue } catch { }
  # WMI gives the executable path even for processes owned by SYSTEM.
  Get-CimInstance Win32_Process -Filter "Name='node.exe'" -ErrorAction SilentlyContinue |
    Where-Object { $_.ExecutablePath -and $_.ExecutablePath.StartsWith($NodeDir, [StringComparison]::OrdinalIgnoreCase) } |
    ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
}

# Run node.exe from app\ and wait; output goes to logs\<Name>.log and logs\<Name>-errors.log
# (previous run kept as <Name>.prev.log).
function Invoke-NodeLogged([string[]]$NodeArgs, [string]$Name) {
  New-Item -ItemType Directory -Force -Path $LogsDir | Out-Null
  $out = Join-Path $LogsDir "$Name.log"
  $err = Join-Path $LogsDir "$Name-errors.log"
  foreach ($f in @($out, $err)) {
    if (Test-Path $f) { Move-Item -Force $f ($f -replace '\.log$', '.prev.log') }
  }
  $p = Start-Process -FilePath $NodeExe -ArgumentList $NodeArgs -WorkingDirectory $AppDir `
    -RedirectStandardOutput $out -RedirectStandardError $err -NoNewWindow -Wait -PassThru
  return $p.ExitCode
}

function Start-EafApp {
  if (Test-Path $StopFlag) { Remove-Item -Force $StopFlag }
  Start-ScheduledTask -TaskName $AppTask
}

function Invoke-Psql([int]$Port, [string]$SuperPassword, [string]$Database, [string]$Sql) {
  # Windows PowerShell 5.1 turns any stderr text (e.g. NOTICE) into a terminating error under 'Stop'.
  $ErrorActionPreference = 'Continue'
  $env:PGPASSWORD = $SuperPassword
  try {
    $out = & (Join-Path $PgBin 'psql.exe') -h localhost -p $Port -U postgres -d $Database -v ON_ERROR_STOP=1 -tAc $Sql 2>&1
    if ($LASTEXITCODE -ne 0) { throw "psql failed: $out" }
    return $out
  } finally { Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue }
}
