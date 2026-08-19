# نظام فواتير EAF

نظام فواتير احترافي لمركز الطب الطبيعي والتأهيل وعلاج الروماتيزم - القسم المالي.

## المميزات

- فواتير بنفس شكل كشف الحساب الرسمي
- خطوط عربية ثقيلة (Cairo Bold)
- حسابات تلقائية (مصروفات إدارية 12%، إجماليات، متبقي)
- أنواع الفواتير: مدني (خاص)، جهات متعاقدة، جهات غير متعاقدة، عسكري
- رقم تسلسلي فريد لا يتكرر (EAF-2026-000001)
- QR Code للتحميل PDF / Word
- تقارير شاملة
- يعمل على الشبكة المحلية والإنترنت
- قاعدة بيانات SQLite

## التشغيل المحلي

```bash
npm install
npm start
```

يفتح على: http://localhost:17159

## النشر على VPS (Hostinger)

```bash
# 1. SSH إلى السيرفر
ssh root@187.124.15.14

# 2. تثبيت Node.js 20
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt install -y nodejs

# 3. تثبيت PM2
npm install -g pm2

# 4. استنساخ المشروع
cd /var/www
git clone https://github.com/Refaat1942/EAF-Invoices.git
cd EAF-Invoices
npm install

# 5. تشغيل التطبيق
pm2 start ecosystem.config.js
pm2 save
pm2 startup

# 6. فتح البورت 17159
ufw allow 17159
```

الوصول: http://187.124.15.14:17159

## QR Code

عند حفظ الفاتورة يظهر QR Code. عند مسحه يفتح صفحة تحميل الفاتورة PDF أو Word.

## API

- `GET /api/health` - حالة النظام
- `GET /api/invoices` - قائمة الفواتير
- `POST /api/invoices` - إنشاء فاتورة
- `GET /api/invoices/:id/pdf` - تحميل PDF
- `GET /download/:token?format=pdf` - تحميل via QR

## الشعار

ضع ملف الشعار في: `public/assets/logo.png`
