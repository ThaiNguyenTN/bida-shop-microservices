const { Pool } = require('pg');

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: Number(process.env.DB_PORT || 5432),
  database: process.env.DB_NAME || 'orderdb',
  user: process.env.DB_USER || 'order_user',
  password: process.env.DB_PASSWORD || 'password'
});

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function waitForDb(retries = 30) {
  for (let i = 1; i <= retries; i++) {
    try {
      await pool.query('SELECT 1');
      console.log('Order DB connected');
      return;
    } catch (err) {
      console.log(`Waiting for Order DB... (${i}/${retries})`);
      await sleep(2000);
    }
  }
  throw new Error('Cannot connect to Order DB');
}

async function initDb() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS orders (
      id SERIAL PRIMARY KEY,
      order_code VARCHAR(50),
      user_id INT NOT NULL,
      status VARCHAR(50) NOT NULL DEFAULT 'PENDING_INVENTORY',
      total NUMERIC(12, 2) NOT NULL DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS order_items (
      id SERIAL PRIMARY KEY,
      order_id INT REFERENCES orders(id) ON DELETE CASCADE,
      product_id INT NOT NULL,
      product_name VARCHAR(180),
      unit_price NUMERIC(12, 2) NOT NULL,
      quantity INT NOT NULL CHECK(quantity > 0),
      line_total NUMERIC(12, 2) NOT NULL
    )
  `);

  await pool.query(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS order_code VARCHAR(50)`);
  await pool.query(`
    UPDATE orders
    SET order_code = CONCAT('MS-', UPPER(to_hex(id)), '-', TO_CHAR(created_at, 'DDMM'))
    WHERE order_code IS NULL OR order_code = ''
  `);
}

async function getOrderWithItems(orderId) {
  const orderResult = await pool.query('SELECT * FROM orders WHERE id=$1', [orderId]);
  if (orderResult.rowCount === 0) return null;
  const itemsResult = await pool.query('SELECT * FROM order_items WHERE order_id=$1 ORDER BY id ASC', [orderId]);
  return { ...orderResult.rows[0], items: itemsResult.rows };
}

module.exports = { pool, waitForDb, initDb, getOrderWithItems };
