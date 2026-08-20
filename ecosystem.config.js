module.exports = {
  apps: [
    {
      name: 'eaf-invoices',
      script: 'server.js',
      exec_mode: 'fork',
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '500M',
      env: {
        NODE_ENV: 'production',
        // PORT و DATABASE_URL يُقرآن من ملف .env — لا تثبّت رقم منfذ هنا
        HOST: '0.0.0.0',
      },
    },
  ],
};
