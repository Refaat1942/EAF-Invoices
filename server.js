const express = require('express');
const path = require('path');
const cors = require('cors');
const cookieParser = require('cookie-parser');

process.on('uncaughtException', (err) => {
  console.error('FATAL:', err);
  process.exit(1);
});

try {
  require('./database/db');
} catch (err) {
  console.error('Database init failed:', err.message);
  process.exit(1);
}

const invoiceRoutes = require('./routes/invoices');
const downloadRoutes = require('./routes/download');

const app = express();
const PORT = process.env.PORT || 17159;
const HOST = process.env.HOST || '0.0.0.0';

app.use(cors());
app.use(cookieParser());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

app.use('/assets', express.static(path.join(__dirname, 'public', 'assets')));
app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    port: PORT,
    time: new Date().toISOString(),
    message: 'نظام فواتير EAF يعمل بنجاح',
  });
});

app.use('/api/invoices', invoiceRoutes);
app.use('/download', downloadRoutes);

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: err.message || 'خطأ في الخادم' });
});

app.listen(PORT, HOST, () => {
  console.log(`
╔══════════════════════════════════════════════════════╗
║     نظام فواتير EAF - مركز الطب الطبيعي والتأهيل     ║
╠══════════════════════════════════════════════════════╣
║  🌐 Local:   http://localhost:${PORT}                   ║
║  🌐 Network: http://0.0.0.0:${PORT}                     ║
║  📊 API:     http://localhost:${PORT}/api/health        ║
╚══════════════════════════════════════════════════════╝
  `);
});

process.on('SIGINT', () => process.exit(0));
process.on('SIGTERM', () => process.exit(0));
