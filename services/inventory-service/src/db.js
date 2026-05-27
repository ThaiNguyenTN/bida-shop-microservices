const { Pool } = require('pg');

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: Number(process.env.DB_PORT || 5432),
  database: process.env.DB_NAME || 'inventorydb',
  user: process.env.DB_USER || 'inventory',
  password: process.env.DB_PASSWORD || 'password'
});

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function waitForDb(retries = 30) {
  for (let i = 1; i <= retries; i++) {
    try {
      await pool.query('SELECT 1');
      console.log('Inventory DB connected');
      return;
    } catch (err) {
      console.log(`Waiting for Inventory DB... (${i}/${retries})`);
      await sleep(2000);
    }
  }
  throw new Error('Cannot connect to Inventory DB');
}

async function initDb() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS inventory (
      product_id INT PRIMARY KEY,
      quantity INT NOT NULL DEFAULT 0 CHECK(quantity >= 0),
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  const count = await pool.query('SELECT COUNT(*)::int AS total FROM inventory');
  if (count.rows[0].total === 0) {
    await pool.query(`
      INSERT INTO inventory(product_id, quantity)
      VALUES (1, 20), (2, 8), (3, 30), (4, 5)
      ON CONFLICT(product_id) DO NOTHING
    `);
  }
}

module.exports = { pool, waitForDb, initDb };
