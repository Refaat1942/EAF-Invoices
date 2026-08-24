# Production deployment and update flow

Recommended procedure for updating EAF Invoices on an offline production server. **Never auto-restore or overwrite production without administrator approval.**

## Pre-deployment

1. **Verify current health**

   ```bash
   curl -s http://localhost:8080/api/health
   ```

2. **Create a verified database backup**

   ```bash
   cd /opt/eaf-invoices
   node --env-file=.env scripts/run-backup.js --manual
   ```

   Confirm success in Settings → Backup or:

   ```bash
   ls -lh /var/backups/eaf-invoices/
   pg_restore --list /var/backups/eaf-invoices/eaf-invoices_*.dump | head
   ```

## Deploy / update application

3. **Stop the application** (optional but safer for file updates)

   ```bash
   sudo systemctl stop eaf-invoices
   ```

4. **Deploy new code** (git pull, rsync, etc.) to `/opt/eaf-invoices`

5. **Install dependencies** if `package.json` changed

   ```bash
   npm ci --omit=dev
   ```

6. **Review `.env`** — do not overwrite production secrets with template values

## Post-deployment

7. **Start / restart application**

   ```bash
   sudo systemctl start eaf-invoices
   ```

8. **Verify health endpoint**

   ```bash
   curl -s http://localhost:8080/api/health
   ```

9. **Verify database connectivity** (included in health `db: connected`)

10. **Verify backup status** in Settings or health `backup` summary

11. **Run targeted smoke tests**

    ```bash
    node scripts/test-production-hardening.js
    ```

    With database:

    ```bash
    node --env-file=.env scripts/test-invoice-returns.js
    ```

12. **Functional smoke** (manual): log in, open invoice list, open Settings

## Rollback

If the update fails:

1. Stop application
2. Restore previous application files (or git checkout previous release)
3. If database was migrated incorrectly, restore database from pre-deploy backup — see [BACKUP-RESTORE.md](./BACKUP-RESTORE.md)
4. Start application and re-verify health

**Database rollback** is always manual:

```bash
pg_restore --clean --if-exists --no-owner --dbname=DATABASE_URL \
  /var/backups/eaf-invoices/eaf-invoices_YYYY-MM-DD_HH-mm-ss.dump
```

## What not to do

- Do not run `npm audit fix --force` on production without testing
- Do not commit `.env`, dumps, or production data
- Do not expose backup directory via HTTP
- Do not skip backup before schema-changing updates
