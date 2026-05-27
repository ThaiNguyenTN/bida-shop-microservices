const { Pool } = require('pg');

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: Number(process.env.DB_PORT || 5432),
  database: process.env.DB_NAME || 'notificationdb',
  user: process.env.DB_USER || 'notification',
  password: process.env.DB_PASSWORD || 'password'
});

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function waitForDb(retries = 30) {
  for (let i = 1; i <= retries; i++) {
    try {
      await pool.query('SELECT 1');
      console.log('Notification DB connected');
      return;
    } catch (err) {
      console.log(`Waiting for Notification DB... (${i}/${retries})`);
      await sleep(2000);
    }
  }
  throw new Error('Cannot connect to Notification DB');
}

async function initDb() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS notifications (
      id SERIAL PRIMARY KEY,
      event_type VARCHAR(80) NOT NULL,
      title VARCHAR(180) NOT NULL,
      content TEXT NOT NULL,
      payload JSONB,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);
}

module.exports = { pool, waitForDb, initDb };
