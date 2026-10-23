const { createMysqlPool } = require('./mysql-support.cjs');

const testSalespersonId = 'AeYINQSx7DXWo0LUfUaXAbneZ0j1';
const expectedTotal = 485.99;
const maximumAgeMs = 15 * 60 * 1000;

function parsePayload(payload) {
  return typeof payload === 'string' ? JSON.parse(payload) : payload;
}

function timestampMillis(value) {
  if (typeof value === 'number') return value;
  if (value?.__mysqlType === 'timestamp') return value.value;
  if (typeof value === 'string') return Date.parse(value);
  return NaN;
}

async function main() {
  const pool = createMysqlPool();
  try {
    const [sales] = await pool.execute(
      'SELECT path, doc_id, payload FROM app_records WHERE collection_path = ?',
      ['sales'],
    );
    const candidates = sales
      .map((row) => ({ ...row, data: parsePayload(row.payload) }))
      .filter((row) => row.data.salespersonId === testSalespersonId)
      .sort((first, second) => timestampMillis(second.data.createdAt) - timestampMillis(first.data.createdAt));
    const sale = candidates[0];
    if (!sale) throw new Error('No matching test sales were found; nothing was deleted.');
    const createdAt = timestampMillis(sale.data.createdAt);
    if (sale.data.total !== expectedTotal || !Number.isFinite(createdAt) || Date.now() - createdAt > maximumAgeMs) {
      throw new Error('The latest matching sale did not match the expected test transaction; nothing was deleted.');
    }

    const saleId = sale.doc_id;
    const childCollections = [`sales/${saleId}/items`, `sales/${saleId}/returns`];
    const [children] = await pool.execute(
      'SELECT path FROM app_records WHERE collection_path IN (?, ?)',
      childCollections,
    );
    const [movements] = await pool.execute(
      'SELECT path, payload FROM app_records WHERE collection_path = ?',
      ['inventory_transactions'],
    );
    const movementPaths = movements
      .filter((row) => parsePayload(row.payload).referenceId === saleId)
      .map((row) => row.path);
    const paths = [sale.path, ...children.map((row) => row.path), ...movementPaths];

    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      for (const path of paths) {
        await connection.execute('DELETE FROM app_records WHERE path = ?', [path]);
      }
      await connection.commit();
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
    console.log(`Deleted matching MySQL test sale ${saleId} and its child records.`);
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
