const express = require('express');
const session = require('express-session');
const path = require('path');
const fs = require('fs');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const { loadProjectEnv } = require('./database/loadEnv');

loadProjectEnv(__dirname);

const {
  validateProductionConfig,
  buildCorsOptions,
  securityHeaders,
  errorHandler,
} = require('./middleware/security');
const { isProduction } = require('./services/backupService');

validateProductionConfig();

const { initDatabase } = require('./database/db');

const authRoutes = require('./routes/auth');
const userRoutes = require('./routes/users');
const invoiceRoutes = require('./routes/invoices');
const patientRoutes = require('./routes/patients');
const downloadRoutes = require('./routes/download');
const settingsRoutes = require('./routes/settings');

const app = express();
const PORT = process.env.PORT || 17159;
const HOST = process.env.HOST || '0.0.0.0';
const pkg = require('./package.json');
const { CENTER_NAME, APP_SHORT_NAME } = require('./config/branding');

if (process.env.TRUST_PROXY === 'true') {
  app.set('trust proxy', 1);
}

app.use(cors(buildCorsOptions()));
app.use(securityHeaders);
app.use(cookieParser());
app.use(require('./middleware/requestLog').requestLogMiddleware);

const cookieSecure =
  process.env.COOKIE_SECURE === 'true' || process.env.HTTPS === 'true';

app.use(
  session({
    secret: process.env.SESSION_SECRET || process.env.APP_SECRET || 'eaf-session-secret',
    resave: false,
    saveUninitialized: false,
    cookie: {
      maxAge: 8 * 60 * 60 * 1000,
      httpOnly: true,
      sameSite: 'lax',
      secure: cookieSecure,
    },
  })
);
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

app.use('/assets', express.static(path.join(__dirname, 'public', 'assets')));
app.use(
  express.static(path.join(__dirname, 'public'), {
    setHeaders(res, filePath) {
      if (filePath.endsWith('index.html')) {
        res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
      } else if (/\.(js|css)$/.test(filePath)) {
        res.setHeader('Cache-Control', 'public, max-age=0, must-revalidate');
      }
    },
  })
);

app.get('/api/public/branding', async (req, res) => {
  try {
    const { getLogoUrl } = require('./services/settingsService');
    const baseUrl = `${req.protocol}://${req.get('host')}`;
    res.json({
      app_name: APP_SHORT_NAME,
      center_name: CENTER_NAME,
      logo_url: await getLogoUrl(baseUrl),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/health', async (req, res) => {
  try {
    const { query } = require('./database/db');
    await query('SELECT 1');
    let backupSummary = null;
    try {
      const { getBackupStatus } = require('./services/backupService');
      const backup = await getBackupStatus();
      backupSummary = {
        last_status: backup.last_status || 'unknown',
        last_success_at: backup.last_success_at || null,
        retained_count: backup.retained_count,
      };
    } catch {
      backupSummary = { last_status: 'unknown' };
    }
    res.json({
      status: 'ok',
      app: pkg.name,
      version: pkg.version,
      ui_build: '20260904b',
      environment: isProduction() ? 'production' : process.env.NODE_ENV || 'development',
      db: 'connected',
      time: new Date().toISOString(),
      backup: backupSummary,
    });
  } catch (err) {
    console.error('[health] database check failed:', err.message);
    res.status(500).json({
      status: 'error',
      db: 'disconnected',
      time: new Date().toISOString(),
      error: 'Database connection failed',
    });
  }
});

app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/invoices', invoiceRoutes);
app.use('/api/patients', patientRoutes);
app.use('/api/daily-charges', require('./routes/dailyCharges'));
app.use('/api/doctors', require('./routes/doctors'));
app.use('/api/pricing', require('./routes/pricing'));
app.use('/api/settings', settingsRoutes);
app.use('/download', downloadRoutes);

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.use(errorHandler);

async function start() {
  try {
    await initDatabase();
    const server = app.listen(PORT, HOST, () => {
      console.log(`
╔══════════════════════════════════════════════════════╗
║     ${APP_SHORT_NAME} — ${CENTER_NAME}  ║
╠══════════════════════════════════════════════════════╣
║  🌐 Local:   http://localhost:${PORT}                   ║
║  🌐 Network: http://0.0.0.0:${PORT}                     ║
║  🐘 DB:      PostgreSQL                               ║
╚══════════════════════════════════════════════════════╝
      `);
      console.log(`[startup] ${pkg.name} v${pkg.version} listening on ${HOST}:${PORT}`);
    });
    server.timeout = 15 * 60 * 1000;
    server.keepAliveTimeout = 15 * 60 * 1000 + 5000;
    server.headersTimeout = 15 * 60 * 1000 + 10000;
  } catch (err) {
    console.error('Failed to start:', err.message);
    process.exit(1);
  }
}

start();

process.on('SIGINT', () => {
  console.log('[shutdown] SIGINT received');
  process.exit(0);
});
process.on('SIGTERM', () => {
  console.log('[shutdown] SIGTERM received');
  process.exit(0);
});
