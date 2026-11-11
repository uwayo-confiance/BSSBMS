const express = require('express');
const bcrypt = require('bcryptjs');
const router = express.Router();
const { prisma } = require('../config/db');
const { authenticate, authorize } = require('../middleware/auth');
const { recordAuditEvent } = require('../utils/auditLog');

const managers = ['admin', 'manager'];
const defaults = {
  receipt: {
    paper_format: '80mm',
    show_cashier: true,
    show_table_number: true,
    show_payment_breakdown: true,
    show_open_table_balance: true,
    footer: '',
  },
  inventory: {
    default_low_stock_threshold: 0,
    require_adjustment_approval: true,
    track_expiry_by_default: false,
    require_batch_by_default: false,
  },
};

function isValidTimezone(value) {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

function validateConfiguration(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error('Settings configuration must be an object');
  }
  const receipt = input.receipt;
  const inventory = input.inventory;
  if (!receipt || !['80mm', 'A4'].includes(receipt.paper_format) ||
      !['show_cashier', 'show_table_number', 'show_payment_breakdown', 'show_open_table_balance']
        .every((key) => typeof receipt[key] === 'boolean') ||
      typeof receipt.footer !== 'string' || receipt.footer.length > 255) {
    throw new Error('Receipt settings are invalid');
  }
  const threshold = Number(inventory?.default_low_stock_threshold);
  if (!Number.isFinite(threshold) || threshold < 0 ||
      typeof inventory.require_adjustment_approval !== 'boolean' ||
      typeof inventory.track_expiry_by_default !== 'boolean' ||
      typeof inventory.require_batch_by_default !== 'boolean') {
    throw new Error('Inventory settings are invalid');
  }
  return {
    receipt: { ...receipt },
    inventory: { ...inventory, default_low_stock_threshold: threshold },
  };
}

function userData(user, roleName) {
  return {
    id: user.id,
    full_name: user.full_name,
    username: user.username,
    email: user.email,
    phone: user.phone,
    role_id: user.role_id,
    role: roleName || null,
    is_active: user.is_active,
    last_login: user.last_login,
    created_at: user.created_at,
  };
}

router.get('/', authenticate, authorize(...managers), async (req, res) => {
  try {
    const [business, stored] = await Promise.all([
      prisma.businesses.findFirst({ orderBy: { id: 'asc' } }),
      prisma.system_settings.findMany({ where: { key: { in: ['receipt', 'inventory'] } } }),
    ]);
    const config = { ...defaults };
    for (const setting of stored) {
      if (setting.key in config) config[setting.key] = { ...config[setting.key], ...setting.value };
    }
    res.json({
      success: true,
      data: {
        business: business || {
          name: 'Umucyo Bar', address: '', phone: '', email: '', tin: '',
          currency: 'RWF', logo_url: '', timezone: 'Africa/Kigali', receipt_footer: '',
        },
        configuration: config,
      },
    });
  } catch (err) {
    console.error('Settings lookup failed:', err);
    res.status(500).json({ success: false, message: 'Failed to load settings' });
  }
});

router.get('/receipt', authenticate, async (req, res) => {
  try {
    const [business, receipt] = await Promise.all([
      prisma.businesses.findFirst({ orderBy: { id: 'asc' } }),
      prisma.system_settings.findUnique({ where: { key: 'receipt' } }),
    ]);
    res.json({
      success: true,
      data: {
        business: business || { name: 'Umucyo Bar', currency: 'RWF' },
        receipt: { ...defaults.receipt, ...(receipt?.value || {}) },
      },
    });
  } catch (err) {
    console.error('Receipt settings lookup failed:', err);
    res.status(500).json({ success: false, message: 'Failed to load receipt settings' });
  }
});

