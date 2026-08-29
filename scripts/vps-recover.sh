#!/bin/bash
# Quick recovery when the site shows ERR_CONNECTION_TIMED_OUT.
# Run on VPS: cd /var/www/EAF-Invoices && bash scripts/vps-recover.sh

set -e
cd "$(dirname "$0")/.."

echo "=== EAF Invoices — recover ==="

if [ -f .env ]; then
  set -a
  # shellcheck disable=SC1091
  source .env
  set +a
fi

APP_PORT="${PORT:-17159}"

echo ""
echo "1) PostgreSQL"
if systemctl is-active --quiet postgresql 2>/dev/null; then
  echo "   OK postgresql running"
else
  echo "   starting postgresql..."
  systemctl start postgresql 2>/dev/null || service postgresql start 2>/dev/null || true
fi

echo ""
echo "2) PM2 status"
if ! command -v pm2 >/dev/null 2>&1; then
  echo "   FAIL: pm2 not installed — run: npm install -g pm2"
  exit 1
fi
pm2 list

echo ""
echo "3) Restart app (reload .env PORT — not just pm2 restart)"
pm2 delete eaf-invoices 2>/dev/null || true
pm2 start ecosystem.config.js
pm2 save

sleep 3

echo ""
echo "4) Listen check on port ${APP_PORT}"
if command -v ss >/dev/null 2>&1; then
  ss -tlnp | grep ":${APP_PORT}" || echo "   WARN: nothing listening on ${APP_PORT}"
elif command -v netstat >/dev/null 2>&1; then
  netstat -tlnp 2>/dev/null | grep ":${APP_PORT}" || echo "   WARN: nothing listening on ${APP_PORT}"
fi

echo ""
echo "5) Local health"
if curl -fsS --max-time 10 "http://127.0.0.1:${APP_PORT}/api/health" >/tmp/eaf-health.json 2>/dev/null; then
  echo "   OK $(cat /tmp/eaf-health.json)"
else
  echo "   FAIL health check — last logs:"
  pm2 logs eaf-invoices --lines 25 --nostream
  exit 1
fi

echo ""
echo "✅ App should be up at http://YOUR_VPS_IP:${APP_PORT}"
