const express = require('express');
const cors = require('cors');
const morgan = require('morgan');
const { pool, waitForDb, initDb } = require('./db');
const { EXCHANGE, connectRabbit } = require('./rabbit');

const app = express();
const PORT = process.env.PORT || 3005;

app.use(cors());
app.use(express.json());
app.use(morgan('dev'));

app.get('/health', (req, res) => res.json({ status: 'UP', service: 'notification-service' }));

app.get('/notifications', async (req, res) => {
  const result = await pool.query('SELECT * FROM notifications ORDER BY id DESC');
  res.json(result.rows);
});

app.get('/notifications/:id', async (req, res) => {
  const result = await pool.query('SELECT * FROM notifications WHERE id=$1', [req.params.id]);
  if (result.rowCount === 0) return res.status(404).json({ message: 'Notification not found' });
  res.json(result.rows[0]);
});

async function saveNotification(eventType, title, content, payload) {
  await pool.query(
    'INSERT INTO notifications(event_type, title, content, payload) VALUES($1, $2, $3, $4)',
    [eventType, title, content, JSON.stringify(payload)]
  );
}

async function startConsumers(channel) {
  const queue = 'notification-service.events';
  await channel.assertQueue(queue, { durable: true });
  await channel.bindQueue(queue, EXCHANGE, 'order.created');
  await channel.bindQueue(queue, EXCHANGE, 'inventory.updated');
  await channel.bindQueue(queue, EXCHANGE, 'inventory.failed');

  channel.consume(queue, async (msg) => {
    if (!msg) return;
    try {
      const event = JSON.parse(msg.content.toString());
      const routingKey = msg.fields.routingKey;
      if (routingKey === 'order.created') {
        await saveNotification(
          routingKey,
          `Đơn hàng #${event.orderId} đã được tạo`,
          `Đơn hàng trị giá ${event.total} đang chờ kiểm tra tồn kho.`,
          event
        );
      } else if (routingKey === 'inventory.updated') {
        await saveNotification(
          routingKey,
          `Đơn hàng #${event.orderId} đã xác nhận`,
          'Tồn kho đã được trừ thành công.',
          event
        );
      } else if (routingKey === 'inventory.failed') {
        await saveNotification(
          routingKey,
          `Đơn hàng #${event.orderId} bị hủy`,
          event.reason || 'Không thể xử lý tồn kho.',
          event
        );
      }
      channel.ack(msg);
    } catch (err) {
      console.error('Error saving notification:', err);
      channel.nack(msg, false, false);
    }
  });
}

async function start() {
  await waitForDb();
  await initDb();
  const rabbit = await connectRabbit();
  await startConsumers(rabbit.channel);
  app.listen(PORT, () => console.log(`Notification Service running on port ${PORT}`));
}

start().catch(err => {
  console.error('Notification service failed to start:', err);
  process.exit(1);
});