router.put('/business', authenticate, authorize('admin'), async (req, res) => {
  const body = req.body;
  const reason = typeof body.reason === 'string' ? body.reason.trim() : '';
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  const currency = String(body.currency || '').trim().toUpperCase();
  const email = body.email == null ? '' : String(body.email).trim();
  const timezone = String(body.timezone || '');
  const logoUrl = body.logo_url == null ? '' : String(body.logo_url).trim();
  if (!name || name.length > 150 || !/^[A-Z]{3}$/.test(currency) ||
      (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) ||
      !isValidTimezone(timezone) ||
      (logoUrl && !/^https?:\/\/\S+$/i.test(logoUrl)) ||
      String(body.phone || '').length > 20 || email.length > 120 ||
      String(body.tin || '').length > 50 || String(body.address || '').length > 65535 ||
      !reason || reason.length > 1000) {
    return res.status(400).json({ success: false, message: 'Enter valid business details and a reason for the change' });
  }
  try {
    const updated = await prisma.$transaction(async (tx) => {
      const current = await tx.businesses.findFirst({ orderBy: { id: 'asc' } });
      const data = {
        name, address: String(body.address || '').trim() || null,
        phone: String(body.phone || '').trim() || null, email: email || null,
        tin: String(body.tin || '').trim() || null, currency,
        logo_url: logoUrl || null, timezone,
        receipt_footer: typeof body.receipt_footer === 'string' ? body.receipt_footer.trim().slice(0, 255) || null : null,
      };
      const business = current
        ? await tx.businesses.update({ where: { id: current.id }, data })
        : await tx.businesses.create({ data });
      await recordAuditEvent(tx, req, {
        action: 'business_settings_updated',
        entityType: 'business',
        entityId: business.id,
        reason,
        before: current ? {
          name: current.name, address: current.address, phone: current.phone,
          email: current.email, tin: current.tin, currency: current.currency,
          logo_url: current.logo_url, timezone: current.timezone, receipt_footer: current.receipt_footer,
        } : null,
        after: data,
      });
      return business;
    });
    res.json({ success: true, message: 'Business information saved', data: updated });
  } catch (err) {
    console.error('Business settings update failed:', err);
    res.status(500).json({ success: false, message: 'Failed to save business information' });
  }
});

router.put('/configuration', authenticate, authorize('admin'), async (req, res) => {
  const reason = typeof req.body.reason === 'string' ? req.body.reason.trim() : '';
  let configuration;
  try {
    configuration = validateConfiguration(req.body.configuration);
  } catch (err) {
    return res.status(400).json({ success: false, message: err.message });
  }
  if (!reason || reason.length > 1000) {
    return res.status(400).json({ success: false, message: 'A reason is required for settings changes' });
  }
  try {
    await prisma.$transaction(async (tx) => {
      for (const [key, value] of Object.entries(configuration)) {
        const existing = await tx.system_settings.findUnique({ where: { key } });
        await tx.system_settings.upsert({
          where: { key },
          create: { key, value, updated_by: req.user.id },
          update: { value, updated_by: req.user.id },
        });
        await recordAuditEvent(tx, req, {
          action: `${key}_settings_updated`,
          entityType: 'system_settings',
          entityId: null,
          reason,
          before: existing?.value || null,
          after: value,
        });
      }
    });
    res.json({ success: true, message: 'Settings saved', data: configuration });
  } catch (err) {
    console.error('Configuration update failed:', err);
    res.status(500).json({ success: false, message: 'Failed to save settings' });
  }
});

router.get('/unit-history', authenticate, authorize('admin'), async (req, res) => {
  try {
    const productId = req.query.product_id ? Number(req.query.product_id) : undefined;
    const history = await prisma.product_unit_history.findMany({
      where: productId ? { product_id: productId } : {},
      orderBy: { created_at: 'desc' },
      take: 200,
    });
    const userIds = [...new Set(history.map(({ changed_by }) => changed_by).filter(Boolean))];
    const users = await prisma.users.findMany({
      where: { id: { in: userIds } },
      select: { id: true, full_name: true, username: true },
    });
    const names = new Map(users.map((user) => [user.id, user.full_name || user.username]));
    res.json({
      success: true,
      data: history.map((entry) => ({
        ...entry,
        id: entry.id.toString(),
        actor: names.get(entry.changed_by) || 'System',
      })),
    });
  } catch (err) {
    console.error('Product unit history lookup failed:', err);
    res.status(500).json({ success: false, message: 'Failed to load conversion history' });
  }
});

router.get('/users', authenticate, authorize('admin'), async (req, res) => {
  try {
    const [users, roles] = await Promise.all([
      prisma.users.findMany({ orderBy: { full_name: 'asc' } }),
      prisma.roles.findMany({ where: { name: { in: ['admin', 'manager', 'cashier', 'stock_keeper', 'waiter'] } }, orderBy: { id: 'asc' } }),
    ]);
    const roleNames = new Map(roles.map((role) => [role.id, role.name]));
    res.json({ success: true, data: { users: users.map((user) => userData(user, roleNames.get(user.role_id))), roles } });
  } catch (err) {
    console.error('Settings users lookup failed:', err);
    res.status(500).json({ success: false, message: 'Failed to load users' });
  }
});

