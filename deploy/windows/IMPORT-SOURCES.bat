@echo off
setlocal
title EAF-Invoices - Import data sources
rem Ask for administrator rights if not already elevated.
net session >nul 2>&1
if errorlevel 1 (
  if "%~1"=="" (
    powershell -NoProfile -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
  ) else (
    powershell -NoProfile -Command "Start-Process -FilePath '%~f0' -ArgumentList '\"%~1\"' -Verb RunAs"
  )
  exit /b
)
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0tools\restore.ps1" -DumpFile "%~1" -SourcesOnly
echo.
pause
