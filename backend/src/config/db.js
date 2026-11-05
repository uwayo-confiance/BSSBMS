const mysql = require('mysql2/promise');
require('dotenv').config();

const pool = mysql.createPool({
  host: process.env.DB_HOST || 'localhost',
  port: process.env.DB_PORT || 3306,
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'bssbms',
  waitForConnections: true,
  connectionLimit: 20,
  queueLimit: 0,
  enableKeepAlive: true,
  keepAliveInitialDelay: 0,
  timezone: '+02:00', // CAT (Central Africa Time)
});

// Test connection helper
async function testConnection() {
  try {
    const conn = await pool.getConnection();
    console.log('✓ MySQL connected successfully');
    conn.release();
    return true;
  } catch (err) {
    console.error('✗ MySQL connection failed:', err.message);
    return false;
  }
}

module.exports = { pool, testConnection };
