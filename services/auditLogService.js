const { query } = require('../database/db');

function pickActor(user) {
  if (!user) return { user_id: null, user_name: 'النظام' };
  return {
    user_id: user.id || null,
    user_name: String(user.full_name || user.username || 'مستخدم').trim(),
  };
}

function safeJson(value) {
  if (!value || typeof value !== 'object') return {};
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return {};
  }
}

async function writeAuditLog(entry = {}, client = null) {
  const run = client ? client.query.bind(client) : query;
  const actor = pickActor(entry.user);
  await run(
    `INSERT INTO audit_logs (
       user_id, user_name, action, entity_type, entity_id, entity_label,
       severity, ip_address, request_id, details
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb)`,
    [
      actor.user_id,
      actor.user_name,
      String(entry.action || 'unknown').slice(0, 64),
      String(entry.entity_type || 'system').slice(0, 64),
      entry.entity_id != null ? String(entry.entity_id) : null,
      String(entry.entity_label || '').slice(0, 500),
      String(entry.severity || 'info').slice(0, 16),
      entry.ip_address ? String(entry.ip_address).slice(0, 64) : null,
      entry.request_id ? String(entry.request_id).slice(0, 64) : null,
      JSON.stringify(safeJson(entry.details)),
    ]
  );
}

async function listAuditLogs(filters = {}) {
  const limit = Math.min(Math.max(Number(filters.limit) || 50, 1), 200);
  const offset = Math.max(Number(filters.offset) || 0, 0);
  const params = [];
  const where = [];

  if (filters.action) {
    params.push(String(filters.action));
    where.push(`action = $${params.length}`);
  }
  if (filters.entity_type) {
    params.push(String(filters.entity_type));
    where.push(`entity_type = $${params.length}`);
  }
  if (filters.entity_id) {
    params.push(String(filters.entity_id));
    where.push(`entity_id = $${params.length}`);
  }
  if (filters.user_id) {
    params.push(Number(filters.user_id));
    where.push(`user_id = $${params.length}`);
  }
  if (filters.from) {
    params.push(filters.from);
    where.push(`created_at >= $${params.length}::timestamptz`);
  }
  if (filters.to) {
    params.push(filters.to);
    where.push(`created_at <= $${params.length}::timestamptz`);
  }
  if (filters.q) {
    params.push(`%${String(filters.q).trim()}%`);
    where.push(
      `(entity_label ILIKE $${params.length} OR user_name ILIKE $${params.length} OR details::text ILIKE $${params.length})`
    );
  }

  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const countRes = await query(`SELECT COUNT(*)::int AS total FROM audit_logs ${whereSql}`, params);
  params.push(limit, offset);
  const { rows } = await query(
    `SELECT id, created_at, user_id, user_name, action, entity_type, entity_id, entity_label, severity, details
     FROM audit_logs
     ${whereSql}
     ORDER BY created_at DESC, id DESC
     LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params
  );

  return {
    rows,
    total: countRes.rows[0]?.total || 0,
    limit,
    offset,
  };
}

module.exports = {
  writeAuditLog,
  listAuditLogs,
  pickActor,
};
