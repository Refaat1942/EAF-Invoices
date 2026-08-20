@echo off
chcp 65001 >nul
title A.R.R.C Invoices - Setup
echo.
echo ========================================
echo   نظام فواتير A.R.R.C - إعداد سريع
echo ========================================
echo.

where node >nul 2>&1
if errorlevel 1 (
  echo [X] Node.js غير مثبت — حمّله من https://nodejs.org
  pause
  exit /b 1
)
echo [OK] Node.js: 
node -v

where psql >nul 2>&1
if errorlevel 1 (
  echo [!] psql غير موجود في PATH — تأكد من تثبيت PostgreSQL
) else (
  echo [OK] PostgreSQL psql موجود
)

if not exist .env (
  copy .env.example .env >nul
  echo [OK] تم إنشاء ملف .env — عدّله قبل التشغيل
) else (
  echo [OK] ملف .env موجود
)

echo.
echo [*] تثبيت الحزم...
call npm install
if errorlevel 1 (
  echo [X] فشل npm install
  pause
  exit /b 1
)

echo.
echo ========================================
echo   الإعداد اكتمل
echo ========================================
echo.
echo 1. عدّل ملف .env
echo 2. أنشئ قاعدة البيانات في PostgreSQL:
echo    CREATE USER eaf WITH PASSWORD 'eaf2026';
echo    CREATE DATABASE eaf_invoices OWNER eaf;
echo 3. افتح المنفذ 17159 في Firewall
echo 4. شغّل: npm start
echo.
echo    من نفس الجهاز:  http://localhost:17159
echo    من الشبكة:      http://IP-الثابت:17159
echo.
set /p RUN="هل تريد التشغيل الآن؟ (y/n): "
if /i "%RUN%"=="y" (
  npm start
)
pause
