# نظام فواتير EAF

نظام فواتير احترافي لمركز الطب الطبيعي والتأهيل - PostgreSQL

## المميزات

- فواتير بنفس شكل كشف الحساب الرسمي
- **PostgreSQL** قاعدة بيانات
- **أنواع الإقامة** — إضافة/حذف من الإعدادات
- **رفع شعار** الفاتورة (PNG/JPG/SVG)
- QR Code + كلمة مرور للملف
- تقارير شاملة

## المتطلبات

- Node.js 18+
- PostgreSQL 14+ (port **5432**)

## الإعداد

```bash
cp .env.example .env
# عدّل DATABASE_URL

# إنشاء قاعدة البيانات
psql -U postgres -c "CREATE USER eaf WITH PASSWORD 'eaf2026';"
psql -U postgres -c "CREATE DATABASE eaf_invoices OWNER eaf;"

npm install
npm start
```

## الإعدادات

من تبويب **الإعدادات**:
1. **شعار الفاتورة** — ارفع صورة الشعار
2. **أنواع الإقامة** — أضف: غرفة مفردة، مزدوجة، عناية مركزة، إلخ

## كلمة مرور QR

رقم الفاتورة **بدون شرطات**: `EAF-2026-000001` → `EAF2026000001`

## VPS

```bash
git clone https://github.com/Refaat1942/EAF-Invoices.git
cd EAF-Invoices
chmod +x deploy.sh
./deploy.sh
```

## API

- `GET /api/settings` — الإعدادات والشعار
- `POST /api/settings/logo` — رفع الشعار
- `GET /api/settings/stay-types` — أنواع الإقامة
- `POST /api/settings/stay-types` — إضافة نوع
