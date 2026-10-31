-- IMPORT-SOURCES: after restoring a full backup, keep only the data sources
-- (price lists, catalog items, doctors, stay types, settings, users...) and remove all cases.
-- No source table references these tables, so no CASCADE: an unexpected dependency stops
-- the import with an error instead of deleting more than intended.
BEGIN;

TRUNCATE TABLE
  invoice_item_returns,
  invoice_returns,
  invoice_payment_amounts,
  invoice_payments,
  invoice_stay_entries,
  invoice_items,
  patient_operations,
  patient_daily_entry_history,
  patient_daily_entry_lines,
  patient_transactions,
  patient_stay_excluded_dates,
  patient_room_assignments,
  patient_daily_entries,
  invoices,
  patients,
  audit_logs,
  system_alerts
RESTART IDENTITY;

-- Numbering starts again from 1 (invoice serials, patient file numbers).
TRUNCATE TABLE invoice_serial_counters, invoice_serial_counter, patient_file_counter;

-- Backup status belonged to the online server.
DELETE FROM app_settings WHERE key LIKE 'backup\_%';

COMMIT;
