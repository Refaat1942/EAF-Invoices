const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const dataDir = path.join(__dirname, '..', 'data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const dbPath = path.join(dataDir, 'invoices.db');
const db = new Database(dbPath);

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS invoice_serial_counter (
    year INTEGER PRIMARY KEY,
    last_number INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS invoices (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    serial_number TEXT UNIQUE NOT NULL,
    invoice_type TEXT NOT NULL CHECK(invoice_type IN ('civil', 'contracted', 'non_contracted', 'military')),
    patient_name TEXT DEFAULT '',
    admission_date TEXT DEFAULT '',
    discharge_date TEXT DEFAULT '',
    stay_days INTEGER DEFAULT 0,
    financial_treatment TEXT DEFAULT '',
    stay_type TEXT DEFAULT '',
    stamp_duty REAL DEFAULT 0,
    professional_fees REAL DEFAULT 0,
    items_subtotal REAL DEFAULT 0,
    admin_expenses_percent REAL DEFAULT 12,
    admin_expenses REAL DEFAULT 0,
    total_after_admin REAL DEFAULT 0,
    balance REAL DEFAULT 0,
    final_total REAL DEFAULT 0,
    cash_private REAL DEFAULT 0,
    bank_private REAL DEFAULT 0,
    cash_external REAL DEFAULT 0,
    bank_external REAL DEFAULT 0,
    total_collected REAL DEFAULT 0,
    remaining REAL DEFAULT 0,
    employee_name TEXT DEFAULT '',
    auditor_name TEXT DEFAULT '',
    captain_name TEXT DEFAULT 'نقيب / عمرو صالح محمد',
    manager_name TEXT DEFAULT 'رائد / جمال عبد الناصر - المدير المالي',
    qr_token TEXT UNIQUE NOT NULL,
    file_password TEXT DEFAULT '',
    notes TEXT DEFAULT '',
    created_at TEXT DEFAULT (datetime('now', 'localtime')),
    updated_at TEXT DEFAULT (datetime('now', 'localtime'))
  );

  CREATE TABLE IF NOT EXISTS invoice_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    invoice_id INTEGER NOT NULL,
    description TEXT DEFAULT '',
    quantity REAL DEFAULT 0,
    amount REAL DEFAULT 0,
    total REAL DEFAULT 0,
    sort_order INTEGER DEFAULT 0,
    FOREIGN KEY (invoice_id) REFERENCES invoices(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS invoice_payments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    invoice_id INTEGER NOT NULL,
    receipt_date TEXT DEFAULT '',
    receipt_number TEXT DEFAULT '',
    amount REAL DEFAULT 0,
    sort_order INTEGER DEFAULT 0,
    FOREIGN KEY (invoice_id) REFERENCES invoices(id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_invoices_serial ON invoices(serial_number);
  CREATE INDEX IF NOT EXISTS idx_invoices_type ON invoices(invoice_type);
  CREATE INDEX IF NOT EXISTS idx_invoices_created ON invoices(created_at);
  CREATE INDEX IF NOT EXISTS idx_invoices_qr ON invoices(qr_token);
`);

try {
  db.exec(`ALTER TABLE invoices ADD COLUMN file_password TEXT DEFAULT ''`);
} catch {
  /* column already exists */
}

module.exports = db;
