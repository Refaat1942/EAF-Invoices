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

## Backup setup

See [BACKUP-RESTORE.md](./BACKUP-RESTORE.md).

```bash
sudo mkdir -p /var/backups/eaf-invoices
sudo chown eaf:eaf /var/backups/eaf-invoices
sudo chmod 700 /var/backups/eaf-invoices

sudo cp deploy/linux/eaf-invoices-backup.service /etc/systemd/system/
sudo cp deploy/linux/eaf-invoices-backup.timer /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now eaf-invoices-backup.timer
```

Manual backup:

```bash
node --env-file=.env scripts/run-backup.js --manual
```

Or via Settings UI (administrator).

## Systemd application service (example)

```ini
[Unit]
Description=EAF Invoices
After=network.target postgresql.service

[Service]
Type=simple
User=eaf
WorkingDirectory=/opt/eaf-invoices
EnvironmentFile=/opt/eaf-invoices/.env
Environment=NODE_ENV=production
ExecStart=/usr/bin/node server.js
Restart=on-failure

[Install]
WantedBy=multi-user.target
```

## Directory permissions

| Path | Owner | Mode |
|------|-------|------|
| `/opt/eaf-invoices` | `eaf:eaf` | `750` |
| `/opt/eaf-invoices/.env` | `eaf:eaf` | `600` |
| `/var/backups/eaf-invoices` | `eaf:eaf` | `700` |
| `public/assets` (logo uploads) | `eaf:eaf` | `755` |

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
