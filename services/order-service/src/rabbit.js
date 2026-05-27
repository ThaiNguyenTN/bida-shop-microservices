const amqp = require('amqplib');

const EXCHANGE = 'billiard.events';

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function connectRabbit(retries = 30) {
  const url = process.env.RABBITMQ_URL || 'amqp://guest:guest@localhost:5672';
  for (let i = 1; i <= retries; i++) {
    try {
      const connection = await amqp.connect(url);
      const channel = await connection.createChannel();
      await channel.assertExchange(EXCHANGE, 'topic', { durable: true });
      console.log('RabbitMQ connected');
      return { connection, channel };
    } catch (err) {
      console.log(`Waiting for RabbitMQ... (${i}/${retries})`);
      await sleep(2000);
    }
  }
  throw new Error('Cannot connect to RabbitMQ');
}

async function publish(channel, routingKey, data) {
  const payload = Buffer.from(JSON.stringify(data));
  channel.publish(EXCHANGE, routingKey, payload, { persistent: true, timestamp: Date.now() });
  console.log(`Published ${routingKey}:`, data);
}

module.exports = { EXCHANGE, connectRabbit, publish };
