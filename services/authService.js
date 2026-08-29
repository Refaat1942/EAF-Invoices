const bcrypt = require('bcryptjs');
const { query } = require('../database/db');

const ROLES = {
  admin: { label: 'مدير النظام', level: 100 },
  reviewer: { label: 'مراجع مالي', level: 75 },
  user: { label: 'مستخدم', level: 50 },
};

const PERMISSION_CATALOG = [
  { key: 'invoices.view', label: 'عرض الفواتير', description: 'رؤية قائمة الفواتير وتفاصيلها', group: 'الفواتير' },
  { key: 'invoices.create', label: 'إنشاء فاتورة', description: 'إنشاء فاتورة جديدة وحفظها مؤقتًا', group: 'الفواتير' },
  { key: 'invoices.edit', label: 'تعديل فاتورة', description: 'تعديل المدفوعات والمرتجعات على الفواتير غير المعتمدة', group: 'الفواتير' },
  {
    key: 'invoices.edit_original',
    label: 'تعديل الفاتورة الأصلية',
    description: 'تعديل بنود ومحتوى الفاتورة (المسؤول فقط)',
    group: 'الفواتير',
  },
  { key: 'invoices.delete', label: 'حذف فاتورة', description: 'حذف الفواتير (مسودة أو معتمدة)', group: 'الفواتير' },
  { key: 'invoices.approve', label: 'اعتماد فاتورة', description: 'المراجعة النهائية وإصدار الرقم التسلسلي', group: 'الفواتير' },
  { key: 'invoices.submit', label: 'إرسال للمراجعة', description: 'إرسال الفاتورة للمراجع المالي', group: 'الفواتير' },
  { key: 'reports.view', label: 'عرض التقارير', description: 'رؤية التقارير والإحصائيات', group: 'التقارير' },
  { key: 'reports.export', label: 'تصدير Excel', description: 'تحميل التقارير بصيغة Excel', group: 'التقارير' },
  { key: 'settings.*', label: 'إدارة الإعدادات', description: 'أنواع الفواتير، الإقامة، الجهات، الشعار', group: 'الإعدادات' },
  { key: 'users.*', label: 'إدارة المستخدمين', description: 'إضافة وتعديل وحذف المستخدمين', group: 'المستخدمين' },
  { key: 'patients.view', label: 'عرض أرصدة المرضى', description: 'رؤية رصيد حساب المريض', group: 'المرضى' },
  { key: 'patients.manage', label: 'إدارة أرصدة المرضى', description: 'تعديل رصيد حساب المريض', group: 'المرضى' },
  { key: 'daily_charges.view', label: 'عرض الحركة اليومية', description: 'رؤية واستعراض حركة المريض اليومية', group: 'الحركة اليومية' },
  { key: 'daily_charges.manage', label: 'تسجيل الحركة اليومية', description: 'إدخال وتعديل حركة المريض اليومية', group: 'الحركة اليومية' },
];

const PERMISSIONS = {
  admin: PERMISSION_CATALOG.map((p) => p.key),
  reviewer: [
    'invoices.view',
    'invoices.approve',
    'reports.view',
    'reports.export',
    'patients.view',
    'daily_charges.view',
  ],
  user: [
    'invoices.view',
    'invoices.create',
    'invoices.edit',
    'invoices.submit',
    'reports.view',
    'daily_charges.view',
    'daily_charges.manage',
  ],
};

function normalizeRole(role) {
  if (role === 'admin') return 'admin';
  if (role === 'reviewer') return 'reviewer';
  return 'user';
}

function parseCustomPermissions(raw) {
  if (!raw) return null;
  if (Array.isArray(raw)) return raw.filter(Boolean);
  try {
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    return Array.isArray(parsed) ? parsed.filter(Boolean) : null;
  } catch {
    return null;
  }
}

function getRoleDefaultPermissions(role) {
  return PERMISSIONS[normalizeRole(role)] || PERMISSIONS.user;
}

function getUserPermissions(user) {
  const custom = parseCustomPermissions(user?.custom_permissions);
  if (custom && custom.length) return custom;
  return getRoleDefaultPermissions(user?.role);
}

function permissionsInclude(perms, permission) {
  if (perms.includes('*')) return true;
  if (perms.includes(permission)) return true;
  const [group] = permission.split('.');
  if (perms.includes(`${group}.*`)) return true;
  return false;
}

function roleHasPermission(role, permission) {
  return permissionsInclude(getRoleDefaultPermissions(role), permission);
}

function userHasPermission(user, permission) {
  if (!user) return false;
  return permissionsInclude(getUserPermissions(user), permission);
}

function canAccess(userOrRole, permission) {
  if (typeof userOrRole === 'string') return roleHasPermission(userOrRole, permission);
  return userHasPermission(userOrRole, permission);
}

async function findUserByUsername(username) {
  const { rows } = await query(
    'SELECT * FROM users WHERE username = $1 AND is_active = TRUE',
    [username.toLowerCase().trim()]
  );
  return rows[0] || null;
}

