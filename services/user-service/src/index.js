const express = require('express');
const cors = require('cors');
const morgan = require('morgan');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { pool, waitForDb, initDb } = require('./db');

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());
app.use(morgan('dev'));

app.get('/health', (req, res) => res.json({ status: 'UP', service: 'user-service' }));

app.post('/users/register', async (req, res) => {
  try {
    const { name, email, password, role = 'staff' } = req.body;
    if (!name || !email || !password) {
      return res.status(400).json({ message: 'name, email, password are required' });
    }
    const passwordHash = await bcrypt.hash(password, 10);
    const result = await pool.query(
      'INSERT INTO users(name, email, password_hash, role) VALUES($1, $2, $3, $4) RETURNING id, name, email, role, created_at',
      [name, email, passwordHash, role]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ message: 'Email already exists' });
    console.error(err);
    res.status(500).json({ message: 'Internal server error' });
  }
});

app.post('/users/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ message: 'email and password are required' });
    const result = await pool.query('SELECT * FROM users WHERE email=$1', [email]);
    if (result.rowCount === 0) return res.status(401).json({ message: 'Invalid credentials' });

    const user = result.rows[0];
    const ok = await bcrypt.compare(password, user.password_hash);
    if (!ok) return res.status(401).json({ message: 'Invalid credentials' });

    const token = jwt.sign({ id: user.id, role: user.role }, process.env.JWT_SECRET || 'secret', { expiresIn: '1d' });
    res.json({ token, user: { id: user.id, name: user.name, email: user.email, role: user.role } });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Internal server error' });
  }
});

app.get('/users', async (req, res) => {
  const result = await pool.query('SELECT id, name, email, role, created_at FROM users ORDER BY id DESC');
  res.json(result.rows);
});

app.get('/users/:id', async (req, res) => {
  const result = await pool.query('SELECT id, name, email, role, created_at FROM users WHERE id=$1', [req.params.id]);
  if (result.rowCount === 0) return res.status(404).json({ message: 'User not found' });
  res.json(result.rows[0]);
});

app.put('/users/:id', async (req, res) => {
  try {
    const { name, email, role } = req.body;
    const result = await pool.query(
      'UPDATE users SET name=COALESCE($1, name), email=COALESCE($2, email), role=COALESCE($3, role) WHERE id=$4 RETURNING id, name, email, role, created_at',
      [name, email, role, req.params.id]
    );
    if (result.rowCount === 0) return res.status(404).json({ message: 'User not found' });
    res.json(result.rows[0]);
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ message: 'Email already exists' });
    console.error(err);
    res.status(500).json({ message: 'Internal server error' });
  }
});

app.delete('/users/:id', async (req, res) => {
  const result = await pool.query('DELETE FROM users WHERE id=$1 RETURNING id', [req.params.id]);
  if (result.rowCount === 0) return res.status(404).json({ message: 'User not found' });
  res.json({ message: 'User deleted', id: result.rows[0].id });
});

async function start() {
  await waitForDb();
  await initDb();
  app.listen(PORT, () => console.log(`User Service running on port ${PORT}`));
}

start().catch(err => {
  console.error('User service failed to start:', err);
  process.exit(1);
});
