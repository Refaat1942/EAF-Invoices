#!/bin/bash
set -e

echo "=== EAF Invoices Deployment ==="

# Install Node.js 20 if not present
if ! command -v node &> /dev/null; then
    curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
    apt install -y nodejs
fi

echo "Node.js: $(node -v)"

# Puppeteer / Chromium dependencies for PDF generation
install_pdf_deps() {
    apt-get update

    local PACKAGES=(
        ca-certificates fonts-liberation wget xdg-utils
        fonts-noto-core fonts-noto-ui-core
        libc6 libcairo2 libdbus-1-3 libexpat1 libfontconfig1 libgbm1
        libnspr4 libnss3 libpango-1.0-0 libpangocairo-1.0-0 libstdc++6
        libx11-6 libx11-xcb1 libxcb1 libxcomposite1 libxcursor1 libxdamage1
        libxext6 libxfixes3 libxi6 libxrandr2 libxrender1 libxss1 libxtst6
        lsb-release
    )

    # Ubuntu 24.04 (Noble) uses t64 package names
    if grep -q 'VERSION_ID="24' /etc/os-release 2>/dev/null; then
        echo "Detected Ubuntu 24.04 - using updated package names..."
        PACKAGES+=(
            libasound2t64 libatk-bridge2.0-0t64 libatk1.0-0t64 libcups2t64
            libgcc-s1 libglib2.0-0t64 libgtk-3-0t64
        )
    else
        PACKAGES+=(
            libasound2 libatk-bridge2.0-0 libatk1.0-0 libcups2
            libgcc1 libglib2.0-0 libgtk-3-0
        )
    fi

    if ! apt-get install -y "${PACKAGES[@]}"; then
        echo "⚠️  Warning: some PDF dependencies could not be installed."
        echo "   The app will run, but PDF export may fail until deps are fixed."
    fi
}

install_pdf_deps

# Build tools for better-sqlite3 (if prebuilt binary unavailable)
apt-get install -y build-essential python3 2>/dev/null || true

cd "$(dirname "$0")"
npm install

# PM2
if ! command -v pm2 &> /dev/null; then
    npm install -g pm2
fi

pm2 delete eaf-invoices 2>/dev/null || true
pm2 start ecosystem.config.js
pm2 save
pm2 startup 2>/dev/null || true

# Firewall
if command -v ufw &> /dev/null; then
    ufw allow 17159/tcp || true
fi

echo ""
echo "✅ Deployment complete!"
echo "🌐 Access: http://$(curl -s ifconfig.me 2>/dev/null || hostname -I | awk '{print $1}'):17159"
