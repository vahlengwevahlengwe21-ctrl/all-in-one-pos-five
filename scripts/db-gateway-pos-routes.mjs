import { createHash, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const allowlistPath = fileURLToPath(new URL('./db-gateway-pos-allowlist.json', import.meta.url));
const allowedQueryHashes = new Set(JSON.parse(readFileSync(allowlistPath, 'utf8')));
const transactions = new Map();
const maxTransactions = 50;
const transactionTimeoutMs = 60_000;

function normalizedSql(sql) {
  return sql.replace(/\s+/g, ' ').trim();
}

function validateStatement(statement) {
  if (!statement || typeof statement.sql !== 'string' || !Array.isArray(statement.values ?? [])) {
    throw new Error('Invalid database statement.');
  }
  const hash = createHash('sha256').update(normalizedSql(statement.sql)).digest('hex');
  if (!allowedQueryHashes.has(hash)) throw new Error('SQL statement is not allowed.');
  return { sql: statement.sql, values: statement.values ?? [] };
}

export function isPosGatewayRoute(path) {
  return path === '/pos/execute'
    || path === '/pos/transactions'
    || /^\/pos\/transactions\/[0-9a-f-]{36}\/(execute|commit|rollback)$/.test(path);
}

export async function handlePosGatewayRoute(path, body, pool, send, response) {
  if (path === '/pos/execute') {
    const statement = validateStatement(body);
    const [result] = await pool.execute(statement.sql, statement.values);
    send(response, 200, { result });
    return;
  }

  if (path === '/pos/transactions') {
    if (transactions.size >= maxTransactions) {
      send(response, 503, { error: 'The database gateway is at transaction capacity.' });
      return;
    }
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
    } catch (error) {
      connection.release();
      throw error;
    }
    const transactionId = randomUUID();
    transactions.set(transactionId, { connection, lastUsedAt: Date.now(), busy: false });
    send(response, 200, { transactionId });
    return;
  }

  const match = /^\/pos\/transactions\/([0-9a-f-]{36})\/(execute|commit|rollback)$/.exec(path);
  if (!match) {
    send(response, 404, { error: 'Not found.' });
    return;
  }
  const [, transactionId, operation] = match;
  const transaction = transactions.get(transactionId);
  if (!transaction) {
    send(response, 404, { error: 'Database transaction not found or expired.' });
    return;
  }
  if (transaction.busy) {
    send(response, 409, { error: 'A request for this transaction is already in progress.' });
    return;
  }
  transaction.busy = true;
  transaction.lastUsedAt = Date.now();

  try {
    if (operation === 'execute') {
      const statement = validateStatement(body);
      const [result] = await transaction.connection.execute(statement.sql, statement.values);
      transaction.lastUsedAt = Date.now();
      send(response, 200, { result });
      return;
    }

    if (operation === 'commit') await transaction.connection.commit();
    else await transaction.connection.rollback();
    transactions.delete(transactionId);
    send(response, 200, { ok: true });
  } finally {
    if (!transactions.has(transactionId)) transaction.connection.release();
    else transaction.busy = false;
  }
}

export async function closePosGatewayTransactions() {
  for (const [id, transaction] of transactions) {
    transactions.delete(id);
    try {
      await transaction.connection.rollback();
    } catch (error) {
      console.error('POS transaction shutdown rollback failed:', error.code || error.message);
    } finally {
      transaction.connection.release();
    }
  }
}

const expiryTimer = setInterval(() => {
  const cutoff = Date.now() - transactionTimeoutMs;
  for (const [id, transaction] of transactions) {
    if (transaction.busy || transaction.lastUsedAt >= cutoff) continue;
    transactions.delete(id);
    void transaction.connection.rollback()
      .catch(error => console.error('Expired POS transaction rollback failed:', error.code || error.message))
      .finally(() => transaction.connection.release());
  }
}, 10_000);
expiryTimer.unref();

process.once('beforeExit', () => clearInterval(expiryTimer));
