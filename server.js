const express = require('express');
const path = require('path');
const fs = require('fs');
const cors = require('cors');
const cookieParser = require('cookie-parser');

// Load .env if present
const envPath = path.join(__dirname, '.env');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const m = line.match(/^([^#=]+)=(.*)$/);
    if (m && !process.env[m[1].trim()]) process.env[m[1].trim()] = m[2].trim();
  }
}

const { initDatabase } = require('./database/db');

const invoiceRoutes = require('./routes/invoices');
const downloadRoutes = require('./routes/download');
const settingsRoutes = require('./routes/settings');

const app = express();
const PORT = process.env.PORT || 17159;
const HOST = process.env.HOST || '0.0.0.0';

app.use(cors());
app.use(cookieParser());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

app.use('/assets', express.static(path.join(__dirname, 'public', 'assets')));
app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/health', async (req, res) => {
  try {
    const { query } = require('./database/db');
    await query('SELECT 1');
    res.json({
      status: 'ok',
      port: PORT,
      db: 'postgresql',
      time: new Date().toISOString(),
      message: 'نظام فواتير EAF يعمل بنجاح',
    });
  } catch (err) {
    res.status(500).json({ status: 'error', error: err.message });
  }
});

app.use('/api/invoices', invoiceRoutes);
app.use('/api/settings', settingsRoutes);
app.use('/download', downloadRoutes);

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: err.message || 'خطأ في الخادم' });
});

async function start() {
  try {
    await initDatabase();
    app.listen(PORT, HOST, () => {
      console.log(`
╔══════════════════════════════════════════════════════╗
║     نظام فواتير EAF - مركز الطب الطبيعي والتأهيل     ║
╠══════════════════════════════════════════════════════╣
║  🌐 Local:   http://localhost:${PORT}                   ║
║  🌐 Network: http://0.0.0.0:${PORT}                     ║
║  🐘 DB:      PostgreSQL                               ║
╚══════════════════════════════════════════════════════╝
      `);
    });
  } catch (err) {
    console.error('Failed to start:', err.message);
    process.exit(1);
  }
}

start();

process.on('SIGINT', () => process.exit(0));
process.on('SIGTERM', () => process.exit(0));
