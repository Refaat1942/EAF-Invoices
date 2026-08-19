const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

const pool = new Pool({
  connectionString:
    process.env.DATABASE_URL || 'postgresql://eaf:eaf2026@localhost:5432/eaf_invoices',
  max: 20,
});

async function query(text, params) {
  return pool.query(text, params);
}

async function withTransaction(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

async function initDatabase() {
  await query(`
    CREATE TABLE IF NOT EXISTS invoice_serial_counter (
      year INTEGER PRIMARY KEY,
      last_number INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS stay_types (
      id SERIAL PRIMARY KEY,
      name VARCHAR(255) UNIQUE NOT NULL,
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS app_settings (
      key VARCHAR(100) PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      username VARCHAR(100) UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      full_name TEXT DEFAULT '',
      role VARCHAR(30) NOT NULL DEFAULT 'user' CHECK(role IN ('admin', 'user')),
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      last_login TIMESTAMPTZ
    );

    CREATE TABLE IF NOT EXISTS invoices (
      id SERIAL PRIMARY KEY,
      serial_number VARCHAR(50) UNIQUE NOT NULL,
      issue_date DATE DEFAULT CURRENT_DATE,
      invoice_type VARCHAR(30) NOT NULL CHECK(invoice_type IN ('civil', 'contracted', 'non_contracted', 'military')),
      patient_name TEXT DEFAULT '',
      file_number TEXT DEFAULT '',
      admission_date DATE,
      discharge_date DATE,
      stay_days INTEGER DEFAULT 0,
      financial_treatment TEXT DEFAULT '',
      stay_type TEXT DEFAULT '',
      stay_type_id INTEGER REFERENCES stay_types(id) ON DELETE SET NULL,
      stay_type_ids JSONB DEFAULT '[]',
      stamp_duty NUMERIC(14,2) DEFAULT 0,
      professional_fees NUMERIC(14,2) DEFAULT 0,
      stamp_duty_raw NUMERIC(14,4) DEFAULT 0,
      professional_fees_raw NUMERIC(14,4) DEFAULT 0,
      items_subtotal NUMERIC(14,2) DEFAULT 0,
      items_subtotal_raw NUMERIC(14,4) DEFAULT 0,
      admin_expenses_percent NUMERIC(6,2) DEFAULT 12,
      admin_expenses NUMERIC(14,2) DEFAULT 0,
      admin_expenses_raw NUMERIC(14,4) DEFAULT 0,
      total_after_admin NUMERIC(14,2) DEFAULT 0,
      total_after_admin_raw NUMERIC(14,4) DEFAULT 0,
      balance NUMERIC(14,2) DEFAULT 0,
      balance_raw NUMERIC(14,4) DEFAULT 0,
      final_total NUMERIC(14,2) DEFAULT 0,
      final_total_raw NUMERIC(14,4) DEFAULT 0,
      cash_private NUMERIC(14,2) DEFAULT 0,
      bank_private NUMERIC(14,2) DEFAULT 0,
      cash_external NUMERIC(14,2) DEFAULT 0,
      bank_external NUMERIC(14,2) DEFAULT 0,
      total_collected NUMERIC(14,2) DEFAULT 0,
      total_collected_raw NUMERIC(14,4) DEFAULT 0,
      remaining NUMERIC(14,2) DEFAULT 0,
      remaining_raw NUMERIC(14,4) DEFAULT 0,
      employee_name TEXT DEFAULT '',
      auditor_name TEXT DEFAULT '',
      captain_name TEXT DEFAULT 'نقيب / عمرو صالح محمد',
      manager_name TEXT DEFAULT 'رائد / جمال عبد الناصر - المدير المالي',
      qr_token UUID UNIQUE NOT NULL,
      file_password TEXT DEFAULT '',
      notes TEXT DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS invoice_items (
      id SERIAL PRIMARY KEY,
      invoice_id INTEGER NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
      description TEXT DEFAULT '',
      quantity NUMERIC(14,2) DEFAULT 0,
      amount NUMERIC(14,2) DEFAULT 0,
      total NUMERIC(14,2) DEFAULT 0,
      sort_order INTEGER DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS invoice_payments (
      id SERIAL PRIMARY KEY,
      invoice_id INTEGER NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
      receipt_date DATE,
      receipt_number TEXT DEFAULT '',
      amount NUMERIC(14,2) DEFAULT 0,
      sort_order INTEGER DEFAULT 0
    );

    CREATE INDEX IF NOT EXISTS idx_invoices_serial ON invoices(serial_number);
    CREATE INDEX IF NOT EXISTS idx_invoices_type ON invoices(invoice_type);
    CREATE INDEX IF NOT EXISTS idx_invoices_created ON invoices(created_at);
    CREATE INDEX IF NOT EXISTS idx_invoices_qr ON invoices(qr_token);
  `);

  const defaults = await query('SELECT COUNT(*)::int AS c FROM stay_types');
  if (defaults.rows[0].c === 0) {
    const types = ['غرفة مفردة', 'غرفة مزدوجة', 'جناح', 'عناية مركزة', 'رقود يومي', 'خارجي'];
    for (let i = 0; i < types.length; i++) {
      await query('INSERT INTO stay_types (name, sort_order) VALUES ($1, $2) ON CONFLICT DO NOTHING', [
        types[i],
        i + 1,
      ]);
    }
  }

  const uploadsDir = path.join(__dirname, '..', 'public', 'assets');
  if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

  const { seedAdminUser } = require('../services/authService');
  await runMigrations();
  await seedAdminUser();

  console.log('✅ PostgreSQL connected and schema ready');
}

async function runMigrations() {
  const alterColumns = [
    'stamp_duty_raw NUMERIC(14,4) DEFAULT 0',
    'professional_fees_raw NUMERIC(14,4) DEFAULT 0',
    'items_subtotal_raw NUMERIC(14,4) DEFAULT 0',
    'admin_expenses_raw NUMERIC(14,4) DEFAULT 0',
    'total_after_admin_raw NUMERIC(14,4) DEFAULT 0',
    'balance_raw NUMERIC(14,4) DEFAULT 0',
    'final_total_raw NUMERIC(14,4) DEFAULT 0',
    'total_collected_raw NUMERIC(14,4) DEFAULT 0',
    'remaining_raw NUMERIC(14,4) DEFAULT 0',
    'issue_date DATE DEFAULT CURRENT_DATE',
    'file_number TEXT DEFAULT \'\'',
    'stay_type_ids JSONB DEFAULT \'[]\'',
  ];
  for (const col of alterColumns) {
    const name = col.split(' ')[0];
    await query(`ALTER TABLE invoices ADD COLUMN IF NOT EXISTS ${name} ${col.slice(name.length + 1)}`);
  }

  await query(`UPDATE users SET role = 'user' WHERE role IN ('supervisor', 'accountant', 'viewer')`);
  await query(`ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check`);
  await query(`ALTER TABLE users ADD CONSTRAINT users_role_check CHECK (role IN ('admin', 'user'))`);

  await query(`
    UPDATE invoices
    SET stay_type_ids = jsonb_build_array(stay_type_id)
    WHERE stay_type_id IS NOT NULL
      AND (stay_type_ids IS NULL OR stay_type_ids = '[]'::jsonb)
  `);

  await query(`UPDATE invoices SET file_password = '' WHERE COALESCE(file_password, '') <> ''`);
  await query(`DELETE FROM app_settings WHERE key = 'default_file_password'`);
}

module.exports = { pool, query, withTransaction, initDatabase };
