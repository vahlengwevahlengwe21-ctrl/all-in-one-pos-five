const { createMysqlPool, readMysqlRecord } = require('./mysql-support.cjs');

const collections = [
  'products', 'customers', 'discounts', 'store_credits', 'layaways', 'cash_drawers',
  'locations', 'inventories', 'stock_counts', 'low_stock_alerts',
];
const shopId = process.argv[2];
const shouldApply = process.argv.includes('--apply');

async function main() {
  if (!shopId) throw new Error('Usage: node scripts/migrate-shop-data.js <shop-id> [--apply]');
  const pool = createMysqlPool();
  try {
    if (!await readMysqlRecord(pool, `shops/${shopId}`)) throw new Error(`Shop ${shopId} was not found in MySQL.`);
    const connection = shouldApply ? await pool.getConnection() : undefined;
    let total = 0;
    try {
      if (connection) await connection.beginTransaction();
      for (const collection of collections) {
        const [rows] = await (connection ?? pool).execute(
          'SELECT path, payload FROM app_records WHERE collection_path = ?',
          [collection],
        );
        const legacy = rows.filter((row) => {
          const payload = typeof row.payload === 'string' ? JSON.parse(row.payload) : row.payload;
          return !payload.shopId;
        });
        if (!legacy.length) continue;
        console.log(`${collection}: ${legacy.length} records without shopId`);
        total += legacy.length;
        if (connection) {
          for (const row of legacy) {
            const payload = typeof row.payload === 'string' ? JSON.parse(row.payload) : row.payload;
            payload.shopId = shopId;
            await connection.execute('UPDATE app_records SET payload = ?, updated_at = CURRENT_TIMESTAMP WHERE path = ?', [
              JSON.stringify(payload), row.path,
            ]);
          }
        }
      }
      if (connection) await connection.commit();
    } catch (error) {
      if (connection) await connection.rollback();
      throw error;
    } finally {
      connection?.release();
    }
    console.log(shouldApply
      ? `Updated ${total} MySQL records.`
      : `Dry run complete. No records changed. Re-run with --apply to update ${total} records.`);
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
