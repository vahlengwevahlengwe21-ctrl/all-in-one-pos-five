const dotenv = require('dotenv');
const mysql = require('mysql2/promise');

dotenv.config({ path: '.env.local' });
dotenv.config();

function requiredEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required MySQL environment variable: ${name}`);
  return value;
}

function createMysqlPool(connectionLimit = 5) {
  const port = Number(process.env.DB_PORT || '3306');
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('DB_PORT must be a valid TCP port.');
  }
  const ca = process.env.DB_SSL_CA?.replace(/\\n/g, '\n');
  return mysql.createPool({
    host: requiredEnv('DB_HOST'),
    port,
    user: requiredEnv('DB_USER'),
    password: requiredEnv('DB_PASSWORD'),
    database: requiredEnv('DB_NAME'),
    waitForConnections: true,
    connectionLimit,
    ssl: process.env.DB_SSL?.toLowerCase() === 'false'
      ? undefined
      : { rejectUnauthorized: true, ...(ca ? { ca } : {}) },
  });
}

function recordParts(path) {
  const parts = path.split('/').filter(Boolean);
  if (parts.length < 2 || parts.length % 2 !== 0) throw new Error(`Invalid record path: ${path}`);
  return parts;
}

async function readMysqlRecord(executor, path) {
  const [rows] = await executor.execute('SELECT payload FROM app_records WHERE path = ?', [path]);
  if (!rows.length) return undefined;
  return typeof rows[0].payload === 'string' ? JSON.parse(rows[0].payload) : rows[0].payload;
}

async function writeMysqlRecord(executor, path, data, merge = true) {
  const parts = recordParts(path);
  const previous = merge ? await readMysqlRecord(executor, path) : undefined;
  const payload = { ...(previous || {}), ...data };
  await executor.execute(
    `INSERT INTO app_records (path, collection_path, collection_group, doc_id, payload)
     VALUES (?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE payload = VALUES(payload), updated_at = CURRENT_TIMESTAMP`,
    [path, parts.slice(0, -1).join('/'), parts[parts.length - 2], parts[parts.length - 1], JSON.stringify(payload)],
  );
  return payload;
}

module.exports = { createMysqlPool, readMysqlRecord, writeMysqlRecord };
