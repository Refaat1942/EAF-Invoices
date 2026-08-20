# نظام فواتير A.R.R.C

نظام فواتير لمركز الطب الطبيعي والتأهيل — يعمل **Offline** على الشبكة المحلية مع **PostgreSQL**.

---

## الفكرة باختصار

| الجهاز | الدور |
|--------|--------|
| **جهاز واحد (السيرفر)** | البرنامج + قاعدة البيانات |
| **باقي الأجهزة** | متصفح فقط → `http://IP-السيرفر:17159` |

> عندك **Static IP**؟ استخدمه مباشرة (مثل `192.168.1.50` داخليًا أو `187.124.15.14` خارجيًا).

---

## ① تثبيت مرة واحدة (على جهاز السيرفر)

### 1. Node.js
- حمّل وثبّت من [nodejs.org](https://nodejs.org/) (إصدار 18 أو أحدث)

### 2. PostgreSQL
- حمّل وثبّت من [postgresql.org](https://www.postgresql.org/download/windows/)
- Port: **5432**
- افتح **SQL Shell (psql)** ونفّذ:

```sql
CREATE USER eaf WITH PASSWORD 'eaf2026';
CREATE DATABASE eaf_invoices OWNER eaf;
```

### 3. نسخ البرنامج

```powershell
cd D:\
git clone https://github.com/Refaat1942/EAF-Invoices.git
cd EAF-Invoices
npm install
```

### 4. ملف الإعدادات

```powershell
copy .env.example .env
notepad .env
```

**محتوى `.env` (عدّل IP إن احتجت):**

```env
PORT=17159
HOST=0.0.0.0
DATABASE_URL=postgresql://eaf:eaf2026@localhost:5432/eaf_invoices
APP_SECRET=arr-c-local-secret
SESSION_SECRET=arr-c-session-secret
ADMIN_PASSWORD=غيّر-كلمة-المرور-هنا
```

### 5. فتح المنفذ (Windows — مرة واحدة)

```powershell
New-NetFirewallRule -DisplayName "A.R.R.C Invoices" -Direction Inbound -Protocol TCP -LocalPort 17159 -Action Allow
```

---

## ② التشغيل

### تشغيل عادي

```powershell
cd D:\EAF-Invoices
npm start
```

### تشغيل دائم (موصى به)

```powershell
npm install -g pm2 pm2-windows-startup
cd D:\EAF-Invoices
pm2 start ecosystem.config.js
pm2 save
pm2-startup install
```

---

## ③ الدخول من أي جهاز

| من | العنوان |
|----|---------|
| نفس جهاز السيرفر | `http://localhost:17159` |
| شبكة محلية (Static IP داخلي) | `http://192.168.x.x:17159` |
| Static IP خارجي (VPS/راوتر) | `http://187.124.15.14:17159` |

**أول دخول:** `admin` + كلمة المرور من `.env`

---

## ④ استيراد لائحة الأسعار (DOCX)

**من الواجهة:** الإعدادات → إدارة الأسعار → استيراد DOCX (حد أقصى 100 MB)

**من السيرفر (للملفات الكبيرة):**

```bash
node scripts/import-price-list.js "/path/to/price-list.docx"
pm2 restart eaf-invoices
```

---

## ⑤ تحديث البرنامج

```powershell
cd D:\EAF-Invoices
git pull
npm install
pm2 restart eaf-invoices
```

---

## checklist سريع

- [ ] PostgreSQL شغال (services.msc)
- [ ] `npm start` بدون أخطاء
- [ ] `http://localhost:17159/api/health` يرجع `"status":"ok"`
- [ ] الأجهزة الأخرى تفتح `http://IP-الثابت:17159`
- [ ] تم تغيير كلمة مرور admin
- [ ] تم رفع الشعار + استيراد اللائحة

---

## VPS (Linux)

```bash
git clone https://github.com/Refaat1942/EAF-Invoices.git
cd EAF-Invoices
chmod +x deploy.sh
./deploy.sh
```

---

## استكشاف الأخطاء

| المشكلة | الحل |
|---------|------|
| لا يفتح من أجهزة أخرى | تأكد `HOST=0.0.0.0` + Firewall port 17159 |
| `password authentication failed` | راجع `DATABASE_URL` في `.env` |
| `File too large` عند استيراد DOCX | استخدم `npm run import-prices` على السيرفر |
| PM2 يعيد التشغيل كثيرًا | `pm2 logs eaf-invoices` |
