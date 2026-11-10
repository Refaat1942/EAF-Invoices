/**
 * Activity log: every successful save / edit / delete a user makes is written to
 * audit_logs with WHAT was done, on WHICH screen and for WHICH patient / invoice.
 * The browser sends the screen it was on in the X-EAF-Screen header (URI-encoded).
 */
const { query } = require('../database/db');
const { writeAuditLog } = require('../services/auditLogService');
const { inferBundleKey, getBundleLabel } = require('../services/dailySectionBundles');

const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

// Calls that change nothing, or already write their own detailed audit entry.
const SKIP = [
  /^\/api\/auth\//,
  /^\/api\/invoices\/(calculate|preview)$/,
  /^\/api\/invoices\/\d+\/(approve|reopen|return|submit)$/,
  /^\/api\/audit\//,
  /^\/api\/patients\/balance$/,
  // Automatic background recalculation when a patient is opened — not a user action.
  /^\/api\/daily-charges\/reconcile-(patient|all)$/,
  /^\/api\/daily-charges\/sync-room-insurance$/,
];

// [method, path regex, action code, Arabic description, default screen]
const ROUTES = [
  ['POST', /^\/api\/daily-charges\/entries\/batch$/, 'daily.save', 'حفظ حركة يومية', 'الحركة اليومية'],
  ['POST', /^\/api\/daily-charges\/entries$/, 'daily.save', 'حفظ حركة يومية', 'الحركة اليومية'],
  ['DELETE', /^\/api\/daily-charges\/entries\/stay-by-date$/, 'daily.stay_delete', 'حذف يوم إقامة', 'إقامة ورعاية'],
  ['DELETE', /^\/api\/daily-charges\/entries\/\d+$/, 'daily.delete', 'حذف حركة يومية', 'الحركة اليومية'],
  ['POST', /^\/api\/daily-charges\/open-stay$/, 'daily.open_stay', 'فتح إقامة / تسجيل دخول مريض', 'تسجيل المريض'],
  ['POST', /^\/api\/daily-charges\/change-room$/, 'daily.change_room', 'تغيير الغرفة', 'إقامة ورعاية'],
  ['POST', /^\/api\/daily-charges\/convert-to-internal$/, 'daily.convert_internal', 'تحويل المريض إلى داخلي', 'الحركة اليومية'],
  ['POST', /^\/api\/daily-charges\/sync-room-insurance$/, 'daily.sync_room', 'تحديث تأمين الغرفة', 'إقامة ورعاية'],
  ['POST', /^\/api\/daily-charges\/stay\/batch-post$/, 'daily.stay_post', 'ترحيل أيام الإقامة', 'إقامة ورعاية'],
  ['POST', /^\/api\/daily-charges\/operations$/, 'daily.operations', 'حفظ العمليات', 'العمليات'],
  ['POST', /^\/api\/daily-charges\/free-items$/, 'daily.free_items', 'حفظ البنود الحرة', 'البنود الحرة'],
  ['POST', /^\/api\/daily-charges\/reconcile-patient$/, 'daily.reconcile', 'مطابقة حركة المريض', 'الحركة اليومية'],
  ['POST', /^\/api\/daily-charges\/reconcile-all$/, 'daily.reconcile_all', 'مطابقة كل المرضى', 'الحركة اليومية'],
  ['POST', /^\/api\/invoices$/, 'invoice.save', 'حفظ الفاتورة', 'الفاتورة'],
  ['PUT', /^\/api\/invoices\/\d+$/, 'invoice.edit', 'تعديل الفاتورة', 'الفاتورة'],
  ['POST', /^\/api\/invoices\/\d+\/submit$/, 'invoice.submit', 'إرسال الفاتورة للمراجعة', 'الفاتورة'],
  ['POST', /^\/api\/invoices\/\d+\/returns$/, 'invoice.refund', 'تسجيل مرتجع على الفاتورة', 'الفاتورة'],
  ['DELETE', /^\/api\/invoices\/\d+$/, 'invoice.delete_draft', 'حذف فاتورة', 'قائمة الفواتير'],
  ['POST', /^\/api\/patients\/upsert$/, 'patient.save', 'حفظ بيانات مريض', 'تسجيل المريض'],
  [null, /^\/api\/settings\//, 'settings.change', 'تعديل الإعدادات', 'الإعدادات'],
  [null, /^\/api\/pricing\//, 'pricing.change', 'تعديل الأسعار', 'الإعدادات — الأسعار'],
  [null, /^\/api\/daily-charges\/catalog/, 'catalog.change', 'تعديل كتالوج الأصناف', 'الإعدادات — الأصناف'],
  [null, /^\/api\/doctors/, 'doctors.change', 'تعديل الأطباء', 'الإعدادات — الأطباء'],
  [null, /^\/api\/users/, 'users.change', 'تعديل المستخدمين', 'الإعدادات — المستخدمين'],
];

const CALC_INPUT_ACTIONS = new Set(['settings.change', 'pricing.change', 'catalog.change', 'doctors.change', 'patient.save']);

const VERB = { POST: 'إضافة', PUT: 'تعديل', PATCH: 'تعديل', DELETE: 'حذف' };

function matchRoute(method, path) {
  for (const [m, re, action, label, screen] of ROUTES) {
    if ((m === null || m === method) && re.test(path)) {
      const verb = m === null ? ` (${VERB[method] || method})` : '';
      return { action, label: `${label}${verb}`, screen };
    }
  }
  return { action: `${method.toLowerCase()}.other`, label: `${VERB[method] || method} بيانات`, screen: '' };
}

function decodeScreen(raw) {
  if (!raw) return '';
  try {
    return decodeURIComponent(String(raw)).slice(0, 120);
  } catch {
    return '';
  }
}

function sectionsOfLines(lines) {
  const set = new Set();
  for (const l of Array.isArray(lines) ? lines : []) {
    if (!l || !l.section_code) continue;
    set.add(getBundleLabel(inferBundleKey(l.section_code)));
  }
  return [...set];
}

function summarizeBody(body = {}) {
  const out = {};
  const b = body && typeof body === 'object' ? body : {};
  const fn = b.file_number || b.patient?.file_number;
  if (fn) out.file_number = String(fn).trim();
  const name = b.patient_name || b.name || b.patient?.name;
  if (name) out.patient_name = String(name).trim();
  const entries = Array.isArray(b.entries) ? b.entries : b.lines ? [b] : [];
  if (entries.length) {
    const dates = [...new Set(entries.map((e) => e.entry_date).filter(Boolean).map(String))].sort();
    if (dates.length) out.dates = dates;
    const sections = sectionsOfLines(entries.flatMap((e) => e.lines || []));
    if (sections.length) out.sections = sections;
    out.lines_count = entries.reduce((n, e) => n + (Array.isArray(e.lines) ? e.lines.length : 0), 0);
  }
  if (Array.isArray(b.items)) out.items_count = b.items.length;
  if (b.entry_date && !out.dates) out.dates = [String(b.entry_date)];
  if (b.room_number || b.new_room_number) out.room = String(b.new_room_number || b.room_number);
  if (b.serial_number) out.serial_number = String(b.serial_number);
  if (b.name && !out.patient_name && !fn) out.name = String(b.name).slice(0, 120);
  return out;
}

// ------------------------------------------------------------------ what exactly changed
// Snapshot of a patient's daily lines on the given dates, compared before / after the save,
// so the log says «أضاف تحليل حساب × 1» or «عدّل كمية …» instead of just «حفظ».
async function snapshotDailyLines(fileNumber, dates) {
  if (!fileNumber || !Array.isArray(dates) || !dates.length) return null;
  const { rows } = await query(
    `SELECT e.entry_date::text AS d, l.section_code, COALESCE(l.description, '') AS description,
            COALESCE(l.extra_text, '') AS extra_text, l.quantity::float AS qty, l.amount::float AS amount
     FROM patient_daily_entries e
     JOIN patients p ON p.id = e.patient_id
     JOIN patient_daily_entry_lines l ON l.entry_id = e.id
     WHERE TRIM(p.file_number) = TRIM($1) AND e.entry_date = ANY($2::date[])`,
    [String(fileNumber), dates]
  );
  return rows.filter((r) => !String(r.extra_text).startsWith('stamp_for:') && !/stamp/.test(r.section_code));
}

function lineKey(r) {
  return `${r.d}|${r.section_code}|${r.description}`;
}

function lineName(r) {
  const section = getBundleLabel(inferBundleKey(r.section_code));
  return `${section}: ${r.description || r.section_code}`;
}

function fmtNum(n) {
  const v = Math.round(Number(n || 0) * 100) / 100;
  return String(v);
}

function diffDailyLines(before, after) {
  if (!before || !after) return null;
  const group = (rows) => {
    const m = new Map();
    for (const r of rows) {
      const k = lineKey(r);
      const g = m.get(k) || { ...r, qty: 0, amount: 0 };
      g.qty += Number(r.qty || 0);
      g.amount += Number(r.amount || 0);
      m.set(k, g);
    }
    return m;
  };
  const a = group(before);
  const b = group(after);
  const changes = [];
  for (const [k, r] of b) {
    const old = a.get(k);
    if (!old) changes.push(`أضاف ${lineName(r)} × ${fmtNum(r.qty)} = ${fmtNum(r.amount)}`);
    else if (Math.abs(old.qty - r.qty) > 0.001 || Math.abs(old.amount - r.amount) > 0.009) {
      changes.push(
        `عدّل ${lineName(r)}: الكمية ${fmtNum(old.qty)} ← ${fmtNum(r.qty)}، المبلغ ${fmtNum(old.amount)} ← ${fmtNum(r.amount)}`
      );
    }
  }
  for (const [k, r] of a) {
    if (!b.has(k)) changes.push(`حذف ${lineName(r)} × ${fmtNum(r.qty)} = ${fmtNum(r.amount)}`);
  }
  return changes.slice(0, 60);
}

function datesOfBody(body = {}, ctx = {}) {
  const b = body && typeof body === 'object' ? body : {};
  const list = Array.isArray(b.entries) ? b.entries.map((e) => e.entry_date) : [b.entry_date];
  const today = new Date().toISOString().slice(0, 10);
  const out = [...list, ...(ctx.dates || [])].filter(Boolean).map((d) => String(d).slice(0, 10));
  if (!out.length) out.push(today);
  return [...new Set(out)];
}

const DIFF_PATHS = [
  /^\/api\/daily-charges\/entries(\/batch)?$/,
  /^\/api\/daily-charges\/entries\/\d+$/,
  /^\/api\/daily-charges\/entries\/stay-by-date$/,
  /^\/api\/daily-charges\/change-room$/,
  /^\/api\/daily-charges\/open-stay$/,
];

// Things we must read BEFORE the request runs (a deleted row is gone afterwards).
async function loadBeforeContext(method, path, req) {
  try {
    let m = method === 'DELETE' && path.match(/^\/api\/daily-charges\/entries\/(\d+)$/);
    if (m) {
      const { rows } = await query(
        `SELECT p.file_number, p.name AS patient_name, e.entry_date::text AS entry_date,
                COALESCE(json_agg(l.section_code) FILTER (WHERE l.id IS NOT NULL), '[]') AS codes
         FROM patient_daily_entries e
         JOIN patients p ON p.id = e.patient_id
         LEFT JOIN patient_daily_entry_lines l ON l.entry_id = e.id
         WHERE e.id = $1 GROUP BY p.file_number, p.name, e.entry_date`,
        [Number(m[1])]
      );
      const r = rows[0];
      if (r) {
        return {
          file_number: r.file_number,
          patient_name: r.patient_name,
          dates: [r.entry_date],
          sections: sectionsOfLines((r.codes || []).map((c) => ({ section_code: c }))),
        };
      }
      return {};
    }
    m = path.match(/^\/api\/invoices\/(\d+)(\/submit|\/returns)?$/);
    if (m) {
      const { rows } = await query(
        `SELECT id, serial_number, file_number, patient_name, status FROM invoices WHERE id = $1`,
        [Number(m[1])]
      );
      const r = rows[0];
      if (r) {
        return {
          invoice_id: r.id,
          serial_number: r.serial_number || '',
          file_number: r.file_number,
          patient_name: r.patient_name,
          status_before: r.status,
        };
      }
    }
    if (method === 'DELETE' && path === '/api/daily-charges/entries/stay-by-date') {
      return { file_number: req.query?.file_number, dates: [req.query?.entry_date].filter(Boolean) };
    }
    const fn = String(req.body?.file_number || req.query?.file_number || '').trim();
    if (fn) {
      const { rows } = await query(`SELECT name FROM patients WHERE TRIM(file_number) = $1 LIMIT 1`, [fn]);
      if (rows[0]?.name) return { file_number: fn, patient_name: rows[0].name };
    }
  } catch {
    /* the log must never block the work */
  }
  return {};
}

function activityAuditMiddleware(req, res, next) {
  const method = req.method;
  const path = String(req.originalUrl || req.url || '').split('?')[0];
  if (MUTATING.has(method) && path === '/api/patients/balance') {
    // A balance change alters the credit applied on the open invoice.
    res.on('finish', () => {
      query(
        `INSERT INTO app_settings (key, value, updated_at) VALUES ('calc_inputs_changed_at', NOW()::text, NOW())
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`
      ).catch(() => {});
    });
  }
  if (!MUTATING.has(method) || !path.startsWith('/api/') || SKIP.some((re) => re.test(path))) {
    return next();
  }
  const user = req.session?.user;
  if (!user) return next();

  // Settings / prices / catalog changed: invoices must be fully recalculated the next
  // time their patient is opened (see patientReconcileService).
  // Marked before AND after the change, so a recalculation racing with it never counts
  // as up to date.
  const route0 = matchRoute(method, path);
  const marksCalcInputs = CALC_INPUT_ACTIONS.has(route0.action);
  const markCalcInputs = () =>
    query(
      `INSERT INTO app_settings (key, value, updated_at) VALUES ('calc_inputs_changed_at', NOW()::text, NOW())
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`
    ).catch(() => {});
  if (marksCalcInputs) res.on('finish', () => void markCalcInputs());
  const wantsDiff = DIFF_PATHS.some((re) => re.test(path));
  const marked = marksCalcInputs ? markCalcInputs() : Promise.resolve();
  const before = marked.then(() => loadBeforeContext(method, path, req)).then(async (ctx) => {
    if (!wantsDiff) return { ctx };
    const fileNumber = ctx.file_number || req.body?.file_number || req.query?.file_number;
    const dates = datesOfBody(req.body, ctx);
    let snap = null;
    try {
      snap = await snapshotDailyLines(fileNumber, dates);
    } catch {
      snap = null;
    }
    return { ctx, fileNumber, dates, snap };
  });
  before.then(
    ({ ctx, fileNumber, dates, snap }) => {
      res.on('finish', async () => {
        if (res.statusCode >= 400) return;
        let changes = null;
        if (snap) {
          try {
            changes = diffDailyLines(snap, await snapshotDailyLines(fileNumber, dates));
          } catch {
            changes = null;
          }
        }
        const route = matchRoute(method, path);
        const screen = decodeScreen(req.headers['x-eaf-screen']) || route.screen;
        const details = { screen, ...summarizeBody(req.body), ...ctx };
        const who = [details.patient_name, details.file_number ? `ملف ${details.file_number}` : '']
          .filter(Boolean)
          .join(' — ');
        const inv = details.serial_number ? `فاتورة ${details.serial_number}` : '';
        details.action_label = route.label;
        if (changes) details.changes = changes;
        if (changes && !changes.length && route.action === 'daily.save') details.action_label = 'حفظ بدون تغيير';
        writeAuditLog({
          user,
          action: route.action,
          entity_type: details.invoice_id ? 'invoice' : details.file_number ? 'patient' : 'system',
          entity_id: details.invoice_id || details.file_number || null,
          entity_label: [who, inv].filter(Boolean).join(' | ') || route.label,
          ip_address: req.ip,
          request_id: req.requestId,
          details,
        }).catch((err) => console.error('[activity-audit]', err.message));
      });
      next();
    },
    () => next()
  );
}

module.exports = { activityAuditMiddleware, matchRoute, summarizeBody };
