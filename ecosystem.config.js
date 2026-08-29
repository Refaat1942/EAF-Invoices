module.exports = {
  apps: [
    {
      name: 'eaf-invoices',
      script: 'server.js',
      exec_mode: 'fork',
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '1500M',
      node_args: '--max-old-space-size=1536',
      env: {
        NODE_ENV: 'production',
        // PORT و DATABASE_URL يُقرآن من ملف .env — لا تثبّت رقم منfذ هنا
        HOST: '0.0.0.0',
      },
    },
  ],
};
