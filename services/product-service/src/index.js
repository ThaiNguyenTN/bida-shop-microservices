const express = require('express');
const cors = require('cors');
const morgan = require('morgan');
const { pool, waitForDb, initDb } = require('./db');

const app = express();
const PORT = process.env.PORT || 3002;

app.use(cors());
app.use(express.json());
app.use(morgan('dev'));

app.get('/health', (req, res) => res.json({ status: 'UP', service: 'product-service' }));

app.get('/products', async (req, res) => {
  const result = await pool.query('SELECT * FROM products ORDER BY id ASC');
  res.json(result.rows);
});

app.get('/products/:id', async (req, res) => {
  const result = await pool.query('SELECT * FROM products WHERE id=$1', [req.params.id]);
  if (result.rowCount === 0) return res.status(404).json({ message: 'Product not found' });
  res.json(result.rows[0]);
});

app.post('/products', async (req, res) => {
  try {
    const { name, brand, category = 'pool cue', price, description, imageUrl } = req.body;
    if (!name || price === undefined) return res.status(400).json({ message: 'name and price are required' });
    const result = await pool.query(
      `INSERT INTO products(name, brand, category, price, description, image_url)
       VALUES($1, $2, $3, $4, $5, $6) RETURNING *`,
      [name, brand, category, price, description, imageUrl]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Internal server error' });
  }
});

app.put('/products/:id', async (req, res) => {
  try {
    const { name, brand, category, price, description, imageUrl } = req.body;
    const productId = Number(req.params.id);
    if (!productId) return res.status(400).json({ message: 'Invalid product id' });
    const result = await pool.query(
      `INSERT INTO products(id, name, brand, category, price, description, image_url)
       VALUES($1, $2, $3, COALESCE($4, 'pool cue'), $5, $6, $7)
       ON CONFLICT(id)
       DO UPDATE SET
         name = COALESCE(EXCLUDED.name, products.name),
         brand = COALESCE(EXCLUDED.brand, products.brand),
         category = COALESCE(EXCLUDED.category, products.category),
         price = COALESCE(EXCLUDED.price, products.price),
         description = COALESCE(EXCLUDED.description, products.description),
         image_url = COALESCE(EXCLUDED.image_url, products.image_url)
       RETURNING *`,
      [productId, name, brand, category, price, description, imageUrl]
    );
    await pool.query(
      `SELECT setval(pg_get_serial_sequence('products', 'id'), GREATEST((SELECT MAX(id) FROM products), 1), true)`
    );
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Internal server error' });
  }
});

app.delete('/products/:id', async (req, res) => {
  const result = await pool.query('DELETE FROM products WHERE id=$1 RETURNING id', [req.params.id]);
  if (result.rowCount === 0) return res.status(404).json({ message: 'Product not found' });
  res.json({ message: 'Product deleted', id: result.rows[0].id });
});

async function start() {
  await waitForDb();
  await initDb();
  app.listen(PORT, () => console.log(`Product Service running on port ${PORT}`));
}

start().catch(err => {
  console.error('Product service failed to start:', err);
  process.exit(1);
});
