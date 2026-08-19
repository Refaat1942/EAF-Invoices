#!/bin/bash
set -e

echo "=== EAF Invoices Deployment ==="

# Install Node.js 20 if not present
if ! command -v node &> /dev/null; then
    curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
    apt install -y nodejs
fi

# Puppeteer dependencies for PDF
apt-get update
apt-get install -y \
    ca-certificates fonts-liberation libasound2 libatk-bridge2.0-0 libatk1.0-0 \
    libc6 libcairo2 libcups2 libdbus-1-3 libexpat1 libfontconfig1 libgbm1 \
    libgcc1 libglib2.0-0 libgtk-3-0 libnspr4 libnss3 libpango-1.0-0 \
    libpangocairo-1.0-0 libstdc++6 libx11-6 libx11-xcb1 libxcb1 libxcomposite1 \
    libxcursor1 libxdamage1 libxext6 libxfixes3 libxi6 libxrandr2 libxrender1 \
    libxss1 libxtst6 lsb-release wget xdg-utils fonts-noto-core fonts-noto-ui-core

cd "$(dirname "$0")"
npm install

# PM2
if ! command -v pm2 &> /dev/null; then
    npm install -g pm2
fi

pm2 delete eaf-invoices 2>/dev/null || true
pm2 start ecosystem.config.js
pm2 save

# Firewall
if command -v ufw &> /dev/null; then
    ufw allow 17159/tcp
fi

echo ""
echo "✅ Deployment complete!"
echo "🌐 Access: http://$(curl -s ifconfig.me 2>/dev/null || echo 'YOUR_IP'):17159"