router.post('/users', authenticate, authorize('admin'), async (req, res) => {
  const { full_name, username, email, phone, role_id, password } = req.body;
  if (typeof full_name !== 'string' || !full_name.trim() || full_name.trim().length > 120 ||
      typeof username !== 'string' || !/^[a-zA-Z0-9._-]{3,60}$/.test(username) ||
      (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) ||
      typeof password !== 'string' || password.length < 12 || password.length > 128 ||
      !Number.isInteger(Number(role_id))) {
    return res.status(400).json({ success: false, message: 'Enter a name, valid username, role and password of at least 12 characters' });
  }
  try {
    const role = await prisma.roles.findUnique({ where: { id: Number(role_id) } });
    if (!role || !['admin', 'manager', 'cashier', 'stock_keeper', 'waiter'].includes(role.name)) {
      return res.status(400).json({ success: false, message: 'Select a supported role' });
    }
    const password_hash = await bcrypt.hash(password, 12);
    const user = await prisma.$transaction(async (tx) => {
      const created = await tx.users.create({
        data: {
          full_name: full_name.trim(), username, email: email?.trim() || null,
          phone: phone?.trim() || null, role_id: role.id, password_hash,
        },
      });
      await recordAuditEvent(tx, req, {
        action: 'user_created', entityType: 'user', entityId: created.id,
        after: { username: created.username, role: role.name },
      });
      return created;
    });
    res.status(201).json({ success: true, message: 'User created', data: userData(user, role.name) });
  } catch (err) {
    if (err.code === 'P2002') return res.status(409).json({ success: false, message: 'Username or email is already in use' });
    console.error('User creation failed:', err);
    res.status(500).json({ success: false, message: 'Failed to create user' });
  }
});

router.put('/users/:id', authenticate, authorize('admin'), async (req, res) => {
  const userId = Number(req.params.id);
  const { full_name, email, phone, role_id, is_active, new_password } = req.body;
  if (!Number.isInteger(userId) || userId < 1 ||
      typeof full_name !== 'string' || !full_name.trim() || full_name.trim().length > 120 ||
      !Number.isInteger(Number(role_id)) ||
      ![0, 1, false, true].includes(is_active)) {
    return res.status(400).json({ success: false, message: 'Enter valid user details, role and status' });
  }
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ success: false, message: 'Enter a valid email address' });
  }
  if (new_password != null && (typeof new_password !== 'string' || new_password.length < 12 || new_password.length > 128)) {
    return res.status(400).json({ success: false, message: 'A reset password must be at least 12 characters' });
  }
  try {
    const role = await prisma.roles.findUnique({ where: { id: Number(role_id) } });
    if (!role || !['admin', 'manager', 'cashier', 'stock_keeper', 'waiter'].includes(role.name)) {
      return res.status(400).json({ success: false, message: 'Select a supported role' });
    }
    const updated = await prisma.$transaction(async (tx) => {
      const [current] = await tx.$queryRaw`
        SELECT id, role_id, is_active, full_name, email, phone
        FROM users WHERE id = ${userId} FOR UPDATE
      `;
      if (!current) throw new Error('User not found');
      if (userId === req.user.id && (Number(is_active) !== 1 || role.name !== 'admin')) {
        throw new Error('You cannot deactivate or remove your own administrator access');
      }
      const roleBefore = await tx.roles.findUnique({ where: { id: current.role_id } });
      if (roleBefore?.name === 'admin' && current.is_active &&
          (role.name !== 'admin' || Number(is_active) !== 1)) {
        const activeAdmins = await tx.users.count({
          where: { is_active: 1, role_id: roleBefore.id },
        });
        if (activeAdmins <= 1) throw new Error('The last active administrator cannot be deactivated or demoted');
      }
      const data = {
        full_name: full_name.trim(), email: email?.trim() || null,
        phone: phone?.trim() || null, role_id: role.id, is_active: Number(is_active),
        ...(new_password ? { password_hash: await bcrypt.hash(new_password, 12) } : {}),
      };
      const user = await tx.users.update({ where: { id: userId }, data });
      await recordAuditEvent(tx, req, {
        action: new_password ? 'user_updated_password_reset' : 'user_updated',
        entityType: 'user', entityId: userId,
        before: { full_name: current.full_name, email: current.email, phone: current.phone, role: roleBefore?.name, is_active: current.is_active },
        after: { full_name: user.full_name, email: user.email, phone: user.phone, role: role.name, is_active: user.is_active },
      });
      return user;
    });
    res.json({ success: true, message: 'User updated', data: userData(updated, role.name) });
  } catch (err) {
    if (err.code === 'P2002') return res.status(409).json({ success: false, message: 'Email is already in use' });
    const known = ['User not found', 'You cannot deactivate or remove your own administrator access',
      'The last active administrator cannot be deactivated or demoted'];
    const status = err.message === 'User not found' ? 404 : known.includes(err.message) ? 400 : 500;
    if (status === 500) console.error('User update failed:', err);
    res.status(status).json({ success: false, message: status === 500 ? 'Failed to update user' : err.message });
  }
});

module.exports = router;
