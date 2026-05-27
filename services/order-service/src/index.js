const express = require('express');
const cors = require('cors');
const morgan = require('morgan');
const axios = require('axios');
const { pool, waitForDb, initDb, getOrderWithItems } = require('./db');
const { EXCHANGE, connectRabbit, publish } = require('./rabbit');

const app = express();
const PORT = process.env.PORT || 3003;
const PRODUCT_SERVICE_URL = process.env.PRODUCT_SERVICE_URL || 'http://localhost:3002';
let rabbitChannel;

app.use(cors());
app.use(express.json());
app.use(morgan('dev'));

app.get('/health', (req, res) => res.json({ status: 'UP', service: 'order-service' }));

app.get('/orders', async (req, res) => {
  const userId = Number(req.query.userId || 0);
  const result = userId
    ? await pool.query('SELECT * FROM orders WHERE user_id=$1 ORDER BY id DESC', [userId])
    : await pool.query('SELECT * FROM orders ORDER BY id DESC');
  res.json(result.rows);
});

app.get('/orders/:id', async (req, res) => {
  const order = await getOrderWithItems(req.params.id);
  if (!order) return res.status(404).json({ message: 'Order not found' });
  res.json(order);
});

app.post('/orders', async (req, res) => {
  const client = await pool.connect();
  try {
    const { userId, items } = req.body;
    if (!userId || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ message: 'userId and items are required' });
    }

    const enrichedItems = [];
    for (const item of items) {
      if (!item.productId || !item.quantity || Number(item.quantity) <= 0) {
        return res.status(400).json({ message: 'Each item needs productId and positive quantity' });
      }
      const productResp = await axios.get(`${PRODUCT_SERVICE_URL}/products/${item.productId}`);
      const product = productResp.data;
      const quantity = Number(item.quantity);
      const unitPrice = Number(product.price);
      enrichedItems.push({
        productId: Number(product.id),
        productName: product.name,
        unitPrice,
        quantity,
        lineTotal: unitPrice * quantity
      });
    }

    const total = enrichedItems.reduce((sum, item) => sum + item.lineTotal, 0);
    const orderCode = `MS-${Date.now().toString(36).toUpperCase()}`;

    await client.query('BEGIN');
    const orderResult = await client.query(
      'INSERT INTO orders(order_code, user_id, status, total) VALUES($1, $2, $3, $4) RETURNING *',
      [orderCode, userId, 'PENDING_INVENTORY', total]
    );
    const order = orderResult.rows[0];

    for (const item of enrichedItems) {
      await client.query(
        `INSERT INTO order_items(order_id, product_id, product_name, unit_price, quantity, line_total)
         VALUES($1, $2, $3, $4, $5, $6)`,
        [order.id, item.productId, item.productName, item.unitPrice, item.quantity, item.lineTotal]
      );
    }
    await client.query('COMMIT');

    await publish(rabbitChannel, 'order.created', {
      orderId: order.id,
      userId: Number(userId),
      total,
      items: enrichedItems,
      createdAt: order.created_at
    });

    const fullOrder = await getOrderWithItems(order.id);
    res.status(201).json(fullOrder);
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    if (err.response && err.response.status === 404) {
      return res.status(400).json({ message: 'Product not found when creating order' });
    }
    console.error(err);
    res.status(500).json({ message: 'Internal server error' });
  } finally {
    client.release();
  }
});

app.patch('/orders/:id/status', async (req, res) => {
  const orderId = Number(req.params.id);
  const statusMap = {
    created: 'PENDING_INVENTORY',
    pending_inventory: 'PENDING_INVENTORY',
    confirmed: 'CONFIRMED',
    processing: 'PROCESSING',
    shipping: 'SHIPPING',
    completed: 'COMPLETED',
    cancelled: 'CANCELLED'
  };
  const rawStatus = String(req.body.status || '').trim();
  const nextStatus = statusMap[rawStatus.toLowerCase()] || rawStatus.toUpperCase();
  const allowedStatuses = ['PENDING_INVENTORY', 'CONFIRMED', 'PROCESSING', 'SHIPPING', 'COMPLETED', 'CANCELLED'];

  if (!orderId) {
    return res.status(400).json({ message: 'Invalid order id' });
  }
  if (!allowedStatuses.includes(nextStatus)) {
    return res.status(400).json({ message: `Status must be one of: ${allowedStatuses.join(', ')}` });
  }

  const result = await pool.query(
    `UPDATE orders
     SET status=$1, updated_at=CURRENT_TIMESTAMP
     WHERE id=$2
     RETURNING *`,
    [nextStatus, orderId]
  );
  if (result.rowCount === 0) {
    return res.status(404).json({ message: 'Order not found' });
  }
  res.json(result.rows[0]);
});

async function startConsumers(channel) {
  const updatedQueue = 'order-service.inventory.updated';
  await channel.assertQueue(updatedQueue, { durable: true });
  await channel.bindQueue(updatedQueue, EXCHANGE, 'inventory.updated');
  channel.consume(updatedQueue, async (msg) => {
    if (!msg) return;
    try {
      const event = JSON.parse(msg.content.toString());
      await pool.query(
        `UPDATE orders SET status=$1, updated_at=CURRENT_TIMESTAMP WHERE id=$2`,
        ['CONFIRMED', event.orderId]
      );
      console.log('Order confirmed:', event.orderId);
      channel.ack(msg);
    } catch (err) {
      console.error('Error processing inventory.updated:', err);
      channel.nack(msg, false, false);
    }
  });

  const failedQueue = 'order-service.inventory.failed';
  await channel.assertQueue(failedQueue, { durable: true });
  await channel.bindQueue(failedQueue, EXCHANGE, 'inventory.failed');
  channel.consume(failedQueue, async (msg) => {
    if (!msg) return;
    try {
      const event = JSON.parse(msg.content.toString());
      await pool.query(
        `UPDATE orders SET status=$1, updated_at=CURRENT_TIMESTAMP WHERE id=$2`,
        ['CANCELLED', event.orderId]
      );
      console.log('Order cancelled:', event.orderId, event.reason);
      channel.ack(msg);
    } catch (err) {
      console.error('Error processing inventory.failed:', err);
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
  app.listen(PORT, () => console.log(`Order Service running on port ${PORT}`));
}

start().catch(err => {
  console.error('Order service failed to start:', err);
  process.exit(1);
});
