# نظام فواتير A.R.R.C — دليل التثبيت الكامل

نظام فواتير لمركز الطب الطبيعي والتأهيل.  
يعمل **Offline** على شبكة محلية (LAN) مع قاعدة بيانات **PostgreSQL** على جهاز واحد.

---

## المحتويات

1. [كيف يعمل النظام؟](#1-كيف-يعمل-النظام)
2. [المتطلبات](#2-المتطلبات)
3. [تثبيت PostgreSQL (Windows)](#3-تثبيت-postgresql-windows)
4. [إنشاء قاعدة البيانات](#4-إنشاء-قاعدة-البيانات)
5. [تثبيت Node.js](#5-تثبيت-nodejs)
6. [نسخ البرنامج](#6-نسخ-البرنامج)
7. [ملف الإعدادات .env](#7-ملف-الإعدادات-env)
8. [تثبيت الحزم وتشغيل البرنامج](#8-تثبيت-الحزم-وتشغيل-البرنامج)
9. [إعداد Static IP والشبكة](#9-إعداد-static-ip-والشبكة)
10. [فتح المنفذ في جدار الحماية](#10-فتح-المنفذ-في-جدار-الحماية)
11. [الدخول من الأجهزة الأخرى](#11-الدخول-من-الأجهزة-الأخرى)
12. [التشغيل الدائم (PM2)](#12-التشغيل-الدائم-pm2)
13. [الإعداد الأولي بعد الدخول](#13-الإعداد-الأولي-بعد-الدخول)
14. [استيراد لائحة الأسعار DOCX](#14-استيراد-لائحة-الأسعار-docx)
15. [التحديث والنسخ الاحتياطي](#15-التحديث-والنسخ-الاحتياطي)
16. [حل المشاكل](#16-حل-المشاكل)
17. [تثبيت على VPS (Linux)](#17-تثبيت-على-vps-linux)

---

## 1. كيف يعمل النظام؟

```
┌─────────────────────────────────────────────────────────┐
│  جهاز السيرفر (IP ثابت)                                  │
│  ┌──────────────┐    ┌─────────────────────────────┐   │
│  │ PostgreSQL   │◄───│  Node.js (نظام الفواتير)     │   │
│  │ port 5432    │    │  Node.js (PORT من .env)      │   │
│  └──────────────┘    └─────────────────────────────┘   │
└───────────────────────────────┬─────────────────────────┘
                                │ شبكة محلية / Static IP
        ┌───────────────────────┼───────────────────────┐
        │                       │                       │
   ┌────▼────┐            ┌─────▼─────┐          ┌─────▼─────┐
   │ PC محاسبة│            │ PC استقبال │          │ Laptop    │
   │ Chrome   │            │ Edge       │          │ Firefox   │
   └──────────┘            └───────────┘          └───────────┘
```

- **جهاز واحد** يحمل البرنامج + قاعدة البيانات.
- **باقي الأجهزة** تفتح المتصفح فقط — لا تحتاج تثبيت أي شيء.
- **لا يحتاج إنترنت** بعد التثبيت الأول.
- **Static IP** = عنوان ثابت لا يتغير، فتكتب نفس الرابط دائمًا.

---

## 2. المتطلبات

### جهاز السيرفر (الحد الأدنى)

| البند | المطلوب |
|-------|---------|
| نظام التشغيل | Windows 10/11 (64-bit) |
| المعالج | Intel i3 أو أ equivalent |
| الرام | 4 GB (8 GB أفضل) |
| مساحة القرص | 5 GB فارغة |
| الشبكة | Ethernet (كابل) أفضل من Wi‑Fi للسيرفر |

### البرامج المطلوبة

| البرنامج | الإصدار | الرابط |
|----------|---------|--------|
| Node.js | 18 أو أحدث (LTS) | https://nodejs.org |
| PostgreSQL | 14 أو أحدث | https://www.postgresql.org/download/windows/ |
| Git (اختياري) | أي إصدار | https://git-scm.com/download/win |

---

## 3. تثبيت PostgreSQL (Windows)

### الخطوة 3.1 — التحميل
1. افتح: https://www.postgresql.org/download/windows/
2. اضغط **Download the installer**
3. حمّل **PostgreSQL 16** (أو 14+) — Windows x86-64

### الخطوة 3.2 — التثبيت
1. شغّل المثبت **كمسؤول** (Run as Administrator)
2. **Installation Directory:** اترك الافتراضي `C:\Program Files\PostgreSQL\16`
3. **Select Components:** ✅ PostgreSQL Server + ✅ pgAdmin 4 + ✅ Command Line Tools
4. **Data Directory:** اترك الافتراضي
5. **Password:** اكتب كلمة مرور لـ **postgres** (مثل `Postgres@2026`) — **احفظها**
6. **Port:** `5432` — **لا تغيّره**
7. **Locale:** Default
8. اضغط Next حتى Finish
9. ✅ **Uncheck** Stack Builder عند النهاية (غير مطلوب)

### الخطوة 3.3 — التحقق
1. اضغط `Win + R` → اكتب `services.msc` → Enter
2. ابحث عن **postgresql-x64-16**
3. تأكد أن **Status = Running** و **Startup type = Automatic**

---

## 4. إنشاء قاعدة البيانات

### الطريقة أ — SQL Shell (psql)

1. من قائمة Start ابحث عن **SQL Shell (psql)** → Enter
2. اضغط Enter على كل سؤال (Server, Database, Port, Username) حتى Password
3. أدخل كلمة مرور **postgres** التي اخترتها
4. نفّذ الأوامر التالية **سطرًا سطرًا**:

```sql
CREATE USER eaf WITH PASSWORD 'eaf2026';
CREATE DATABASE eaf_invoices OWNER eaf;
GRANT ALL PRIVILEGES ON DATABASE eaf_invoices TO eaf;
\c eaf_invoices
GRANT ALL ON SCHEMA public TO eaf;
\q
```

### الطريقة ب — pgAdmin

1. افتح **pgAdmin 4** من قائمة Start
2. Connect على **PostgreSQL 16** → أدخل كلمة مرور postgres
3. كليك يمين على **Login/Group Roles** → Create → Login/Group Role
   - Name: `eaf`
   - Definition → Password: `eaf2026`
   - Save
4. كليك يمين على **Databases** → Create → Database
   - Name: `eaf_invoices`
   - Owner: `eaf`
   - Save

### التحقق

```powershell
psql -U eaf -d eaf_invoices -h localhost -c "SELECT 1;"
```
- إذا طلب كلمة مرور → أدخل `eaf2026`
- يجب أن يظهر:
```
 ?column?
----------
        1
```

---

## 5. تثبيت Node.js

1. افتح: https://nodejs.org
2. حمّل **LTS** (مثل 20.x)
3. شغّل المثبت → Next → ✅ **Automatically install necessary tools** (اختياري)
4. Finish

### التحقق — افتح PowerShell:

```powershell
node -v
# النتيجة المتوقعة: v20.x.x

npm -v
# النتيجة المتوقعة: 10.x.x
```

---

## 6. نسخ البرنامج

### إذا عندك Git وإنترنت:

```powershell
cd D:\
git clone https://github.com/Refaat1942/EAF-Invoices.git
cd EAF-Invoices
```

### إذا بدون إنترنت (USB):

1. انسخ مجلد `EAF-Invoices` كاملًا إلى `D:\EAF-Invoices`
2. **مهم:** إذا لم يكن `node_modules` موجودًا، لازم `npm install` مرة واحدة بإنترنت
   - أو انسخ `node_modules` جاهزًا من جهاز ثبّت عليه البرنامج

### مسار المشروع النهائي:

```
D:\EAF-Invoices\
├── server.js
├── package.json
├── .env.example
├── database\
├── public\
├── routes\
├── services\
└── ...
```

---

## 7. ملف الإعدادات .env

### الخطوة 7.1 — إنشاء الملف

```powershell
cd D:\EAF-Invoices
copy .env.example .env
notepad .env
```

### الخطوة 7.2 — محتوى الملف (انسخ وعدّل)

```env
# منفذ البرنامج — اختر أي رقم فاضي (80 أو 8080 أو 3000 أو 17159...)
# الرابط النهائي = http://IP-الثابت:PORT
PORT=8080

# 0.0.0.0 = يقبل اتصالات من أي جهاز على الشبكة
# localhost = جهاز السيرفر فقط (لا تستخدمه للشبكة)
HOST=0.0.0.0

# اتصال PostgreSQL — localhost لأن DB على نفس الجهاز
DATABASE_URL=postgresql://eaf:eaf2026@localhost:5432/eaf_invoices

# مفتاح تشفير ملفات PDF/QR — غيّره لقيمة عشوائية
APP_SECRET=arr-c-my-secret-key-2026

# مفتاح الجلسات — غيّره لقيمة مختلفة
SESSION_SECRET=arr-c-session-secret-2026

# كلمة مرور admin الأولى — غيّرها فورًا بعد الدخول
ADMIN_PASSWORD=Admin@2026
```

### شرح كل إعداد

| المتغير | الوظيفة |
|---------|---------|
| `PORT` | **رقم المنفذ الذي تختاره** في `.env` — ليس مربوطًا بالـ IP. مثال: `8080` → `http://192.168.1.50:8080` |
| `HOST` | `0.0.0.0` ضروري للشبكة المحلية |
| `DATABASE_URL` | رابط PostgreSQL — الصيغة: `postgresql://USER:PASS@HOST:PORT/DBNAME` |
| `APP_SECRET` | تشفير ملفات الفاتورة |
| `SESSION_SECRET` | جلسات تسجيل الدخول |
| `ADMIN_PASSWORD` | كلمة مرور المدير عند أول تشغيل |

---

## 8. تثبيت الحزم وتشغيل البرنامج

### الخطوة 8.1 — تثبيت الحزم

```powershell
cd D:\EAF-Invoices
npm install
```

> **ملاحظة:** أول `npm install` قد يأخذ 2–5 دقائق (يحمّل Puppeteer لـ PDF).

### الخطوة 8.2 — التشغيل الأول

```powershell
npm start
```

### الخطوة 8.3 — ماذا يحدث عند أول تشغيل؟

1. يتصل بـ PostgreSQL
2. ينشئ **كل الجداول** تلقائيًا (فواتير، مستخدمين، أسعار، إلخ)
3. ينشئ مستخدم **admin**
4. يحمّل **41 قسم** + **31 خدمة نموذجية** من اللائحة
5. يفتح المنفذ الذي حددته في `PORT` داخل `.env`

> **IP ثابت ≠ منفذ ثابت**  
> - **Static IP** = عنوان جهاز السيرفر (مثل `192.168.1.50` أو `187.124.15.14`)  
> - **PORT** = رقم تختاره أنت في `.env` (80، 8080، 3000، …)  
> - **رابط الدخول:** `http://IP-الثابت:PORT` — إذا `PORT=80` يكفي `http://IP-الثابت`

### الخطوة 8.4 — رسالة النجاح

```
╔══════════════════════════════════════════════════════╗
║     نظام فواتير A.R.R.C - مركز الطب الطبيعي والتأهيل  ║
╠══════════════════════════════════════════════════════╣
║  🌐 Local:   http://localhost:PORT                    ║
║  🌐 Network: http://IP-الثابت:PORT                    ║
║  🐘 DB:      PostgreSQL                               ║
╚══════════════════════════════════════════════════════╝
```

(يظهر رقم `PORT` الفعلي من `.env` في رسالة التشغيل)

### الخطوة 8.5 — اختبار

افتح المتصفح: **http://localhost:PORT** (استبدل PORT بقيمة `.env`)

أو تحقق من API:

```powershell
curl http://localhost:8080/api/health
```

(غيّر `8080` لنفس قيمة `PORT` في `.env`)

النتيجة:
```json
{"status":"ok","db":"postgresql","message":"نظام فواتير A.R.R.C يعمل بنجاح"}
```

---

## 9. إعداد Static IP والشبكة

### 9.1 — معرفة IP جهاز السيرفر

```powershell
ipconfig
```

ابحث عن **Ethernet adapter** (كابل) أو **Wi-Fi**:

```
IPv4 Address. . . . . . . . . . . : 192.168.1.50
Subnet Mask   . . . . . . . . . . : 255.255.255.0
Default Gateway . . . . . . . . . : 192.168.1.1
```

**IP السيرفر = `192.168.1.50`** (مثال)

### 9.2 — Static IP داخلي (شبكة المكتب/المركز)

1. **Settings** → **Network & Internet** → **Ethernet** (أو Wi‑Fi)
2. **Edit** بجانب IP assignment → **Manual**
3. IPv4 → **On**
4. املأ:
   - IP address: `192.168.1.50` (اختر رقم ثابت ضمن نطاق الراوتر)
   - Subnet mask: `255.255.255.0`
   - Gateway: `192.168.1.1` (IP الراوتر)
   - DNS: `8.8.8.8` (أو IP الراوتر)
5. Save

> **نصيحة:** اختر IP خارج نطاق DHCP (مثل .50–.200 ثابت) حتى لا يتعارض مع أجهزة أخرى.

### 9.3 — Static IP خارجي (VPS مثل Hostinger)

- IP ثابت جاهز (مثل `187.124.15.14`)
- **اختر المنفذ في `.env`** — مثال: `PORT=8080`
- **الرابط:** `http://187.124.15.14:8080` (IP ثابت + PORT من `.env`)
- افتح **نفس رقم PORT** في Firewall على VPS:

```bash
# على Linux VPS — استبدل 8080 بقيمة PORT في .env
ufw allow 8080/tcp
```

### 9.4 — Static IP خارجي خلف راوتر (Port Forwarding)

إذا السيرفر داخل شبكة وعندك IP ثابت من ISP:

1. ادخل إعدادات الراوتر (مثل `192.168.1.1`)
2. **Port Forwarding** / **NAT**
3. أضف قاعدة (استبدل `8080` بقيمة `PORT` في `.env`):
   - External Port: `8080`
   - Internal IP: `192.168.1.50` (IP السيرفر الثابت)
   - Internal Port: `8080`
   - Protocol: TCP
4. Save

---

## 10. فتح المنفذ في جدار الحماية

### Windows Firewall (ضروري)

افتح **نفس رقم `PORT`** الموجود في `.env`:

```powershell
# استبدل 8080 بقيمة PORT في ملف .env
New-NetFirewallRule -DisplayName "A.R.R.C Invoices" -Direction Inbound -Protocol TCP -LocalPort 8080 -Action Allow
```

### التحقق

```powershell
Test-NetConnection -ComputerName localhost -Port 8080
```

`TcpTestSucceeded : True` = المنفذ مفتوح ✅

---

## 11. الدخول من الأجهزة الأخرى

**الصيغة العامة:** `http://IP-الثابت:PORT`  
(IP من الشبكة + PORT من `.env`)

### من نفس جهاز السيرفر

```
http://localhost:8080
```

### من أي جهاز على نفس الشبكة (LAN)

```
http://192.168.1.50:8080
```
(استبدل `192.168.1.50` بـ IP السيرفر الثابت، و`8080` بقيمة `PORT`)

### من خارج الشبكة (Static IP / VPS)

```
http://187.124.15.14:8080
```
(Static IP للسيرفر + PORT من `.env`)

### بيانات الدخول الأولى

| الحقل | القيمة |
|-------|--------|
| اسم المستخدم | `admin` |
| كلمة المرور | ما في `.env` → `ADMIN_PASSWORD` (افتراضي `Admin@2026`) |

> **مهم:** غيّر كلمة المرور فورًا من الإعدادات → المستخدمين.

---

## 12. التشغيل الدائم (PM2)

PM2 يشغّل البرنامج في الخلفية ويعيد تشغيله تلقائيًا إذا توقف.

### التثبيت

```powershell
npm install -g pm2
npm install -g pm2-windows-startup
```

### التشغيل

```powershell
cd D:\EAF-Invoices
pm2 start ecosystem.config.js
pm2 save
pm2-startup install
```

### أوامر مفيدة

```powershell
pm2 status                  # حالة البرنامج
pm2 logs eaf-invoices       # سجل الأخطاء
pm2 restart eaf-invoices    # إعادة تشغيل
pm2 stop eaf-invoices       # إيقاف
```

---

## 13. الإعداد الأولي بعد الدخول

### 13.1 — تغيير كلمة مرور admin
1. **الإعدادات** → **المستخدمين**
2. عدّل admin → كلمة مرور جديدة → حفظ

### 13.2 — رفع الشعار
1. **الإعدادات** → **شعار الفاتورة**
2. ارفع PNG/JPG/SVG (حد 3 MB)
3. يظهر على شاشة الدخول والفواتير

### 13.3 — إعداد أنواع الإقامة
1. **الإعدادات** → **أنواع الإقامة**
2. أضف: غرفة فردية، مزدوجة، جناح، VIP، إلخ + سعر اليوم

### 13.4 — الجهات المتعاقدة
1. **الإعدادات** → **الجهات المتعاقدة**
2. أضف اسم الجهة + نسبة الخصم (مثل 15%)

### 13.5 — استيراد اللائحة (الخطوة التالية)

---

## 14. استيراد لائحة الأسعار DOCX

### من الواجهة (ملفات حتى 100 MB)

1. **الإعدادات** → **إدارة الأسعار واللائحة المالية**
2. ✅ فعّل **استبدال الخدمات الموجودة** (للمرة الأولى)
3. **استيراد DOCX/JSON/CSV** → اختر ملف اللائحة
4. انتظر رسالة: `تم استيراد X خدمة في Y قسم`
5. تأكد: العداد يعرض مئات الخدمات (ليس 31 فقط)

### من سطر الأوامر (ملفات كبيرة)

```powershell
cd D:\EAF-Invoices
node scripts/import-price-list.js "C:\path\to\price-list.docx"
pm2 restart eaf-invoices
```

### على VPS (Linux)

```bash
# 1. ارفع الملف بـ WinSCP إلى:
/var/www/EAF-Invoices/data/price-list.docx

# 2. استورد
cd /var/www/EAF-Invoices
node scripts/import-price-list.js "data/price-list.docx"

# 3. أعد التشغيل
pm2 restart eaf-invoices
```

---

## 15. التحديث والنسخ الاحتياطي

### تحديث البرنامج

```powershell
cd D:\EAF-Invoices
git pull
npm install
pm2 restart eaf-invoices
```

### نسخ احتياطي لقاعدة البيانات

```powershell
pg_dump -U eaf -d eaf_invoices -F c -f "D:\Backup\eaf_backup_%date%.dump"
```

### استرجاع النسخة الاحتياطية

```powershell
pg_restore -U eaf -d eaf_invoices -c "D:\Backup\eaf_backup.dump"
```

### نسخ احتياطي للشعار والملفات

```
D:\EAF-Invoices\public\assets\     ← الشعار
D:\EAF-Invoices\.env               ← الإعدادات
```

---

## 16. حل المشاكل

| المشكلة | السبب | الحل |
|---------|-------|------|
| `password authentication failed for user "eaf"` | `.env` أو DB غلط | راجع `DATABASE_URL` + أنشئ المستخدم |
| `ECONNREFUSED 5432` | PostgreSQL متوقف | `services.msc` → شغّل postgresql |
| الموقع لا يفتح من أجهزة أخرى | Firewall أو HOST | `HOST=0.0.0.0` + افتح نفس رقم `PORT` من `.env` |
| `File too large` عند استيراد DOCX | الملف > 100 MB | استخدم `npm run import-prices` |
| PM2 restarts كثيرة | خطأ في الكود/DB | `pm2 logs eaf-invoices --lines 50` |
| Auto-suggest فارغ في البيان | اللائحة لم تُستورد | استورد DOCX + تأكد العداد > 31 |
| PDF لا يُصدّر | Puppeteer | أعد `npm install` وانتظر تحميل Chromium |
| `admin` يظهر في خانة الدخول | حفظ المتصفح | امسحه يدويًا — ليس من البرنامج |

### أوامر تشخيص سريعة

```powershell
# هل PostgreSQL شغال؟
Get-Service postgresql*

# هل البرنامج يرد؟ (غيّر 8080 لقيمة PORT)
curl http://localhost:8080/api/health

# هل المنفذ مفتوح؟
Test-NetConnection localhost -Port 8080

# سجل الأخطاء (PM2)
pm2 logs eaf-invoices --lines 30
```

---

## 17. تثبيت على VPS (Linux)

```bash
# 1. Clone
git clone https://github.com/Refaat1942/EAF-Invoices.git
cd EAF-Invoices

# 2. Deploy script (يثبت Node + PostgreSQL + PM2)
chmod +x deploy.sh
./deploy.sh

# 3. تحديث لاحق
git pull && npm install && pm2 restart eaf-invoices
```

**الوصول:** `http://YOUR_STATIC_IP:PORT` (PORT من ملف `.env`)

---

## ملخص سريع (Checklist)

```
□ PostgreSQL مثبت وشغال
□ قاعدة eaf_invoices + مستخدم eaf
□ Node.js 18+ مثبت
□ المشروع في D:\EAF-Invoices
□ ملف .env معدّل
□ npm install تم
□ npm start أو pm2 start يعمل بدون أخطاء
□ Firewall: منfذ PORT (من .env) مفتوح
□ Static IP معروف ومثبت
□ http://IP:PORT يفتح من أجهزة أخرى
□ تم تغيير كلمة admin
□ تم رفع الشعار
□ تم استيراد لائحة DOCX
```

---

## الدعم

- **GitHub:** https://github.com/Refaat1942/EAF-Invoices
- **Health Check:** `GET /api/health`
- **Setup Script (Windows):** شغّل `setup-windows.bat`
