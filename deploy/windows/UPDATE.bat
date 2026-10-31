@echo off
setlocal
title EAF-Invoices - Update
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
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0tools\update.ps1" -Source "%~1"
echo.
pause
