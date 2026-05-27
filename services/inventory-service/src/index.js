const express = require('express');
const cors = require('cors');
const morgan = require('morgan');
const { pool, waitForDb, initDb } = require('./db');
const { EXCHANGE, connectRabbit, publish } = require('./rabbit');

const app = express();
const PORT = process.env.PORT || 3004;
let rabbitChannel;

app.use(cors());
app.use(express.json());
app.use(morgan('dev'));

app.get('/health', (req, res) => res.json({ status: 'UP', service: 'inventory-service' }));

app.get('/inventory', async (req, res) => {
  const result = await pool.query('SELECT * FROM inventory ORDER BY product_id ASC');
  res.json(result.rows);
});

app.get('/inventory/:productId', async (req, res) => {
  const result = await pool.query('SELECT * FROM inventory WHERE product_id=$1', [req.params.productId]);
  if (result.rowCount === 0) return res.status(404).json({ message: 'Inventory record not found' });
  res.json(result.rows[0]);
});

app.post('/inventory', async (req, res) => {
  const { productId, quantity } = req.body;
  if (!productId || quantity === undefined || Number(quantity) < 0) {
    return res.status(400).json({ message: 'productId and non-negative quantity are required' });
  }
  const result = await pool.query(
    `INSERT INTO inventory(product_id, quantity, updated_at)
     VALUES($1, $2, CURRENT_TIMESTAMP)
     ON CONFLICT(product_id)
     DO UPDATE SET quantity = inventory.quantity + EXCLUDED.quantity, updated_at=CURRENT_TIMESTAMP
     RETURNING *`,
    [productId, quantity]
  );
  res.status(201).json(result.rows[0]);
});

app.patch('/inventory/:productId', async (req, res) => {
  const { quantity } = req.body;
  if (quantity === undefined || Number(quantity) < 0) {
    return res.status(400).json({ message: 'non-negative quantity is required' });
  }
  const result = await pool.query(
    `INSERT INTO inventory(product_id, quantity, updated_at)
     VALUES($1, $2, CURRENT_TIMESTAMP)
     ON CONFLICT(product_id)
     DO UPDATE SET quantity = EXCLUDED.quantity, updated_at=CURRENT_TIMESTAMP
     RETURNING *`,
    [req.params.productId, quantity]
  );
  res.json(result.rows[0]);
});

async function handleOrderCreated(event) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const stockResults = [];

    for (const item of event.items) {
      const stock = await client.query('SELECT * FROM inventory WHERE product_id=$1 FOR UPDATE', [item.productId]);
      const currentQty = stock.rowCount === 0 ? 0 : Number(stock.rows[0].quantity);
      if (currentQty < item.quantity) {
        await client.query('ROLLBACK');
        await publish(rabbitChannel, 'inventory.failed', {
          orderId: event.orderId,
          reason: `Not enough stock for product ${item.productId}`,
          productId: item.productId,
          required: item.quantity,
          available: currentQty
        });
        return;
      }
      stockResults.push({ productId: item.productId, before: currentQty, after: currentQty - item.quantity });
    }

    for (const item of event.items) {
      await client.query(
        'UPDATE inventory SET quantity = quantity - $1, updated_at=CURRENT_TIMESTAMP WHERE product_id=$2',
        [item.quantity, item.productId]
      );
    }

    await client.query('COMMIT');
    await publish(rabbitChannel, 'inventory.updated', {
      orderId: event.orderId,
      stockResults,
      message: 'Stock deducted successfully'
    });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('Inventory transaction error:', err);
    await publish(rabbitChannel, 'inventory.failed', {
      orderId: event.orderId,
      reason: 'Inventory service error'
    });
  } finally {
    client.release();
  }
}

async function startConsumers(channel) {
  const queue = 'inventory-service.order.created';
  await channel.assertQueue(queue, { durable: true });
  await channel.bindQueue(queue, EXCHANGE, 'order.created');
  channel.consume(queue, async (msg) => {
    if (!msg) return;
    try {
      const event = JSON.parse(msg.content.toString());
      console.log('Received order.created:', event.orderId);
      await handleOrderCreated(event);
      channel.ack(msg);
    } catch (err) {
      console.error('Error processing order.created:', err);
      channel.nack(msg, false, false);
    }
  });
}

async function start() {
  await waitForDb();
  await initDb();
  const rabbit = await connectRabbit();
  rabbitChannel = rabbit.channel;
  await startConsumers(rabbitChannel);
  app.listen(PORT, () => console.log(`Inventory Service running on port ${PORT}`));
}

start().catch(err => {
  console.error('Inventory service failed to start:', err);
  process.exit(1);
});
