import { createHash, timingSafeEqual } from 'node:crypto';
import { createServer } from 'node:http';
import dotenv from 'dotenv';
import mysql from 'mysql2/promise';
import {
  closePosGatewayTransactions,
  handlePosGatewayRoute,
  isPosGatewayRoute,
} from './db-gateway-pos-routes.mjs';

dotenv.config({ path: process.env.DB_GATEWAY_ENV_FILE || '/opt/db-gateway/.env' });

const token = process.env.POS_DB_GATEWAY_TOKEN || process.env.DB_GATEWAY_TOKEN;
const tokenHash = process.env.POS_DB_GATEWAY_TOKEN_SHA256;
const host = process.env.POS_DB_GATEWAY_HOST || '0.0.0.0';
const port = Number(process.env.POS_DB_GATEWAY_PORT || 8788);
const maxBodyBytes = 1024 * 1024;

if (
  (!token && !tokenHash)
  || (token && Buffer.byteLength(token) < 32)
  || (tokenHash && !/^[a-f0-9]{64}$/i.test(tokenHash))
) {
  throw new Error('Set a POS gateway token of at least 32 characters or its 64-character SHA-256 digest.');
}
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error('POS_DB_GATEWAY_PORT must be a valid TCP port.');
}

const missingDbConfig = ['DB_HOST', 'DB_USER', 'DB_PASSWORD', 'DB_NAME']
  .filter(key => !process.env[key]);
if (missingDbConfig.length) {
  throw new Error(`Missing MySQL configuration: ${missingDbConfig.join(', ')}`);
}
if (!process.env.DB_SSL_CA?.trim()) {
  throw new Error('DB_SSL_CA is required; unverified MySQL TLS is not allowed.');
}

const dbPort = Number(process.env.DB_PORT || 3306);
if (!Number.isInteger(dbPort) || dbPort < 1 || dbPort > 65535) {
  throw new Error('DB_PORT must be a valid TCP port.');
}

const pool = mysql.createPool({
  host: process.env.DB_HOST,
  port: dbPort,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  ssl: {
    ca: process.env.DB_SSL_CA.replace(/\\n/g, '\n'),
    servername: process.env.DB_SSL_SERVERNAME || process.env.DB_HOST,
    rejectUnauthorized: true,
  },
  charset: 'utf8mb4',
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
});

function send(response, status, body) {
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  });
  response.end(JSON.stringify(body, (_key, value) => typeof value === 'bigint' ? value.toString() : value));
}

function authorized(request) {
  const [scheme, suppliedToken] = (request.headers.authorization || '').split(' ');
  if (scheme !== 'Bearer' || !suppliedToken) return false;
  if (tokenHash) {
    const suppliedHash = createHash('sha256').update(suppliedToken).digest();
    return timingSafeEqual(suppliedHash, Buffer.from(tokenHash, 'hex'));
  }
  const supplied = Buffer.from(suppliedToken);
  const expected = Buffer.from(token);
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}

async function readJson(request) {
  const chunks = [];
  let bytes = 0;
  for await (const chunk of request) {
    bytes += chunk.length;
    if (bytes > maxBodyBytes) throw new Error('Request body is too large.');
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

const server = createServer(async (request, response) => {
  const path = new URL(request.url, 'http://localhost').pathname;
  if (request.method === 'GET' && path === '/healthz') {
    try {
      await pool.query('SELECT 1');
      return send(response, 200, { status: 'ok' });
    } catch (error) {
      console.error('POS database gateway health check failed:', error.code || error.message);
      return send(response, 503, { error: 'Database unavailable.' });
    }
  }

  if (request.method !== 'POST' || !isPosGatewayRoute(path)) {
    return send(response, 404, { error: 'Not found.' });
  }
  if (!authorized(request)) return send(response, 401, { error: 'Unauthorized.' });
  if (!request.headers['content-type']?.startsWith('application/json')) {
    return send(response, 415, { error: 'JSON content type required.' });
  }

  try {
    const body = await readJson(request);
    await handlePosGatewayRoute(path, body, pool, send, response);
  } catch (error) {
    if (error instanceof SyntaxError || error.message === 'Request body is too large.') {
      return send(response, 400, { error: error.message });
    }
    if (error.message === 'Invalid database statement.' || error.message === 'SQL statement is not allowed.') {
      return send(response, 403, { error: error.message });
    }
    console.error('POS database gateway request failed:', error.code || error.message);
    return send(response, 502, {
      error: 'Database operation failed.',
      ...(typeof error.code === 'string' ? { code: error.code } : {}),
    });
  }
});

server.on('clientError', (_error, socket) => socket.end('HTTP/1.1 400 Bad Request\r\n\r\n'));
server.listen(port, host, () => {
  console.log(`POS database gateway listening on ${host}:${port}.`);
});

let shuttingDown = false;
async function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  server.close();
  await closePosGatewayTransactions();
  await pool.end();
}
process.on('SIGINT', () => void shutdown());
process.on('SIGTERM', () => void shutdown());