async function findUserById(id) {
  const { rows } = await query(
    'SELECT id, username, full_name, role, custom_permissions, is_active, created_at, last_login FROM users WHERE id = $1',
    [id]
  );
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
  const permissions = getUserPermissions(user);
  return {
    id: user.id,
    username: user.username,
    full_name: user.full_name,
    role,
    role_label: ROLES[role]?.label || role,
    permissions,
    custom_permissions: parseCustomPermissions(user.custom_permissions) || [],
  };
}

async function listUsers() {
  const { rows } = await query(
    'SELECT id, username, full_name, role, custom_permissions, is_active, created_at, last_login FROM users ORDER BY id'
  );
  return rows.map((u) => {
    const role = normalizeRole(u.role);
    const permissions = getUserPermissions(u);
    return {
      ...u,
      role,
      role_label: ROLES[role]?.label || role,
      permissions,
      custom_permissions: parseCustomPermissions(u.custom_permissions) || [],
    };
  });
}

function validatePermissionsList(list) {
  if (!list) return null;
  const allowed = new Set(PERMISSION_CATALOG.map((p) => p.key));
  const cleaned = [...new Set(list.filter((p) => allowed.has(p)))];
  return cleaned;
}

async function createUser(data) {
  const username = String(data.username || '').toLowerCase().trim();
  const password = String(data.password || '');
  const role = normalizeRole(data.role || 'user');

  if (!username || password.length < 6) {
    throw new Error('اسم المستخدم وكلمة المرور (6 أحرف على الأقل) مطلوبان');
  }
  if (!ROLES[role]) throw new Error('الصلاحية غير صالحة');

  const customPermissions = validatePermissionsList(data.custom_permissions);
  const hash = await bcrypt.hash(password, 10);
  const { rows } = await query(
    `INSERT INTO users (username, password_hash, full_name, role, custom_permissions)
     VALUES ($1, $2, $3, $4, $5::jsonb)
     RETURNING id, username, full_name, role, custom_permissions, is_active, created_at`,
    [username, hash, data.full_name || '', role, JSON.stringify(customPermissions || [])]
  );
  return sanitizeUser(rows[0]);
}

async function updateUser(id, data, actor) {
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
    if (!userHasPermission(actor, 'users.*')) throw new Error('فقط مدير النظام يغير الصلاحيات');
    fields.push(`role = $${i++}`);
    params.push(role);
  }
  if (data.custom_permissions !== undefined) {
    if (!userHasPermission(actor, 'users.*')) throw new Error('فقط مدير النظام يغير الصلاحيات');
    const cleaned = validatePermissionsList(data.custom_permissions) || [];
    fields.push(`custom_permissions = $${i++}::jsonb`);
    params.push(JSON.stringify(cleaned));
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
    `UPDATE users SET ${fields.join(', ')} WHERE id = $1
     RETURNING id, username, full_name, role, custom_permissions, is_active, created_at, last_login`,
    params
  );
  if (!rows.length) throw new Error('المستخدم غير موجود');
  return sanitizeUser(rows[0]);
}

async function deleteUser(id) {
  const { rowCount } = await query('DELETE FROM users WHERE id = $1 AND username <> $2', [id, 'admin']);
  return rowCount > 0;
}

function isProductionEnv() {
  return process.env.NODE_ENV === 'production';
}

function resolveInitialAdminPassword() {
  const password = String(process.env.ADMIN_PASSWORD || '').trim();
  if (isProductionEnv()) {
    if (!password || password.length < 12) {
      throw new Error(
        'First production setup requires ADMIN_PASSWORD (12+ characters) in the server environment before creating the admin user.'
      );
    }
    return password;
  }
  if (!password) {
    console.warn('[auth] ADMIN_PASSWORD not set — using development default. Do not use in production.');
    return 'Admin@2026';
  }
  return password;
}

async function seedAdminUser() {
  const { rows } = await query('SELECT COUNT(*)::int AS c FROM users');
  if (rows[0].c > 0) return;

  const password = resolveInitialAdminPassword();
  const hash = await bcrypt.hash(password, 10);
  await query(
    `INSERT INTO users (username, password_hash, full_name, role, custom_permissions) VALUES ($1, $2, $3, $4, $5::jsonb)`,
    ['admin', hash, 'مدير النظام', 'admin', JSON.stringify([])]
  );
  if (isProductionEnv()) {
    console.log('👤 Initial admin user created (username: admin). Password was taken from ADMIN_PASSWORD.');
  } else {
    console.log('👤 Default admin created (username: admin). Set ADMIN_PASSWORD for a custom password.');
  }
}

module.exports = {
  ROLES,
  PERMISSIONS,
  PERMISSION_CATALOG,
  normalizeRole,
  canAccess,
  userHasPermission,
  getUserPermissions,
  getRoleDefaultPermissions,
  login,
  findUserById,
  listUsers,
  createUser,
  updateUser,
  deleteUser,
  seedAdminUser,
  sanitizeUser,
};
