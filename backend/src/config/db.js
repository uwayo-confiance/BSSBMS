require('dotenv').config();
const { PrismaClient } = require('@prisma/client');

if (!process.env.DATABASE_URL) {
  const user = encodeURIComponent(process.env.DB_USER || 'root');
  const password = encodeURIComponent(process.env.DB_PASSWORD || '');
  const host = process.env.DB_HOST || 'localhost';
  const port = process.env.DB_PORT || 3306;
  const database = encodeURIComponent(process.env.DB_NAME || 'bssbms');
  process.env.DATABASE_URL = `mysql://${user}:${password}@${host}:${port}/${database}`;
}

const prisma = new PrismaClient();

async function testConnection() {
  try {
    await prisma.$connect();
    await prisma.$queryRaw`SELECT 1`;
    console.log('✓ MySQL connected successfully through Prisma');
    return true;
  } catch (err) {
    console.error('✗ MySQL connection failed:', err.message);
    return false;
  }
}

module.exports = { prisma, testConnection };
