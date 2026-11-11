require('dotenv').config();
const { spawnSync } = require('node:child_process');
const path = require('node:path');

if (!process.env.DATABASE_URL) {
  const user = encodeURIComponent(process.env.DB_USER || 'root');
  const password = encodeURIComponent(process.env.DB_PASSWORD || '');
  const host = process.env.DB_HOST || 'localhost';
  const port = process.env.DB_PORT || 3306;
  const database = encodeURIComponent(process.env.DB_NAME || 'bssbms');
  process.env.DATABASE_URL = `mysql://${user}:${password}@${host}:${port}/${database}`;
}

const backendRoot = path.resolve(__dirname, '../..');
const prismaCli = require.resolve('prisma/build/index.js', { paths: [backendRoot] });
const result = spawnSync(process.execPath, [prismaCli, ...process.argv.slice(2)], {
  cwd: backendRoot,
  env: process.env,
  stdio: 'inherit',
});

if (result.error) {
  console.error('Failed to run Prisma CLI:', result.error);
  process.exitCode = 1;
} else {
  process.exitCode = result.status ?? 1;
}
