const bcrypt = require('bcryptjs');
const { query } = require('../database/db');

const ROLES = {
  admin: { label: 'مدير النظام', level: 100 },
  user: { label: 'مستخدم', level: 50 },
};

const PERMISSIONS = {
  admin: ['invoices.*', 'reports.*', 'settings.*', 'users.*'],
  user: ['invoices.create', 'invoices.edit', 'invoices.view', 'reports.view'],
};

function normalizeRole(role) {
  if (role === 'admin') return 'admin';
  return 'user';
}

function roleHasPermission(role, permission) {
  const normalized = normalizeRole(role);
  const perms = PERMISSIONS[normalized] || [];
  if (perms.includes('*')) return true;
  if (perms.includes(permission)) return true;
  const [group] = permission.split('.');
  if (perms.includes(`${group}.*`)) return true;
  return false;
}

function canAccess(role, permission) {
  return roleHasPermission(role, permission);
}

async function findUserByUsername(username) {
  const { rows } = await query(
    'SELECT * FROM users WHERE username = $1 AND is_active = TRUE',
    [username.toLowerCase().trim()]
  );
  return rows[0] || null;
}

async function findUserById(id) {
  const { rows } = await query('SELECT id, username, full_name, role, is_active, created_at, last_login FROM users WHERE id = $1', [id]);
  return rows[0] || null;
}

async function verifyPassword(user, password) {
  return bcrypt.compare(password, user.password_hash);
}

async function login(username, password) {
  const user = await findUserByUsername(username);
  if (!user) return null;
  const ok = await verifyPassword(user, password);
  if (!ok) return null;
  await query('UPDATE users SET last_login = NOW() WHERE id = $1', [user.id]);
  return sanitizeUser(user);
}

function sanitizeUser(user) {
  const role = normalizeRole(user.role);
  return {
    id: user.id,
    username: user.username,
    full_name: user.full_name,
    role,
    role_label: ROLES[role]?.label || role,
    permissions: PERMISSIONS[role] || [],
  };
}

async function listUsers() {
  const { rows } = await query(
    'SELECT id, username, full_name, role, is_active, created_at, last_login FROM users ORDER BY id'
  );
  return rows.map((u) => {
    const role = normalizeRole(u.role);
    return { ...u, role, role_label: ROLES[role]?.label || role };
  });
}

async function createUser(data) {
  const username = String(data.username || '').toLowerCase().trim();
  const password = String(data.password || '');
  const role = normalizeRole(data.role || 'user');

  if (!username || password.length < 6) {
    throw new Error('اسم المستخدم وكلمة المرور (6 أحرف على الأقل) مطلوبان');
  }
  if (!ROLES[role]) throw new Error('الصلاحية غير صالحة');

  const hash = await bcrypt.hash(password, 10);
  const { rows } = await query(
    `INSERT INTO users (username, password_hash, full_name, role) VALUES ($1, $2, $3, $4) RETURNING id, username, full_name, role, is_active, created_at`,
    [username, hash, data.full_name || '', role]
  );
  return { ...rows[0], role_label: ROLES[rows[0].role]?.label };
}

async function updateUser(id, data, actorRole) {
  const fields = [];
  const params = [id];
  let i = 2;

  if (data.full_name !== undefined) {
    fields.push(`full_name = $${i++}`);
    params.push(data.full_name);
  }
  if (data.role !== undefined) {
    const role = normalizeRole(data.role);
    if (!ROLES[role]) throw new Error('الصلاحية غير صالحة');
    if (normalizeRole(actorRole) !== 'admin') throw new Error('فقط مدير النظام يغير الصلاحيات');
    fields.push(`role = $${i++}`);
    params.push(role);
  }
  if (data.is_active !== undefined) {
    fields.push(`is_active = $${i++}`);
    params.push(!!data.is_active);
  }
  if (data.password) {
    if (String(data.password).length < 6) throw new Error('كلمة المرور 6 أحرف على الأقل');
    fields.push(`password_hash = $${i++}`);
    params.push(await bcrypt.hash(data.password, 10));
  }

  if (!fields.length) throw new Error('لا توجد بيانات للتحديث');

  const { rows } = await query(
    `UPDATE users SET ${fields.join(', ')} WHERE id = $1 RETURNING id, username, full_name, role, is_active, created_at, last_login`,
    params
  );
  if (!rows.length) throw new Error('المستخدم غير موجود');
  return { ...rows[0], role_label: ROLES[rows[0].role]?.label };
}

async function deleteUser(id) {
  const { rowCount } = await query('DELETE FROM users WHERE id = $1 AND username <> $2', [id, 'admin']);
  return rowCount > 0;
}

async function seedAdminUser() {
  const { rows } = await query('SELECT COUNT(*)::int AS c FROM users');
  if (rows[0].c > 0) return;

  const hash = await bcrypt.hash(process.env.ADMIN_PASSWORD || 'Admin@2026', 10);
  await query(
    `INSERT INTO users (username, password_hash, full_name, role) VALUES ($1, $2, $3, $4)`,
    ['admin', hash, 'مدير النظام', 'admin']
  );
  console.log('👤 Default admin created: admin / Admin@2026');
}

module.exports = {
  ROLES,
  PERMISSIONS,
  normalizeRole,
  canAccess,
  login,
  findUserById,
  listUsers,
  createUser,
  updateUser,
  deleteUser,
  seedAdminUser,
  sanitizeUser,
};
