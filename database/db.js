const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');
const { getDatabaseConnectionString } = require('./connectionConfig');

const pool = new Pool({
  connectionString: getDatabaseConnectionString(),
  max: 20,
});

pool.on('error', (err) => {
  console.error('[database] pool connection error:', err.message);
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
      daily_rate NUMERIC(14,2) NOT NULL DEFAULT 0,
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS invoice_types (
      id SERIAL PRIMARY KEY,
      code VARCHAR(50) UNIQUE NOT NULL,
      name VARCHAR(255) NOT NULL,
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS payment_methods (
      id SERIAL PRIMARY KEY,
      code VARCHAR(50) UNIQUE NOT NULL,
      name VARCHAR(255) NOT NULL,
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      accepts_amount BOOLEAN NOT NULL DEFAULT TRUE,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS contracted_entities (
      id SERIAL PRIMARY KEY,
      parent_id INTEGER REFERENCES contracted_entities(id) ON DELETE SET NULL,
      name VARCHAR(255) NOT NULL,
      discount_percent NUMERIC(6,2) NOT NULL DEFAULT 0,
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS discount_exclusion_items (
      id SERIAL PRIMARY KEY,
      name VARCHAR(255) NOT NULL,
      match_type VARCHAR(20) NOT NULL DEFAULT 'contains',
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
      invoice_type VARCHAR(30) NOT NULL,
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
      is_discount_eligible BOOLEAN NOT NULL DEFAULT TRUE,
      item_discount_percent NUMERIC(6,2) DEFAULT 0,
      discount_exclusion_id INTEGER REFERENCES discount_exclusion_items(id) ON DELETE SET NULL,
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

    CREATE TABLE IF NOT EXISTS invoice_stay_entries (
      id SERIAL PRIMARY KEY,
      invoice_id INTEGER NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
      stay_type_id INTEGER REFERENCES stay_types(id) ON DELETE SET NULL,
      stay_type_name TEXT DEFAULT '',
      from_date DATE,
      to_date DATE,
      days INTEGER DEFAULT 0,
      daily_rate NUMERIC(14,2) DEFAULT 0,
      total NUMERIC(14,2) DEFAULT 0,
      total_raw NUMERIC(14,4) DEFAULT 0,
      sort_order INTEGER DEFAULT 0
    );

    CREATE INDEX IF NOT EXISTS idx_stay_entries_invoice ON invoice_stay_entries(invoice_id);
  `);

  const defaults = await query('SELECT COUNT(*)::int AS c FROM stay_types');
  if (defaults.rows[0].c === 0) {
    const types = [
      'رعاية مركزة',
      'رعاية تلطيفية',
      'جناح VIP',
      'جناح كبير مميز',
      'غرفة مميزة',
      'جناح كبير',
      'جناح صغير',
      'غرفة فردية',
      'غرفة مزدوجة',
    ];
    for (let i = 0; i < types.length; i++) {
      await query('INSERT INTO stay_types (name, sort_order) VALUES ($1, $2) ON CONFLICT DO NOTHING', [
        types[i],
        i + 1,
      ]);
    }
  }

  const invoiceTypeCount = await query('SELECT COUNT(*)::int AS c FROM invoice_types');
  if (invoiceTypeCount.rows[0].c === 0) {
    const invoiceTypes = [
      { code: 'civil', name: 'مدني (خاص)' },
      { code: 'contracted', name: 'جهات متعاقدة' },
      { code: 'non_contracted', name: 'جهات غير متعاقدة' },
      { code: 'military', name: 'عسكري' },
    ];
    for (let i = 0; i < invoiceTypes.length; i++) {
      await query(
        'INSERT INTO invoice_types (code, name, sort_order) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING',
        [invoiceTypes[i].code, invoiceTypes[i].name, i + 1]
      );
    }
  }

  const paymentMethodCount = await query('SELECT COUNT(*)::int AS c FROM payment_methods');
  if (paymentMethodCount.rows[0].c === 0) {
    const paymentMethods = [
      { code: 'cash', name: 'دفع نقدي', accepts_amount: true },
      { code: 'bank_transfer', name: 'تحويل بنكي', accepts_amount: true },
      { code: 'check', name: 'شيك مقبول الدفع', accepts_amount: true },
      { code: 'multi', name: 'دفع بأكثر من طريقة', accepts_amount: false },
    ];
    for (let i = 0; i < paymentMethods.length; i++) {
      await query(
        'INSERT INTO payment_methods (code, name, accepts_amount, sort_order) VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING',
        [paymentMethods[i].code, paymentMethods[i].name, paymentMethods[i].accepts_amount, i + 1]
      );
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

  await query(`ALTER TABLE invoices DROP CONSTRAINT IF EXISTS invoices_invoice_type_check`);

  await query(`
    CREATE TABLE IF NOT EXISTS invoice_types (
      id SERIAL PRIMARY KEY,
      code VARCHAR(50) UNIQUE NOT NULL,
      name VARCHAR(255) NOT NULL,
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS payment_methods (
      id SERIAL PRIMARY KEY,
      code VARCHAR(50) UNIQUE NOT NULL,
      name VARCHAR(255) NOT NULL,
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      accepts_amount BOOLEAN NOT NULL DEFAULT TRUE,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS invoice_payment_amounts (
      id SERIAL PRIMARY KEY,
      invoice_id INTEGER NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
      payment_method_id INTEGER NOT NULL REFERENCES payment_methods(id) ON DELETE RESTRICT,
      amount NUMERIC(14,2) DEFAULT 0,
      UNIQUE(invoice_id, payment_method_id)
    )
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS contracted_entities (
      id SERIAL PRIMARY KEY,
      parent_id INTEGER REFERENCES contracted_entities(id) ON DELETE SET NULL,
      name VARCHAR(255) NOT NULL,
      discount_percent NUMERIC(6,2) NOT NULL DEFAULT 0,
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS discount_exclusion_items (
      id SERIAL PRIMARY KEY,
      name VARCHAR(255) NOT NULL,
      match_type VARCHAR(20) NOT NULL DEFAULT 'contains',
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  const phase2InvoiceColumns = [
    'contracted_entity_id INTEGER REFERENCES contracted_entities(id) ON DELETE SET NULL',
    'contracted_entity_name TEXT DEFAULT \'\'',
    'discount_percent NUMERIC(6,2) DEFAULT 0',
    'discount_eligible_subtotal NUMERIC(14,2) DEFAULT 0',
    'discount_eligible_subtotal_raw NUMERIC(14,4) DEFAULT 0',
    'discount_amount NUMERIC(14,2) DEFAULT 0',
    'discount_amount_raw NUMERIC(14,4) DEFAULT 0',
    'items_subtotal_after_discount NUMERIC(14,2) DEFAULT 0',
    'items_subtotal_after_discount_raw NUMERIC(14,4) DEFAULT 0',
    'letter_from_date DATE',
    'letter_to_date DATE',
    'created_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL',
    'created_by_name TEXT DEFAULT \'\'',
  ];
  for (const col of phase2InvoiceColumns) {
    const name = col.split(' ')[0];
    await query(`ALTER TABLE invoices ADD COLUMN IF NOT EXISTS ${name} ${col.slice(name.length + 1)}`);
  }

  const phase2ItemColumns = [
    'is_discount_eligible BOOLEAN NOT NULL DEFAULT TRUE',
    'item_discount_percent NUMERIC(6,2) DEFAULT 0',
    'discount_exclusion_id INTEGER REFERENCES discount_exclusion_items(id) ON DELETE SET NULL',
  ];
  for (const col of phase2ItemColumns) {
    const name = col.split(' ')[0];
    await query(`ALTER TABLE invoice_items ADD COLUMN IF NOT EXISTS ${name} ${col.slice(name.length + 1)}`);
  }

  await query(`ALTER TABLE stay_types ADD COLUMN IF NOT EXISTS daily_rate NUMERIC(14,2) NOT NULL DEFAULT 0`);

  const phase4InvoiceColumns = [
    'stay_subtotal NUMERIC(14,2) DEFAULT 0',
    'stay_subtotal_raw NUMERIC(14,4) DEFAULT 0',
  ];
  for (const col of phase4InvoiceColumns) {
    const name = col.split(' ')[0];
    await query(`ALTER TABLE invoices ADD COLUMN IF NOT EXISTS ${name} ${col.slice(name.length + 1)}`);
  }

  await query(`
    CREATE TABLE IF NOT EXISTS invoice_stay_entries (
      id SERIAL PRIMARY KEY,
      invoice_id INTEGER NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
      stay_type_id INTEGER REFERENCES stay_types(id) ON DELETE SET NULL,
      stay_type_name TEXT DEFAULT '',
      from_date DATE,
      to_date DATE,
      days INTEGER DEFAULT 0,
      daily_rate NUMERIC(14,2) DEFAULT 0,
      total NUMERIC(14,2) DEFAULT 0,
      total_raw NUMERIC(14,4) DEFAULT 0,
      sort_order INTEGER DEFAULT 0
    )
  `);
  await query(`CREATE INDEX IF NOT EXISTS idx_stay_entries_invoice ON invoice_stay_entries(invoice_id)`);

  const phase6InvoiceColumns = ['fiscal_year INTEGER', 'serial_sequence INTEGER'];
  for (const col of phase6InvoiceColumns) {
    const name = col.split(' ')[0];
    await query(`ALTER TABLE invoices ADD COLUMN IF NOT EXISTS ${name} ${col.slice(name.length + 1)}`);
  }
  await query(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_invoices_fiscal_serial
    ON invoices (fiscal_year, serial_sequence)
    WHERE fiscal_year IS NOT NULL AND serial_sequence IS NOT NULL
  `);

  const { syncSerialCountersFromInvoices } = require('../services/serialService');
  await syncSerialCountersFromInvoices();

  // Phase 8 — draft workflow, patients, user permissions
  await query(`ALTER TABLE invoices ALTER COLUMN serial_number DROP NOT NULL`);
  await query(`ALTER TABLE invoices ALTER COLUMN qr_token DROP NOT NULL`);
  await query(`ALTER TABLE invoices ADD COLUMN IF NOT EXISTS status VARCHAR(30) DEFAULT 'draft'`);
  await query(`ALTER TABLE invoices ADD COLUMN IF NOT EXISTS submitted_at TIMESTAMPTZ`);
  await query(`ALTER TABLE invoices ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMPTZ`);
  await query(`ALTER TABLE invoices ADD COLUMN IF NOT EXISTS reviewed_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL`);
  await query(`ALTER TABLE invoices ADD COLUMN IF NOT EXISTS reviewed_by_name TEXT DEFAULT ''`);
  await query(`ALTER TABLE invoices ADD COLUMN IF NOT EXISTS patient_credit_applied NUMERIC(14,2) DEFAULT 0`);
  await query(`ALTER TABLE invoices ADD COLUMN IF NOT EXISTS patient_credit_deducted BOOLEAN DEFAULT FALSE`);

  await query(
    `INSERT INTO payment_methods (code, name, accepts_amount, sort_order, is_active)
     VALUES ('patient_credit', 'خصم من رصيد المريض', TRUE, 4, TRUE)
     ON CONFLICT (code) DO UPDATE SET
       name = EXCLUDED.name,
       accepts_amount = TRUE,
       is_active = TRUE,
       sort_order = EXCLUDED.sort_order`
  );

  await query(`
    UPDATE invoices SET status = 'approved'
    WHERE COALESCE(status, '') = '' AND serial_number IS NOT NULL
  `);
  await query(`
    UPDATE invoices SET status = 'draft'
    WHERE COALESCE(status, '') = '' AND serial_number IS NULL
  `);

  await query(`DROP INDEX IF EXISTS idx_invoices_serial_unique`);
  await query(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_invoices_serial_unique
    ON invoices (serial_number) WHERE serial_number IS NOT NULL
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS patients (
      id SERIAL PRIMARY KEY,
      file_number VARCHAR(100) UNIQUE NOT NULL,
      name TEXT DEFAULT '',
      account_balance NUMERIC(14,2) DEFAULT 0,
      account_balance_raw NUMERIC(14,4) DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS patient_transactions (
      id SERIAL PRIMARY KEY,
      patient_id INTEGER NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
      invoice_id INTEGER REFERENCES invoices(id) ON DELETE SET NULL,
      amount NUMERIC(14,2) NOT NULL DEFAULT 0,
      balance_after NUMERIC(14,2) NOT NULL DEFAULT 0,
      note TEXT DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS custom_permissions JSONB DEFAULT '[]'::jsonb`);
  await query(`ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check`);
  await query(`ALTER TABLE users ADD CONSTRAINT users_role_check CHECK (role IN ('admin', 'reviewer', 'user'))`);

  // Phase 9 — service pricing catalog with versioning
  await query(`
    CREATE TABLE IF NOT EXISTS price_lists (
      id SERIAL PRIMARY KEY,
      name VARCHAR(255) NOT NULL,
      code VARCHAR(100) UNIQUE NOT NULL,
      fiscal_year_start INTEGER,
      fiscal_year_end INTEGER,
      effective_from DATE,
      effective_to DATE,
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      is_default BOOLEAN NOT NULL DEFAULT FALSE,
      cloned_from_id INTEGER REFERENCES price_lists(id) ON DELETE SET NULL,
      created_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      created_by_name TEXT DEFAULT '',
      notes TEXT DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS service_categories (
      id SERIAL PRIMARY KEY,
      price_list_id INTEGER NOT NULL REFERENCES price_lists(id) ON DELETE CASCADE,
      parent_id INTEGER REFERENCES service_categories(id) ON DELETE SET NULL,
      name VARCHAR(255) NOT NULL,
      code VARCHAR(100) NOT NULL,
      sort_order INTEGER NOT NULL DEFAULT 0,
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      notes TEXT DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(price_list_id, code)
    )
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS services (
      id SERIAL PRIMARY KEY,
      price_list_id INTEGER NOT NULL REFERENCES price_lists(id) ON DELETE CASCADE,
      category_id INTEGER REFERENCES service_categories(id) ON DELETE SET NULL,
      code VARCHAR(100) NOT NULL,
      name VARCHAR(500) NOT NULL,
      description TEXT DEFAULT '',
      unit VARCHAR(50) DEFAULT 'مرة',
      price NUMERIC(14,2) DEFAULT 0,
      price_type VARCHAR(30) NOT NULL DEFAULT 'fixed',
      variable_price_note TEXT DEFAULT '',
      discountable BOOLEAN NOT NULL DEFAULT TRUE,
      administrative_fee_applicable BOOLEAN NOT NULL DEFAULT TRUE,
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      sort_order INTEGER NOT NULL DEFAULT 0,
      notes TEXT DEFAULT '',
      metadata JSONB DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(price_list_id, code)
    )
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS service_price_components (
      id SERIAL PRIMARY KEY,
      service_id INTEGER NOT NULL REFERENCES services(id) ON DELETE CASCADE,
      code VARCHAR(100) DEFAULT '',
      name VARCHAR(255) NOT NULL,
      amount NUMERIC(14,2) DEFAULT 0,
      discountable BOOLEAN,
      administrative_fee_applicable BOOLEAN,
      sort_order INTEGER NOT NULL DEFAULT 0,
      is_total BOOLEAN NOT NULL DEFAULT FALSE
    )
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS service_price_tiers (
      id SERIAL PRIMARY KEY,
      service_id INTEGER NOT NULL REFERENCES services(id) ON DELETE CASCADE,
      tier_key VARCHAR(100) NOT NULL,
      tier_label VARCHAR(255) NOT NULL,
      unit VARCHAR(50) DEFAULT 'مرة',
      price NUMERIC(14,2) DEFAULT 0,
      sort_order INTEGER NOT NULL DEFAULT 0,
      UNIQUE(service_id, tier_key)
    )
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS service_price_history (
      id SERIAL PRIMARY KEY,
      service_id INTEGER NOT NULL REFERENCES services(id) ON DELETE CASCADE,
      price_list_id INTEGER REFERENCES price_lists(id) ON DELETE SET NULL,
      field_name VARCHAR(100) DEFAULT 'price',
      old_value TEXT,
      new_value TEXT,
      old_price NUMERIC(14,2),
      new_price NUMERIC(14,2),
      effective_from DATE,
      effective_to DATE,
      changed_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      changed_by_name TEXT DEFAULT '',
      change_reason TEXT DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  const invoiceItemPricingColumns = [
    'service_id INTEGER REFERENCES services(id) ON DELETE SET NULL',
    'service_code_snapshot TEXT DEFAULT \'\'',
    'service_name_snapshot TEXT DEFAULT \'\'',
    'unit_snapshot VARCHAR(50) DEFAULT \'\'',
    'unit_price_snapshot NUMERIC(14,2) DEFAULT 0',
    'price_type_snapshot VARCHAR(30) DEFAULT \'\'',
    'tier_key_snapshot VARCHAR(100) DEFAULT \'\'',
    'discountable_snapshot BOOLEAN',
    'administrative_fee_applicable_snapshot BOOLEAN',
    'admin_fee_amount_snapshot NUMERIC(14,2) DEFAULT 0',
    'admin_fee_percent_snapshot NUMERIC(6,2) DEFAULT 0',
    'price_list_id_snapshot INTEGER',
    'price_list_name_snapshot TEXT DEFAULT \'\'',
    'composite_components_snapshot JSONB DEFAULT \'[]\'::jsonb',
    'patient_credit_applied NUMERIC(14,2) DEFAULT 0',
  ];
  for (const col of invoiceItemPricingColumns) {
    const name = col.split(' ')[0];
    await query(`ALTER TABLE invoice_items ADD COLUMN IF NOT EXISTS ${name} ${col.slice(name.length + 1)}`);
  }

  await query(`CREATE INDEX IF NOT EXISTS idx_services_category ON services(category_id)`);
  await query(`CREATE INDEX IF NOT EXISTS idx_services_price_list ON services(price_list_id)`);
  await query(`CREATE INDEX IF NOT EXISTS idx_service_categories_list ON service_categories(price_list_id)`);
  await query(`CREATE INDEX IF NOT EXISTS idx_invoice_items_service ON invoice_items(service_id)`);

  const pricingSettings = [
    ['administrative_fee_rate', '12'],
    ['file_opening_fee', '50'],
    ['ambulance_rental_cairo', '3000'],
    ['foreign_resident_multiplier', '150'],
    ['foreign_non_resident_multiplier', '200'],
    ['foreign_currency_discount_percent', '15'],
  ];
  for (const [key, value] of pricingSettings) {
    await query(
      `INSERT INTO app_settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO NOTHING`,
      [key, value]
    );
  }

  const { seedDefaultPriceList } = require('../database/seeds/seedPriceList');
  await seedDefaultPriceList();

  await query(`
    CREATE TABLE IF NOT EXISTS daily_charge_sections (
      id SERIAL PRIMARY KEY,
      code VARCHAR(50) UNIQUE NOT NULL,
      name VARCHAR(255) NOT NULL,
      category_code VARCHAR(100),
      default_service_code VARCHAR(100),
      input_type VARCHAR(20) NOT NULL DEFAULT 'amount',
      sort_order INTEGER NOT NULL DEFAULT 0,
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS patient_daily_entries (
      id SERIAL PRIMARY KEY,
      patient_id INTEGER NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
      entry_date DATE NOT NULL,
      stay_type_id INTEGER REFERENCES stay_types(id) ON DELETE SET NULL,
      daily_total NUMERIC(14,2) NOT NULL DEFAULT 0,
      notes TEXT DEFAULT '',
      invoice_id INTEGER REFERENCES invoices(id) ON DELETE SET NULL,
      created_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      created_by_name TEXT DEFAULT '',
      updated_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      updated_by_name TEXT DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS patient_daily_entry_lines (
      id SERIAL PRIMARY KEY,
      entry_id INTEGER NOT NULL REFERENCES patient_daily_entries(id) ON DELETE CASCADE,
      section_code VARCHAR(50) NOT NULL,
      service_id INTEGER REFERENCES services(id) ON DELETE SET NULL,
      description TEXT DEFAULT '',
      quantity NUMERIC(14,2) NOT NULL DEFAULT 1,
      unit_price NUMERIC(14,2) NOT NULL DEFAULT 0,
      amount NUMERIC(14,2) NOT NULL DEFAULT 0,
      extra_date DATE,
      extra_text TEXT DEFAULT '',
      sort_order INTEGER NOT NULL DEFAULT 0
    )
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS patient_daily_entry_history (
      id SERIAL PRIMARY KEY,
      entry_id INTEGER NOT NULL REFERENCES patient_daily_entries(id) ON DELETE CASCADE,
      action VARCHAR(20) NOT NULL,
      snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
      changed_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      changed_by_name TEXT DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await query(`CREATE INDEX IF NOT EXISTS idx_daily_entries_patient_date ON patient_daily_entries(patient_id, entry_date)`);
  await query(`CREATE INDEX IF NOT EXISTS idx_daily_entries_invoice ON patient_daily_entries(invoice_id)`);
  await query(
    `ALTER TABLE patient_daily_entries DROP CONSTRAINT IF EXISTS patient_daily_entries_patient_id_entry_date_key`
  );
  await query(`CREATE INDEX IF NOT EXISTS idx_daily_entry_lines_entry ON patient_daily_entry_lines(entry_id)`);

  await query(`
    CREATE TABLE IF NOT EXISTS daily_entry_catalog_items (
      id SERIAL PRIMARY KEY,
      code VARCHAR(100) UNIQUE NOT NULL,
      name VARCHAR(255) NOT NULL,
      category VARCHAR(50) NOT NULL,
      unit VARCHAR(50) NOT NULL DEFAULT 'مرة',
      price NUMERIC(14,2) NOT NULL DEFAULT 0,
      sort_order INTEGER NOT NULL DEFAULT 0,
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await query(`CREATE INDEX IF NOT EXISTS idx_daily_catalog_category ON daily_entry_catalog_items(category)`);
  await query(`CREATE INDEX IF NOT EXISTS idx_daily_catalog_active ON daily_entry_catalog_items(is_active)`);

  await query(`ALTER TABLE daily_charge_sections ADD COLUMN IF NOT EXISTS catalog_category VARCHAR(50)`);
  await query(
    `ALTER TABLE patient_daily_entry_lines ADD COLUMN IF NOT EXISTS catalog_item_id INTEGER REFERENCES daily_entry_catalog_items(id) ON DELETE SET NULL`
  );
  await query(`CREATE INDEX IF NOT EXISTS idx_daily_entry_lines_catalog ON patient_daily_entry_lines(catalog_item_id)`);

  await query(`ALTER TABLE daily_entry_catalog_items ADD COLUMN IF NOT EXISTS cost_price NUMERIC(14,2)`);
  await query(`ALTER TABLE daily_entry_catalog_items ADD COLUMN IF NOT EXISTS markup_percent NUMERIC(8,2)`);
  await query(`ALTER TABLE patient_daily_entry_lines ADD COLUMN IF NOT EXISTS cost_price NUMERIC(14,2)`);
  await query(`ALTER TABLE patient_daily_entry_lines ADD COLUMN IF NOT EXISTS markup_percent NUMERIC(8,2)`);

  await query(
    `UPDATE daily_entry_catalog_items
     SET cost_price = price, markup_percent = 0
     WHERE category = 'Supplies' AND cost_price IS NULL AND COALESCE(price, 0) > 0`
  );

  await query(`ALTER TABLE daily_entry_catalog_items ADD COLUMN IF NOT EXISTS major_unit VARCHAR(50)`);
  await query(`ALTER TABLE daily_entry_catalog_items ADD COLUMN IF NOT EXISTS minor_unit VARCHAR(50)`);
  await query(
    `ALTER TABLE daily_entry_catalog_items ADD COLUMN IF NOT EXISTS minor_quantity_per_major NUMERIC(14,2)`
  );
  await query(
    `ALTER TABLE daily_entry_catalog_items ADD COLUMN IF NOT EXISTS major_unit_selling_price NUMERIC(14,2)`
  );
  await query(
    `ALTER TABLE daily_entry_catalog_items ADD COLUMN IF NOT EXISTS minor_unit_selling_price NUMERIC(14,2)`
  );
  await query(
    `UPDATE daily_entry_catalog_items
     SET major_unit = COALESCE(major_unit, unit, 'مرة'),
         major_unit_selling_price = COALESCE(major_unit_selling_price, price),
         minor_unit = COALESCE(minor_unit, unit, 'مرة'),
         minor_quantity_per_major = COALESCE(minor_quantity_per_major, 1),
         minor_unit_selling_price = COALESCE(minor_unit_selling_price, price)
     WHERE major_unit IS NULL OR major_unit_selling_price IS NULL`
  );

  await query(`ALTER TABLE patient_daily_entry_lines ADD COLUMN IF NOT EXISTS catalog_unit VARCHAR(50)`);
  await query(`ALTER TABLE patient_daily_entry_lines ADD COLUMN IF NOT EXISTS catalog_unit_level VARCHAR(10)`);

  await query(`
    CREATE TABLE IF NOT EXISTS daily_entry_catalog_code_registry (
      code CHAR(7) PRIMARY KEY,
      catalog_item_id INTEGER REFERENCES daily_entry_catalog_items(id) ON DELETE SET NULL,
      assigned_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await query(`
    CREATE TABLE IF NOT EXISTS daily_entry_catalog_code_sequence (
      id INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
      last_number BIGINT NOT NULL DEFAULT 0
    )
  `);
  await query(
    `INSERT INTO daily_entry_catalog_code_sequence (id, last_number) VALUES (1, 0) ON CONFLICT (id) DO NOTHING`
  );
  await query(`
    INSERT INTO daily_entry_catalog_code_registry (code, catalog_item_id)
    SELECT code, id FROM daily_entry_catalog_items
    WHERE code ~ '^[0-9]{7}$'
    ON CONFLICT (code) DO NOTHING
  `);
  await query(`
    UPDATE daily_entry_catalog_code_sequence
    SET last_number = GREATEST(
      last_number,
      COALESCE((SELECT MAX(code::bigint) FROM daily_entry_catalog_code_registry), 0)
    )
    WHERE id = 1
  `);

  await query(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_daily_catalog_product_unique
    ON daily_entry_catalog_items (category, LOWER(TRIM(name)))
  `);

  const dailyInvoiceItemColumns = [
    'daily_entry_id INTEGER REFERENCES patient_daily_entries(id) ON DELETE SET NULL',
    'daily_entry_line_id INTEGER REFERENCES patient_daily_entry_lines(id) ON DELETE SET NULL',
  ];
  for (const col of dailyInvoiceItemColumns) {
    const name = col.split(' ')[0];
    await query(`ALTER TABLE invoice_items ADD COLUMN IF NOT EXISTS ${name} ${col.slice(name.length + 1)}`);
  }

  const suppliesSnapshotColumns = [
    'cost_price_snapshot NUMERIC(14,2)',
    'markup_percent_snapshot NUMERIC(8,2)',
    'selling_price_snapshot NUMERIC(14,2)',
    'margin_amount_snapshot NUMERIC(14,2)',
  ];
  for (const col of suppliesSnapshotColumns) {
    const name = col.split(' ')[0];
    await query(`ALTER TABLE invoice_items ADD COLUMN IF NOT EXISTS ${name} ${col.slice(name.length + 1)}`);
  }

  await query(`
    UPDATE invoice_items ii
    SET cost_price_snapshot = l.cost_price,
        markup_percent_snapshot = l.markup_percent,
        selling_price_snapshot = ii.amount,
        margin_amount_snapshot = (COALESCE(ii.amount, 0) - COALESCE(l.cost_price, 0)) * COALESCE(ii.quantity, 1)
    FROM patient_daily_entry_lines l
    WHERE ii.daily_entry_line_id = l.id
      AND l.section_code = 'supplies'
      AND ii.cost_price_snapshot IS NULL
      AND (l.cost_price IS NOT NULL OR l.markup_percent IS NOT NULL OR COALESCE(ii.amount, 0) > 0)
  `);

  await query(
    `ALTER TABLE invoice_items ADD COLUMN IF NOT EXISTS returned_quantity NUMERIC(14,2) NOT NULL DEFAULT 0`
  );

  await query(`
    CREATE TABLE IF NOT EXISTS invoice_returns (
      id SERIAL PRIMARY KEY,
      invoice_id INTEGER NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
      return_date DATE NOT NULL DEFAULT CURRENT_DATE,
      notes TEXT DEFAULT '',
      created_by_user_id INTEGER,
      created_by_name VARCHAR(255) DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await query(`CREATE INDEX IF NOT EXISTS idx_invoice_returns_invoice ON invoice_returns(invoice_id)`);

  await query(`
    CREATE TABLE IF NOT EXISTS invoice_item_returns (
      id SERIAL PRIMARY KEY,
      invoice_return_id INTEGER NOT NULL REFERENCES invoice_returns(id) ON DELETE CASCADE,
      invoice_item_id INTEGER NOT NULL REFERENCES invoice_items(id) ON DELETE CASCADE,
      return_quantity NUMERIC(14,2) NOT NULL,
      unit_price_snapshot NUMERIC(14,2) NOT NULL DEFAULT 0,
      return_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
      description_snapshot TEXT DEFAULT '',
      unit_snapshot VARCHAR(50) DEFAULT '',
      service_id INTEGER,
      service_code_snapshot VARCHAR(100) DEFAULT '',
      service_name_snapshot VARCHAR(255) DEFAULT '',
      cost_price_snapshot NUMERIC(14,2),
      markup_percent_snapshot NUMERIC(8,2),
      selling_price_snapshot NUMERIC(14,2),
      margin_amount_snapshot NUMERIC(14,2),
      admin_fee_reversal_snapshot NUMERIC(14,2),
      discount_reversal_snapshot NUMERIC(14,2),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await query(
    `CREATE INDEX IF NOT EXISTS idx_invoice_item_returns_item ON invoice_item_returns(invoice_item_id)`
  );
  await query(
    `CREATE INDEX IF NOT EXISTS idx_invoice_item_returns_return ON invoice_item_returns(invoice_return_id)`
  );

  await query(`
    CREATE TABLE IF NOT EXISTS doctors (
      id SERIAL PRIMARY KEY,
      code VARCHAR(50) UNIQUE,
      name TEXT NOT NULL,
      department TEXT NOT NULL DEFAULT '',
      specialty TEXT NOT NULL DEFAULT '',
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await query(
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_doctors_dept_specialty_name
     ON doctors (LOWER(TRIM(department)), LOWER(TRIM(specialty)), LOWER(TRIM(name)))`
  );
  await query(`CREATE INDEX IF NOT EXISTS idx_doctors_specialty ON doctors(specialty)`);
  await query(`CREATE INDEX IF NOT EXISTS idx_doctors_department ON doctors(department)`);
  await query(`CREATE INDEX IF NOT EXISTS idx_doctors_active ON doctors(is_active)`);

  await query(
    `ALTER TABLE patient_daily_entries ADD COLUMN IF NOT EXISTS doctor_id INTEGER REFERENCES doctors(id) ON DELETE SET NULL`
  );
  await query(
    `ALTER TABLE patient_daily_entries ADD COLUMN IF NOT EXISTS doctor_specialty TEXT DEFAULT ''`
  );
  await query(
    `ALTER TABLE patient_daily_entries ADD COLUMN IF NOT EXISTS doctor_name_snapshot TEXT DEFAULT ''`
  );
  await query(
    `ALTER TABLE patient_daily_entries ADD COLUMN IF NOT EXISTS doctor_department_snapshot TEXT DEFAULT ''`
  );
  await query(`CREATE INDEX IF NOT EXISTS idx_daily_entries_doctor ON patient_daily_entries(doctor_id)`);

  await seedDailyChargeSections();

  await query(`
    CREATE TABLE IF NOT EXISTS financial_treatments (
      id SERIAL PRIMARY KEY,
      name VARCHAR(255) UNIQUE NOT NULL,
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await seedLookupTables();
}

async function seedDailyChargeSections() {
  const sections = [
    { code: 'accommodation', name: 'إقامة', category_code: 'ACCOMMODATION', input_type: 'amount', sort_order: 1 },
    { code: 'companion', name: 'مرافق', category_code: 'COMPANION', input_type: 'amount', sort_order: 2 },
    { code: 'nursing_point', name: 'نقطة', category_code: 'NURSING', input_type: 'amount', sort_order: 3 },
    { code: 'sessions_date', name: 'تاريخ الجلسات', input_type: 'date', sort_order: 4 },
    { code: 'sessions_detail', name: 'جلسات', input_type: 'text', sort_order: 5 },
    { code: 'sessions', name: 'إجمالي جلسات', category_code: 'PHYSIO', input_type: 'amount', sort_order: 6 },
    { code: 'supplies', name: 'مستلزمات', catalog_category: 'Supplies', input_type: 'amount', sort_order: 7 },
    { code: 'medicines', name: 'أدوية', catalog_category: 'Medicine', input_type: 'amount', sort_order: 8 },
    {
      code: 'consultant_exam',
      name: 'كشف استشاري',
      category_code: 'MEDICAL_EXAMS',
      default_service_code: 'EXAM-CONSULTANT',
      input_type: 'amount',
      sort_order: 9,
    },
    {
      code: 'specialist_exam',
      name: 'كشف أخصائي',
      category_code: 'MEDICAL_EXAMS',
      default_service_code: 'EXAM-SPECIALIST',
      input_type: 'amount',
      sort_order: 10,
    },
    { code: 'consultation_stamp', name: 'دمغة كشوفات', category_code: 'STAMPS', input_type: 'amount', sort_order: 11 },
    { code: 'analyses', name: 'تحاليل', category_code: 'LAB', input_type: 'amount', sort_order: 12 },
    { code: 'analyses_stamp', name: 'دمغة تحاليل', category_code: 'STAMPS', input_type: 'amount', sort_order: 13 },
    { code: 'xray_type', name: 'نوع الأشعة', category_code: 'RADIOLOGY', input_type: 'text', sort_order: 14 },
    { code: 'xray_total', name: 'إجمالي أشعة', category_code: 'RADIOLOGY', input_type: 'amount', sort_order: 15 },
    { code: 'xray_stamp', name: 'دمغة أشعة', category_code: 'STAMPS', input_type: 'amount', sort_order: 16 },
    { code: 'other', name: 'أخرى', category_code: 'GENERAL', input_type: 'amount', sort_order: 17 },
    { code: 'prosthetics', name: 'مصنع', category_code: 'PROSTHETICS', input_type: 'amount', sort_order: 18 },
    {
      code: 'cosmetics',
      name: 'مستحضرات تجميل',
      catalog_category: 'Cosmetics',
      input_type: 'amount',
      sort_order: 19,
    },
  ];

  for (const section of sections) {
    await query(
      `INSERT INTO daily_charge_sections (code, name, category_code, catalog_category, default_service_code, input_type, sort_order, is_active)
       VALUES ($1, $2, $3, $4, $5, $6, $7, TRUE)
       ON CONFLICT (code) DO UPDATE SET
         name = EXCLUDED.name,
         category_code = EXCLUDED.category_code,
         catalog_category = EXCLUDED.catalog_category,
         default_service_code = EXCLUDED.default_service_code,
         input_type = EXCLUDED.input_type,
         sort_order = EXCLUDED.sort_order,
         is_active = TRUE`,
      [
        section.code,
        section.name,
        section.category_code || null,
        section.catalog_category || null,
        section.default_service_code || null,
        section.input_type,
        section.sort_order,
      ]
    );
  }
}

async function seedLookupTables() {
  const stayTypes = [
    'رعاية مركزة',
    'رعاية تلطيفية',
    'جناح VIP',
    'جناح كبير مميز',
    'غرفة مميزة',
    'جناح كبير',
    'جناح صغير',
    'غرفة فردية',
    'غرفة مزدوجة',
  ];
  for (let i = 0; i < stayTypes.length; i++) {
    await query(
      `INSERT INTO stay_types (name, sort_order, is_active) VALUES ($1, $2, TRUE)
       ON CONFLICT (name) DO UPDATE SET sort_order = EXCLUDED.sort_order, is_active = TRUE`,
      [stayTypes[i], i + 1]
    );
  }

  const invoiceTypes = [
    { code: 'civil', name: 'مدني (خاص)' },
    { code: 'contracted', name: 'جهات متعاقدة' },
    { code: 'non_contracted', name: 'جهات غير متعاقدة' },
    { code: 'military', name: 'عسكري' },
  ];
  for (let i = 0; i < invoiceTypes.length; i++) {
    await query(
      `INSERT INTO invoice_types (code, name, sort_order, is_active) VALUES ($1, $2, $3, TRUE)
       ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name, sort_order = EXCLUDED.sort_order, is_active = TRUE`,
      [invoiceTypes[i].code, invoiceTypes[i].name, i + 1]
    );
  }

  const financialTreatments = [
    'مدني (خاص)',
    'جهات متعاقدة',
    'جهات غير متعاقدة',
    'عسكري',
    'تأمين صحي',
    'مجاني',
  ];
  for (let i = 0; i < financialTreatments.length; i++) {
    await query(
      `INSERT INTO financial_treatments (name, sort_order, is_active) VALUES ($1, $2, TRUE)
       ON CONFLICT (name) DO UPDATE SET sort_order = EXCLUDED.sort_order, is_active = TRUE`,
      [financialTreatments[i], i + 1]
    );
  }

  const paymentMethods = [
    { code: 'cash', name: 'دفع نقدي', accepts_amount: true },
    { code: 'bank_transfer', name: 'تحويل بنكي', accepts_amount: true },
    { code: 'check', name: 'شيك مقبول الدفع', accepts_amount: true },
    { code: 'patient_credit', name: 'خصم من رصيد المريض', accepts_amount: true },
    { code: 'multi', name: 'دفع بأكثر من طريقة', accepts_amount: false },
  ];
  for (let i = 0; i < paymentMethods.length; i++) {
    await query(
      `INSERT INTO payment_methods (code, name, accepts_amount, sort_order, is_active)
       VALUES ($1, $2, $3, $4, TRUE)
       ON CONFLICT (code) DO UPDATE SET
         name = EXCLUDED.name,
         accepts_amount = EXCLUDED.accepts_amount,
         sort_order = EXCLUDED.sort_order,
         is_active = TRUE`,
      [paymentMethods[i].code, paymentMethods[i].name, paymentMethods[i].accepts_amount, i + 1]
    );
  }

  const exclusionCount = await query('SELECT COUNT(*)::int AS c FROM discount_exclusion_items');
  if (exclusionCount.rows[0].c === 0) {
    const exclusions = [
      'الأدوية',
      'المستلزمات الطبية',
      'الجهات الحكومية',
      'المصروفات الإدارية',
      'أجر الطبيب',
      'أجر التخدير في التدخلات الجراحية',
    ];
    for (let i = 0; i < exclusions.length; i++) {
      await query(
        'INSERT INTO discount_exclusion_items (name, match_type, sort_order) VALUES ($1, $2, $3)',
        [exclusions[i], 'contains', i + 1]
      );
    }
  }
}

module.exports = { pool, query, withTransaction, initDatabase };
