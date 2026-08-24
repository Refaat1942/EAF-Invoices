# Database backup and restore — EAF Invoices

This document describes how PostgreSQL backups work for the offline/on-premise EAF Invoices deployment.

## Backup location

| Item | Default |
|------|---------|
| Directory | `/var/backups/eaf-invoices` |
| Environment override | `BACKUP_DIR` |
| Filename pattern | `eaf-invoices_YYYY-MM-DD_HH-mm-ss.dump` |
| Format | PostgreSQL custom format (`pg_dump -Fc`) |

Backups are **not** stored under `public/` or any web-served directory.

## Automatic backup

- Runs daily at **03:00 local server time** via **systemd timer** (independent of the browser/UI).
- Uses `pg_dump` with `DATABASE_URL` from the server environment (never hardcoded).
- **Production (`NODE_ENV=production`):** backup **requires** an explicit `DATABASE_URL`. If it is missing, the backup job fails clearly and does **not** use the local development fallback connection string.
- **Local / non-production:** when `DATABASE_URL` is unset, backup may use the same development fallback as the app pool (`postgresql://eaf:eaf2026@localhost:5432/eaf_invoices`) for convenience.
- After each dump:
  1. Verifies the file exists and is non-empty.
  2. Verifies readability with `pg_restore --list`.
  3. Records status, size, and duration in `app_settings`.
- On verification failure: backup is marked failed, invalid file is removed, previous valid backups are kept.
- Retention: keeps backups for **14 days** (`BACKUP_RETENTION_DAYS`); never deletes the newest backup.

### Install systemd timer (Linux VPS)

Production VPS paths: app `/var/www/EAF-Invoices`, PM2 as `root`, backups `/var/backups/eaf-invoices`.

```bash
sudo mkdir -p /var/backups/eaf-invoices
sudo chown root:root /var/backups/eaf-invoices
sudo chmod 700 /var/backups/eaf-invoices

cd /var/www/EAF-Invoices
sudo cp deploy/linux/eaf-invoices-backup.service /etc/systemd/system/
sudo cp deploy/linux/eaf-invoices-backup.timer /etc/systemd/system/

sudo systemctl daemon-reload
sudo systemctl enable --now eaf-invoices-backup.timer
sudo systemctl status eaf-invoices-backup.timer
```

Service unit: `User=root`, `WorkingDirectory=/var/www/EAF-Invoices`, `EnvironmentFile=/var/www/EAF-Invoices/.env`.

### DATABASE_URL and PM2

`server.js` loads `/var/www/EAF-Invoices/.env` at startup (only for keys not already set in the process environment). **PM2 often does not list `DATABASE_URL` in `pm2 env` or `pm2 show`** because it is injected inside Node after `.env` is read, not by PM2 itself. The app pool still connects using `DATABASE_URL` from `.env` when present.

Scheduled backups should receive `DATABASE_URL` via **systemd `EnvironmentFile`**, **`node --env-file=.env`**, or an explicit process environment — not from the hardcoded development fallback. On production VPS, keep `DATABASE_URL` in `.env` and ensure the backup unit references that file.

Verify timer schedule:

```bash
systemctl list-timers eaf-invoices-backup.timer
```

Run backup immediately (manual via CLI):

```bash
cd /var/www/EAF-Invoices
node --env-file=.env scripts/run-backup.js --manual
```

## Manual backup (Settings UI)

Administrators with **إدارة الإعدادات** (`settings.*`) permission:

1. Open **الإعدادات** → **النسخ الاحتياطي لقاعدة البيانات**.
2. Click **نسخ احتياطي الآن**.
3. Review status: timestamp, success/failure, size, file name, verification, directory.

Uses the same `backupService` and verification as the scheduled job.

## List backups

```bash
ls -lh /var/backups/eaf-invoices/eaf-invoices_*.dump
```

## Verify a dump manually

```bash
pg_restore --list /var/backups/eaf-invoices/eaf-invoices_2026-08-24_03-00-00.dump | head
```

Expected: table of contents entries, no errors.

## Restore procedure (manual — administrator only)

**There is no automatic restore in the application.** Restore is always an explicit administrator operation.

### 1. Stop the application

```bash
sudo systemctl stop eaf-invoices   # or pm2 stop eaf-invoices
```

### 2. Restore to a temporary database first (recommended)

```bash
createdb eaf_invoices_verify
pg_restore --clean --if-exists --no-owner --dbname=eaf_invoices_verify \
  /var/backups/eaf-invoices/eaf-invoices_YYYY-MM-DD_HH-mm-ss.dump
```

Connect and spot-check:

```bash
psql eaf_invoices_verify -c "SELECT COUNT(*) FROM invoices;"
psql eaf_invoices_verify -c "SELECT COUNT(*) FROM users;"
```

Drop verify DB when satisfied:

```bash
dropdb eaf_invoices_verify
```

### 3. Replace production database (disaster recovery)

**Warning:** This overwrites production data.

```bash
# Example — adjust database name and connection
pg_restore --clean --if-exists --no-owner --dbname="$DATABASE_URL" \
  /var/backups/eaf-invoices/eaf-invoices_YYYY-MM-DD_HH-mm-ss.dump
```

Or with explicit connection:

```bash
pg_restore --clean --if-exists --no-owner \
  -h localhost -U eaf -d eaf_invoices \
  /var/backups/eaf-invoices/eaf-invoices_YYYY-MM-DD_HH-mm-ss.dump
```

### 4. After restore

1. Start the application.
2. Check health: `curl -s http://localhost:8080/api/health | jq`
3. Log in and verify Settings → backup status.
4. Open a known invoice, catalog item, and daily entry.
5. Run targeted smoke tests if available.

### 5. Data integrity checks

```bash
psql eaf_invoices -c "SELECT status, COUNT(*) FROM invoices GROUP BY status;"
psql eaf_invoices -c "SELECT COUNT(*) FROM invoice_items;"
psql eaf_invoices -c "SELECT COUNT(*) FROM daily_entry_catalog;"
```

Compare counts with expectations before the incident.

## Security notes

- `DATABASE_URL`, passwords, and session secrets are never logged.
- Backup directory must not be web-accessible.
- Restrict filesystem permissions: `chmod 700 /var/backups/eaf-invoices` (owner only).

## Troubleshooting

| Issue | Action |
|-------|--------|
| `pg_dump not found` | Install PostgreSQL client tools (`postgresql-client`) |
| Permission denied on backup dir | `chown`/`chmod` for service user |
| Backup already in progress | Wait or remove stale `.backup.lock` only if no backup is running |
| Verification failed | Check disk space; inspect `pg_restore --list` output manually |
