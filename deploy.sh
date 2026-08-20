#!/bin/bash
set -e

echo "=== EAF Invoices Deployment (PostgreSQL) ==="

# Node.js 20
if ! command -v node &> /dev/null; then
    curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
    apt install -y nodejs
fi

# PostgreSQL
if ! command -v psql &> /dev/null; then
    apt-get update
    apt-get install -y postgresql postgresql-contrib
    systemctl enable postgresql
    systemctl start postgresql
fi

# Create DB and user
sudo -u postgres psql -tc "SELECT 1 FROM pg_roles WHERE rolname='eaf'" | grep -q 1 || \
  sudo -u postgres psql -c "CREATE USER eaf WITH PASSWORD 'eaf2026';"
sudo -u postgres psql -tc "SELECT 1 FROM pg_database WHERE datname='eaf_invoices'" | grep -q 1 || \
  sudo -u postgres psql -c "CREATE DATABASE eaf_invoices OWNER eaf;"
sudo -u postgres psql -d eaf_invoices -c "GRANT ALL ON SCHEMA public TO eaf;" 2>/dev/null || true

export DATABASE_URL="${DATABASE_URL:-postgresql://eaf:eaf2026@localhost:5432/eaf_invoices}"

install_pdf_deps() {
    apt-get update
    local PACKAGES=(
        ca-certificates fonts-liberation wget xdg-utils
        fonts-noto-core fonts-noto-ui-core qpdf
        libc6 libcairo2 libdbus-1-3 libexpat1 libfontconfig1 libgbm1
        libnspr4 libnss3 libpango-1.0-0 libpangocairo-1.0-0 libstdc++6
        libx11-6 libx11-xcb1 libxcb1 libxcomposite1 libxcursor1 libxdamage1
        libxext6 libxfixes3 libxi6 libxrandr2 libxrender1 libxss1 libxtst6 lsb-release
    )
    if grep -q 'VERSION_ID="24' /etc/os-release 2>/dev/null; then
        PACKAGES+=(libasound2t64 libatk-bridge2.0-0t64 libatk1.0-0t64 libcups2t64 libgcc-s1 libglib2.0-0t64 libgtk-3-0t64)
    else
        PACKAGES+=(libasound2 libatk-bridge2.0-0 libatk1.0-0 libcups2 libgcc1 libglib2.0-0 libgtk-3-0)
    fi
    apt-get install -y "${PACKAGES[@]}" || true
}

install_pdf_deps
apt-get install -y build-essential python3 2>/dev/null || true

cd "$(dirname "$0")"

if [ ! -f .env ]; then
  cat > .env <<EOF
PORT=8080
HOST=0.0.0.0
DATABASE_URL=postgresql://eaf:eaf2026@localhost:5432/eaf_invoices
APP_SECRET=eaf-invoices-secret-key
EOF
fi

# Load .env
set -a; source .env; set +a
APP_PORT="${PORT:-8080}"

npm install

if ! command -v pm2 &> /dev/null; then
    npm install -g pm2
fi

pm2 delete eaf-invoices 2>/dev/null || true
pm2 start ecosystem.config.js
pm2 save

if command -v ufw &> /dev/null; then
    ufw allow "${APP_PORT}/tcp" || true
fi

echo ""
echo "✅ Deployment complete!"
echo "🐘 PostgreSQL: eaf_invoices on port 5432"
echo "🌐 Access: http://$(curl -s ifconfig.me 2>/dev/null || hostname -I | awk '{print $1}'):${APP_PORT}"
