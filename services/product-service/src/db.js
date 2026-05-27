const { Pool } = require('pg');

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: Number(process.env.DB_PORT || 5432),
  database: process.env.DB_NAME || 'productdb',
  user: process.env.DB_USER || 'product',
  password: process.env.DB_PASSWORD || 'password'
});

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function waitForDb(retries = 30) {
  for (let i = 1; i <= retries; i++) {
    try {
      await pool.query('SELECT 1');
      console.log('Product DB connected');
      return;
    } catch (err) {
      console.log(`Waiting for Product DB... (${i}/${retries})`);
      await sleep(2000);
    }
  }
  throw new Error('Cannot connect to Product DB');
}

async function initDb() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS products (
      id SERIAL PRIMARY KEY,
      name VARCHAR(180) NOT NULL,
      brand VARCHAR(120),
      category VARCHAR(80) DEFAULT 'pool cue',
      price NUMERIC(12, 2) NOT NULL CHECK(price >= 0),
      description TEXT,
      image_url TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  const count = await pool.query('SELECT COUNT(*)::int AS total FROM products');
  if (count.rows[0].total === 0) {
    await pool.query(`
      INSERT INTO products(name, brand, category, price, description, image_url)
      VALUES
      ('Predator Aspire 1-1', 'Predator', 'pool cue', 7500000, 'Gậy bida cho người chơi trung cấp, độ ổn định cao.', 'https://example.com/predator-aspire.jpg'),
      ('Cuetec Cynergy SVB', 'Cuetec', 'carbon cue', 13800000, 'Gậy carbon hiệu năng cao, phù hợp thi đấu.', 'https://example.com/cuetec-cynergy.jpg'),
      ('Fury CR-4', 'Fury', 'pool cue', 3200000, 'Mẫu gậy phổ thông, giá tốt cho người mới chơi.', 'https://example.com/fury-cr4.jpg'),
      ('Mezz EC9', 'Mezz', 'pool cue', 16500000, 'Dòng gậy cao cấp, cảm giác đánh chắc tay.', 'https://example.com/mezz-ec9.jpg')
    `);
  }
}

module.exports = { pool, waitForDb, initDb };
