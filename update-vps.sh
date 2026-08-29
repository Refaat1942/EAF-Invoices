#!/bin/bash
# Pull latest code, install deps, restart app, run post-deploy checks.
# Usage on VPS: cd /var/www/EAF-Invoices && bash update-vps.sh

set -e

cd "$(dirname "$0")"

echo "=== EAF Invoices — update ==="

if git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  git pull origin main
else
  echo "WARN: not a git repo — skipping pull"
fi

if [ -f .env ]; then
  set -a
  # shellcheck disable=SC1091
  source .env
  set +a
fi

npm install

if command -v pm2 >/dev/null 2>&1; then
  pm2 delete eaf-invoices 2>/dev/null || true
  pm2 start ecosystem.config.js
  pm2 save
else
  echo "WARN: pm2 not found — start server manually: npm start"
fi

echo ""
echo "Running post-deploy readiness check..."
if node scripts/verify-vps-daily-readiness.js; then
  echo ""
  echo "✅ Update complete. If categories were empty, re-import DOCX from Settings."
else
  echo ""
  echo "⚠️  Readiness check failed — re-import price list DOCX from Settings, then rerun:"
  echo "   node scripts/verify-vps-daily-readiness.js"
  echo "   (App may still be running — check: curl http://127.0.0.1:\${PORT:-17159}/api/health)"
  exit 1
fi
