# Production setup — EAF Invoices (offline / on-premise Linux)

Guide for deploying EAF Invoices on an offline Linux server with PostgreSQL. **Do not commit real secrets.**

## Required environment variables

| Variable | Required | Description |
|----------|----------|-------------|
| `NODE_ENV` | production | Enables production security checks |
| `PORT` | yes | HTTP port (e.g. `8080`) |
| `HOST` | optional | Default `0.0.0.0` |
| `DATABASE_URL` | yes | `postgresql://user:pass@localhost:5432/eaf_invoices` |
| `SESSION_SECRET` | production | 32+ random characters; no defaults in production |
| `ALLOWED_ORIGINS` | production | Comma-separated browser origins, e.g. `http://192.168.1.10:8080` |
| `ADMIN_PASSWORD` | first setup only | 12+ chars when no users exist (creates `admin`) |
| `APP_SECRET` | recommended | For PDF/Word encryption; change from defaults |
| `BACKUP_DIR` | optional | Default `/var/backups/eaf-invoices` |
| `BACKUP_RETENTION_DAYS` | optional | Default `14` |
| `COOKIE_SECURE` | HTTPS | Set `true` when using HTTPS |
| `TRUST_PROXY` | reverse proxy | Set `true` behind nginx/Apache TLS terminator |

Example `.env` (placeholders only):

```env
NODE_ENV=production
PORT=8080
HOST=0.0.0.0
DATABASE_URL=postgresql://eaf:CHANGE_ME@localhost:5432/eaf_invoices
SESSION_SECRET=REPLACE_WITH_64_CHAR_RANDOM_STRING
ALLOWED_ORIGINS=http://192.168.1.10:8080,http://localhost:8080
APP_SECRET=REPLACE_WITH_RANDOM_STRING
ADMIN_PASSWORD=REPLACE_WITH_STRONG_PASSWORD_ON_FIRST_SETUP_ONLY
BACKUP_DIR=/var/backups/eaf-invoices
```

Generate secrets:

```bash
openssl rand -hex 32
```

## Database configuration

```bash
sudo -u postgres createuser -P eaf
sudo -u postgres createdb -O eaf eaf_invoices
```

Application creates schema on first start via `initDatabase()`.

## Session configuration

- Sessions use `express-session` with `httpOnly` cookies.
- `sameSite=lax` for LAN browser use.
- Set `COOKIE_SECURE=true` when users access via HTTPS.
- Production **fails startup** if `SESSION_SECRET` is missing or weak.

## First admin setup

1. Set `ADMIN_PASSWORD` (12+ characters) in `.env` **before first start** if no users exist.
2. Start application — `seedAdminUser()` creates `admin` once.
3. Log in as `admin` with `ADMIN_PASSWORD`.
4. Change password via user management and create individual accounts.
5. Remove or unset `ADMIN_PASSWORD` from `.env` after setup (optional; not used when users exist).

**Existing deployments:** If users already exist, current admin password is preserved; no silent reset.

## Backup setup (VPS — `/var/www/EAF-Invoices`, PM2 as `root`)

This matches the current production VPS: application at `/var/www/EAF-Invoices`, Node/PM2 running as `root`, backups at `/var/backups/eaf-invoices`.

The backup timer uses the **same user as PM2 (`root`)** so it reads the same `.env`, can run `pg_dump` with the same `DATABASE_URL`, and write to the backup directory without a separate permission migration. A dedicated non-root service account is safer long-term but would require aligning PM2, file ownership, PostgreSQL client auth, and backup directory permissions — not assumed here.

**Prerequisites:** `postgresql-client` (`pg_dump`, `pg_restore`) installed:

```bash
sudo apt-get install -y postgresql-client
which pg_dump pg_restore
```

**1. Create backup directory**

```bash
sudo mkdir -p /var/backups/eaf-invoices
sudo chown root:root /var/backups/eaf-invoices
sudo chmod 700 /var/backups/eaf-invoices
```

**2. Confirm production `.env`**

```bash
test -f /var/www/EAF-Invoices/.env && echo "ok"
grep -E '^DATABASE_URL=|^BACKUP_DIR=' /var/www/EAF-Invoices/.env
```

Ensure `BACKUP_DIR=/var/backups/eaf-invoices` (or rely on the default).

**3. Install systemd backup service and timer**

```bash
cd /var/www/EAF-Invoices
sudo cp deploy/linux/eaf-invoices-backup.service /etc/systemd/system/
sudo cp deploy/linux/eaf-invoices-backup.timer /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now eaf-invoices-backup.timer
sudo systemctl status eaf-invoices-backup.timer
```

Installed unit values (no edit needed on this VPS):

| Setting | Value |
|---------|--------|
| `User` | `root` |
| `Group` | `root` |
| `WorkingDirectory` | `/var/www/EAF-Invoices` |
| `EnvironmentFile` | `/var/www/EAF-Invoices/.env` |
| `ExecStart` | `/usr/bin/node /var/www/EAF-Invoices/scripts/run-backup.js` |

**4. Verify timer and run a test backup**

```bash
systemctl list-timers eaf-invoices-backup.timer
sudo systemctl start eaf-invoices-backup.service
sudo systemctl status eaf-invoices-backup.service
ls -lh /var/backups/eaf-invoices/
pg_restore --list /var/backups/eaf-invoices/eaf-invoices_*.dump | head
```

**5. Manual backup (CLI)**

```bash
cd /var/www/EAF-Invoices
node --env-file=.env scripts/run-backup.js --manual
```

Or via **الإعدادات** → **النسخ الاحتياطي** (administrator).

Full restore procedure: [BACKUP-RESTORE.md](./BACKUP-RESTORE.md).

## Application runtime (this VPS)

The application runs under **PM2 as `root`**, not systemd:

```bash
cd /var/www/EAF-Invoices
pm2 list
pm2 logs
```

## Directory permissions (this VPS)

| Path | Owner | Mode |
|------|-------|------|
| `/var/www/EAF-Invoices` | `root:root` | `755` (as deployed) |
| `/var/www/EAF-Invoices/.env` | `root:root` | `600` |
| `/var/backups/eaf-invoices` | `root:root` | `700` |
| `/var/www/EAF-Invoices/public/assets` | `root:root` | `755` |

## Security configuration

- CORS: explicit `ALLOWED_ORIGINS` in production.
- Login rate limiting: 20 attempts / 15 minutes per IP.
- Invalid login: generic message (no username enumeration).
- Security headers: `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`, optional HSTS.
- API errors in production: safe messages only; details logged server-side.
- Sensitive actions require server-side permissions (not UI-only).

## Health check verification

```bash
curl -s http://localhost:8080/api/health | jq
```

Expected:

```json
{
  "status": "ok",
  "db": "connected",
  "backup": { "last_status": "success", ... }
}
```

No secrets or full `DATABASE_URL` in response.

## Deployment checklist

See [DEPLOYMENT.md](./DEPLOYMENT.md) for the recommended update flow.

## Deployment smoke tests

```bash
node scripts/test-production-hardening.js
node --env-file=.env scripts/test-invoice-returns.js   # if DB available
```

## Troubleshooting

| Symptom | Check |
|---------|-------|
| Startup fails on SESSION_SECRET | Set 32+ char secret |
| CORS errors in browser | Add exact origin to `ALLOWED_ORIGINS` |
| Login works on server but not LAN | Use server IP in `ALLOWED_ORIGINS` |
| Backup fails | `pg_dump` in PATH, `BACKUP_DIR` writable |
