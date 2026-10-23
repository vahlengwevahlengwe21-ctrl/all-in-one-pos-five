const dotenv = require('dotenv');
const mysql = require('mysql2/promise');

dotenv.config({ path: '.env.local' });
dotenv.config();

async function main() {
  const port = Number(process.env.DB_PORT || '3306');
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('DB_PORT must be a valid TCP port.');
  }

  const ca = process.env.DB_SSL_CA?.replace(/\\n/g, '\n');

  const pool = mysql.createPool({
    host: requiredEnv('DB_HOST'),
    port,
    user: requiredEnv('DB_USER'),
    password: requiredEnv('DB_PASSWORD'),
    database: requiredEnv('DB_NAME'),
    waitForConnections: true,
    connectionLimit: 1,
    ssl: process.env.DB_SSL?.toLowerCase() === 'false'
      ? undefined
      : { rejectUnauthorized: true, ...(ca ? { ca } : {}) },
  });

  try {
    await pool.query('SELECT 1');
    console.log('MySQL connection successful.');
  } finally {
    await pool.end();
  }
}

function requiredEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required MySQL environment variable: ${name}`);
  }
  return value;
}

main().catch((error) => {
  console.error('MySQL connection check failed:', error.message);
  process.exitCode = 1;
});
