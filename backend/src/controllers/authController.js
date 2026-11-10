const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { prisma } = require('../config/db');

const login = async (req, res) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({ success: false, message: 'Username and password are required' });
    }

    const user = await prisma.users.findFirst({
      where: { OR: [{ username }, { email: username }] },
      select: {
        id: true,
        full_name: true,
        username: true,
        email: true,
        password_hash: true,
        is_active: true,
        role_id: true,
      },
    });

    if (!user) {
      return res.status(401).json({ success: false, message: 'Invalid credentials' });
    }

    if (!user.is_active) {
      return res.status(401).json({ success: false, message: 'Account is deactivated' });
    }

    const role = await prisma.roles.findUnique({ where: { id: user.role_id }, select: { name: true } });
    const match = await bcrypt.compare(password, user.password_hash);
    if (!match) {
      return res.status(401).json({ success: false, message: 'Invalid credentials' });
    }

    // Update last login
    await prisma.users.update({ where: { id: user.id }, data: { last_login: new Date() } });

    const token = jwt.sign(
      { userId: user.id, role: role.name },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
    );

    res.json({
      success: true,
      message: 'Login successful',
      data: {
        token,
        user: {
          id: user.id,
          full_name: user.full_name,
          username: user.username,
          email: user.email,
          role: role.name,
        },
      },
    });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

const me = async (req, res) => {
  res.json({
    success: true,
    data: { user: req.user },
  });
};

const changePassword = async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    if (!currentPassword || !newPassword) {
      return res.status(400).json({ success: false, message: 'Both passwords are required' });
    }
    if (newPassword.length < 6) {
      return res.status(400).json({ success: false, message: 'New password must be at least 6 characters' });
    }

    const user = await prisma.users.findUnique({
      where: { id: req.user.id },
      select: { password_hash: true },
    });
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    const match = await bcrypt.compare(currentPassword, user.password_hash);
    if (!match) {
      return res.status(400).json({ success: false, message: 'Current password is incorrect' });
    }

    const hash = await bcrypt.hash(newPassword, 12);
    await prisma.users.update({ where: { id: req.user.id }, data: { password_hash: hash } });

    res.json({ success: true, message: 'Password changed successfully' });
  } catch (err) {
    console.error('Change password error:', err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

module.exports = { login, me, changePassword };
