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
        PORT: 17159,
        HOST: '0.0.0.0',
        DATABASE_URL: 'postgresql://eaf:eaf2026@localhost:5432/eaf_invoices',
      },
    },
  ],
};
