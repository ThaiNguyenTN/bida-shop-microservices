const express = require('express');
const cors = require('cors');
const morgan = require('morgan');
const bcrypt = require('bcryptjs');
const { createProxyMiddleware, fixRequestBody } = require('http-proxy-middleware');
const { sql, getPool, query, exec } = require('./sqlServer');

const app = express();
const PORT = process.env.PORT || 8080;
const USER_SERVICE_URL = process.env.USER_SERVICE_URL || 'http://localhost:3001';
const PRODUCT_SERVICE_URL = process.env.PRODUCT_SERVICE_URL || 'http://localhost:3002';
const ORDER_SERVICE_URL = process.env.ORDER_SERVICE_URL || 'http://localhost:3003';
const INVENTORY_SERVICE_URL = process.env.INVENTORY_SERVICE_URL || 'http://localhost:3004';
const NOTIFICATION_SERVICE_URL = process.env.NOTIFICATION_SERVICE_URL || 'http://localhost:3005';

app.use(cors());
app.use(express.json({ limit: '2mb' }));
app.use(morgan('dev'));

function slugify(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function toBool(value) {
  return Boolean(Number(value)) || value === true;
}

function mapUser(row) {
  return {
    id: row.id,
    name: row.full_name,
    email: row.email,
    phone: row.phone,
    role: row.role,
    points: row.points,
    membershipLevel: row.membership_level,
    created_at: row.created_at,
    customerTag: row.customer_tag
  };
}

function mapProduct(row) {
  return {
    id: row.id,
    slug: row.slug,
    sku: row.sku,
    name: row.name,
    brand: row.brand,
    category: row.category_name || row.type,
    type: row.type,
    description: row.description,
    long_description: row.long_description,
    price: Number(row.price || 0),
    sale_price: row.sale_price == null ? null : Number(row.sale_price),
    tip_size: row.tip_size,
    shaft_material: row.shaft_material,
    joint_type: row.joint_type,
    wrap_type: row.wrap_type,
    butt_material: row.butt_material,
    stock_total: Number(row.stock_total || 0),
    rating: Number(row.rating || 0),
    review_count: Number(row.review_count || 0),
    sold_count: Number(row.sold_count || 0),
    is_featured: toBool(row.is_featured),
    is_active: toBool(row.is_active),
    image_url: row.cover_image || '',
    created_at: row.created_at,
    updated_at: row.updated_at
  };
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {})
    }
  });
  const text = await response.text();
  const data = text ? JSON.parse(text) : {};

  if (!response.ok) {
    const error = new Error(data.message || `HTTP ${response.status}`);
    error.status = response.status;
    error.data = data;
    throw error;
  }

  return data;
}

async function getGeneralSettings() {
  const rows = await query((request) => `
    SELECT TOP 1 setting_value
    FROM dbo.settings
    WHERE setting_key = 'general'
    ORDER BY id DESC
  `);
  if (!rows.length) return {};
  try {
    return JSON.parse(rows[0].setting_value || '{}');
  } catch {
    return {};
  }
}

async function getSqlProducts(whereClause = '', bind = () => {}) {
  return query((request) => {
    bind(request);
    return `
      SELECT
        p.id,
        p.slug,
        p.sku,
        p.name,
        p.brand,
        p.type,
        p.description,
        p.long_description,
        p.price,
        p.sale_price,
        p.tip_size,
        p.shaft_material,
        p.joint_type,
        p.wrap_type,
        p.butt_material,
        p.stock_total,
        p.rating,
        p.review_count,
        p.sold_count,
        p.is_featured,
        p.is_active,
        p.created_at,
        p.updated_at,
        c.name AS category_name,
        img.image_url AS cover_image
      FROM dbo.products p
      LEFT JOIN dbo.categories c ON c.id = p.category_id
      OUTER APPLY (
        SELECT TOP 1 image_url
        FROM dbo.product_images pi
        WHERE pi.product_id = p.id
        ORDER BY pi.sort_order, pi.id
      ) img
      ${whereClause}
      ORDER BY p.is_featured DESC, p.id DESC
    `;
  });
}

async function getSqlProductById(productId) {
  const rows = await getSqlProducts(
    'WHERE p.id = @productId',
    (request) => request.input('productId', sql.Int, Number(productId))
  );
  return rows.length ? mapProduct(rows[0]) : null;
}

async function ensureLegacyProductAndInventory(productId) {
  const product = await getSqlProductById(productId);
  if (!product) return false;

  let existingProduct = null;
  try {
    existingProduct = await fetchJson(`${PRODUCT_SERVICE_URL}/products/${product.id}`);
  } catch (error) {
    if (error.status !== 404) throw error;
  }

  const shouldRebaseInventory = !existingProduct
    || String(existingProduct.name || '').trim() !== String(product.name || '').trim()
    || String(existingProduct.brand || '').trim() !== String(product.brand || '').trim();

  await fetchJson(`${PRODUCT_SERVICE_URL}/products/${product.id}`, {
    method: 'PUT',
    body: JSON.stringify({
      name: product.name,
      brand: product.brand,
      category: product.type || product.category || 'pool cue',
      price: Number(product.sale_price || product.price || 0),
      description: product.description || '',
      imageUrl: product.image_url || ''
    })
  });

  try {
    await fetchJson(`${INVENTORY_SERVICE_URL}/inventory/${product.id}`);
    if (shouldRebaseInventory) {
      await fetchJson(`${INVENTORY_SERVICE_URL}/inventory/${product.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ quantity: Number(product.stock_total || 0) })
      });
    }
  } catch (error) {
    if (error.status !== 404) throw error;
    await fetchJson(`${INVENTORY_SERVICE_URL}/inventory`, {
      method: 'POST',
      body: JSON.stringify({
        productId: Number(product.id),
        quantity: Number(product.stock_total || 0)
      })
    });
  }

  return true;
}

app.get('/', (req, res) => {
  res.json({
    message: 'Billiard Cue Shop API Gateway',
    services: ['/users', '/products', '/orders', '/inventory', '/notifications', '/sql']
  });
});

app.get('/health', (req, res) => {
  res.json({ status: 'UP', service: 'api-gateway' });
});

app.post('/orders', async (req, res, next) => {
  try {
    const items = Array.isArray(req.body?.items) ? req.body.items : [];
    const productIds = Array.from(new Set(items.map((item) => Number(item.productId)).filter(Boolean)));

    for (const productId of productIds) {
      await ensureLegacyProductAndInventory(productId);
    }

    const data = await fetchJson(`${ORDER_SERVICE_URL}/orders`, {
      method: 'POST',
      body: JSON.stringify(req.body || {})
    });
    res.status(201).json(data);
  } catch (error) {
    next(error);
  }
});

app.patch('/orders/:id/status', async (req, res, next) => {
  try {
    const data = await fetchJson(`${ORDER_SERVICE_URL}/orders/${req.params.id}/status`, {
      method: 'PATCH',
      body: JSON.stringify(req.body || {})
    });
    res.json(data);
  } catch (error) {
    next(error);
  }
});

app.patch('/inventory/:productId', async (req, res, next) => {
  try {
    const data = await fetchJson(`${INVENTORY_SERVICE_URL}/inventory/${req.params.productId}`, {
      method: 'PATCH',
      body: JSON.stringify(req.body || {})
    });
    res.json(data);
  } catch (error) {
    next(error);
  }
});

app.get('/sql/health', async (req, res) => {
  try {
    await query(() => 'SELECT 1 AS ok');
    res.json({ status: 'UP', service: 'sql-adapter' });
  } catch (error) {
    res.status(500).json({ status: 'DOWN', service: 'sql-adapter', message: error.message });
  }
});

app.get('/sql/settings', async (req, res, next) => {
  try {
    res.json(await getGeneralSettings());
  } catch (error) {
    next(error);
  }
});

app.get('/sql/banners', async (req, res, next) => {
  try {
    const rows = await query(() => `
      SELECT id, title, subtitle, image_url, href, sort_order, active, created_at
      FROM dbo.banners
      WHERE active = 1
      ORDER BY sort_order, id
    `);
    res.json(rows.map((row) => ({
      id: row.id,
      title: row.title,
      subtitle: row.subtitle,
      image_url: row.image_url,
      href: row.href,
      sort_order: row.sort_order,
      active: toBool(row.active),
      created_at: row.created_at
    })));
  } catch (error) {
    next(error);
  }
});

app.get('/sql/blog-posts', async (req, res, next) => {
  try {
    const rows = await query(() => `
      SELECT id, slug, title, excerpt, content, cover_image, active, published_at, created_at
      FROM dbo.blog_posts
      WHERE active = 1
      ORDER BY published_at DESC, id DESC
    `);
    res.json(rows);
  } catch (error) {
    next(error);
  }
});

app.get('/sql/products', async (req, res, next) => {
  try {
    const rows = await getSqlProducts('WHERE p.is_active = 1');
    res.json(rows.map(mapProduct));
  } catch (error) {
    next(error);
  }
});

app.get('/sql/products/:slugOrId', async (req, res, next) => {
  try {
    const key = req.params.slugOrId;
    const isId = /^\d+$/.test(key);
    const rows = await getSqlProducts(
      `WHERE ${isId ? 'p.id = @key' : 'p.slug = @key'}`,
      (request) => request.input('key', isId ? sql.Int : sql.NVarChar, isId ? Number(key) : key)
    );
    if (!rows.length) {
      return res.status(404).json({ message: 'Product not found' });
    }
    const product = mapProduct(rows[0]);
    const [images, reviews] = await Promise.all([
      query((request) => {
        request.input('productId', sql.Int, product.id);
        return `
          SELECT id, image_url, alt_text, sort_order
          FROM dbo.product_images
          WHERE product_id = @productId
          ORDER BY sort_order, id
        `;
      }),
      query((request) => {
        request.input('productId', sql.Int, product.id);
        return `
          SELECT r.id, r.rating, r.comment, r.created_at, u.full_name
          FROM dbo.product_reviews r
          LEFT JOIN dbo.users u ON u.id = r.user_id
          WHERE r.product_id = @productId AND r.is_visible = 1
          ORDER BY r.created_at DESC, r.id DESC
        `;
      })
    ]);
    res.json({
      ...product,
      images,
      reviews: reviews.map((row) => ({
        id: row.id,
        rating: row.rating,
        comment: row.comment,
        created_at: row.created_at,
        name: row.full_name || 'Khach hang'
      }))
    });
  } catch (error) {
    next(error);
  }
});

app.get('/sql/reviews', async (req, res, next) => {
  try {
    const productId = Number(req.query.productId || 0);
    if (!productId) return res.json([]);
    const rows = await query((request) => {
      request.input('productId', sql.Int, productId);
      return `
        SELECT r.id, r.rating, r.comment, r.created_at, u.full_name
        FROM dbo.product_reviews r
        LEFT JOIN dbo.users u ON u.id = r.user_id
        WHERE r.product_id = @productId AND r.is_visible = 1
        ORDER BY r.created_at DESC, r.id DESC
      `;
    });
    res.json(rows.map((row) => ({
      id: row.id,
      rating: row.rating,
      comment: row.comment,
      created_at: row.created_at,
      name: row.full_name || 'Khach hang'
    })));
  } catch (error) {
    next(error);
  }
});

app.post('/sql/reviews', async (req, res, next) => {
  try {
    const { userId, productId, rating, comment } = req.body;
    if (!userId || !productId || !rating) {
      return res.status(400).json({ message: 'userId, productId and rating are required' });
    }
    await exec((request) => {
      request.input('userId', sql.Int, Number(userId));
      request.input('productId', sql.Int, Number(productId));
      request.input('rating', sql.Int, Number(rating));
      request.input('comment', sql.NVarChar(sql.MAX), String(comment || '').trim());
      return `
        INSERT INTO dbo.product_reviews(user_id, product_id, rating, comment, is_visible, created_at, updated_at, order_item_id)
        VALUES(@userId, @productId, @rating, @comment, 1, SYSDATETIME(), SYSDATETIME(), NULL);

        UPDATE dbo.products
        SET
          review_count = (SELECT COUNT(*) FROM dbo.product_reviews WHERE product_id = @productId AND is_visible = 1),
          rating = (
            SELECT CAST(AVG(CAST(rating AS DECIMAL(10,2))) AS DECIMAL(10,2))
            FROM dbo.product_reviews
            WHERE product_id = @productId AND is_visible = 1
          ),
          updated_at = SYSDATETIME()
        WHERE id = @productId;
      `;
    });
    res.status(201).json({ message: 'Review created' });
  } catch (error) {
    next(error);
  }
});

app.get('/sql/inventory', async (req, res, next) => {
  try {
    const rows = await query(() => `
      SELECT id AS product_id, stock_total AS quantity, updated_at
      FROM dbo.products
      WHERE is_active = 1
      ORDER BY id ASC
    `);
    res.json(rows.map((row) => ({
      product_id: row.product_id,
      quantity: Number(row.quantity || 0),
      updated_at: row.updated_at
    })));
  } catch (error) {
    next(error);
  }
});

app.patch('/sql/inventory/:productId', async (req, res, next) => {
  try {
    const productId = Number(req.params.productId);
    const quantity = Number(req.body.quantity);
    if (!productId || Number.isNaN(quantity) || quantity < 0) {
      return res.status(400).json({ message: 'Valid productId and non-negative quantity are required' });
    }
    const result = await query((request) => {
      request.input('productId', sql.Int, productId);
      request.input('quantity', sql.Int, quantity);
      return `
        UPDATE dbo.products
        SET stock_total = @quantity, updated_at = SYSDATETIME()
        OUTPUT INSERTED.id AS product_id, INSERTED.stock_total AS quantity, INSERTED.updated_at
        WHERE id = @productId
      `;
    });
    if (!result.length) return res.status(404).json({ message: 'Product not found' });
    res.json({
      product_id: result[0].product_id,
      quantity: Number(result[0].quantity || 0),
      updated_at: result[0].updated_at
    });
  } catch (error) {
    next(error);
  }
});

app.get('/sql/users', async (req, res, next) => {
  try {
    const rows = await query(() => `
      SELECT id, email, full_name, phone, role, points, membership_level, created_at, customer_tag
      FROM dbo.users
      ORDER BY id DESC
    `);
    res.json(rows.map(mapUser));
  } catch (error) {
    next(error);
  }
});

app.post('/sql/auth/register', async (req, res, next) => {
  try {
    const { name, email, password, phone, role } = req.body;
    if (!name || !email || !password) {
      return res.status(400).json({ message: 'name, email and password are required' });
    }
    const exists = await query((request) => {
      request.input('email', sql.NVarChar, String(email).trim());
      return 'SELECT TOP 1 id FROM dbo.users WHERE email = @email';
    });
    if (exists.length) {
      return res.status(409).json({ message: 'Email already exists' });
    }
    const passwordHash = await bcrypt.hash(String(password), 10);
    const rows = await query((request) => {
      request.input('email', sql.NVarChar, String(email).trim());
      request.input('passwordHash', sql.NVarChar, passwordHash);
      request.input('fullName', sql.NVarChar, String(name).trim());
      request.input('phone', sql.NVarChar, String(phone || '').trim());
      request.input('role', sql.NVarChar, String(role || 'customer').trim());
      return `
        INSERT INTO dbo.users(
          email, password_hash, full_name, phone, role, points, membership_level,
          is_active, created_at, updated_at, customer_tag, email_verified, verification_token
        )
        OUTPUT INSERTED.id, INSERTED.email, INSERTED.full_name, INSERTED.phone, INSERTED.role,
               INSERTED.points, INSERTED.membership_level, INSERTED.created_at, INSERTED.customer_tag
        VALUES(
          @email, @passwordHash, @fullName, @phone, @role, 0, 'New',
          1, SYSDATETIME(), SYSDATETIME(), 'new', 1, NULL
        )
      `;
    });
    res.status(201).json({ user: mapUser(rows[0]) });
  } catch (error) {
    next(error);
  }
});

app.post('/sql/auth/login', async (req, res, next) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ message: 'email and password are required' });
    }
    const rows = await query((request) => {
      request.input('email', sql.NVarChar, String(email).trim());
      return `
        SELECT TOP 1
          id, email, password_hash, full_name, phone, role, points, membership_level, created_at, customer_tag
        FROM dbo.users
        WHERE email = @email AND is_active = 1
      `;
    });
    if (!rows.length) {
      return res.status(401).json({ message: 'Invalid credentials' });
    }
    const userRow = rows[0];
    const ok = await bcrypt.compare(String(password), userRow.password_hash);
    if (!ok) {
      return res.status(401).json({ message: 'Invalid credentials' });
    }
    res.json({ user: mapUser(userRow) });
  } catch (error) {
    next(error);
  }
});

app.get('/sql/orders', async (req, res, next) => {
  try {
    const userId = Number(req.query.userId || 0);
    const rows = await query((request) => {
      if (userId) request.input('userId', sql.Int, userId);
      return `
        SELECT
          id, order_code, user_id, customer_name, email, phone,
          payment_method, payment_status, order_status, subtotal, discount_total,
          shipping_total, grand_total, shipping_address, note, coupon_code,
          guest_checkout, shipping_provider, tracking_code, created_at, updated_at, rewarded_points
        FROM dbo.orders
        ${userId ? 'WHERE user_id = @userId' : ''}
        ORDER BY id DESC
      `;
    });
    res.json(rows.map((row) => ({
      id: row.id,
      order_code: row.order_code,
      user_id: row.user_id,
      customer_name: row.customer_name,
      email: row.email,
      phone: row.phone,
      payment_method: row.payment_method,
      payment_status: row.payment_status,
      status: row.order_status,
      subtotal: Number(row.subtotal || 0),
      discount_total: Number(row.discount_total || 0),
      shipping_total: Number(row.shipping_total || 0),
      total: Number(row.grand_total || 0),
      shipping_address: row.shipping_address,
      note: row.note,
      coupon_code: row.coupon_code,
      guest_checkout: toBool(row.guest_checkout),
      created_at: row.created_at,
      updated_at: row.updated_at
    })));
  } catch (error) {
    next(error);
  }
});

app.patch('/sql/orders/:id/status', async (req, res, next) => {
  try {
    const orderId = Number(req.params.id);
    const status = String(req.body.status || '').trim().toLowerCase();
    const allowedStatuses = ['created', 'confirmed', 'processing', 'shipping', 'completed', 'cancelled'];

    if (!orderId) {
      return res.status(400).json({ message: 'Invalid order id' });
    }
    if (!allowedStatuses.includes(status)) {
      return res.status(400).json({ message: `Status must be one of: ${allowedStatuses.join(', ')}` });
    }

    const rows = await query((request) => {
      request.input('orderId', sql.Int, orderId);
      request.input('status', sql.NVarChar, status);
      return `
        UPDATE dbo.orders
        SET order_status = @status, updated_at = SYSDATETIME()
        OUTPUT INSERTED.id, INSERTED.order_code, INSERTED.order_status, INSERTED.updated_at
        WHERE id = @orderId
      `;
    });

    if (!rows.length) {
      return res.status(404).json({ message: 'Order not found' });
    }

    res.json({
      id: rows[0].id,
      order_code: rows[0].order_code,
      status: rows[0].order_status,
      updated_at: rows[0].updated_at
    });
  } catch (error) {
    next(error);
  }
});

app.get('/sql/orders/:id', async (req, res, next) => {
  try {
    const orderId = Number(req.params.id);
    const rows = await query((request) => {
      request.input('orderId', sql.Int, orderId);
      return `
        SELECT
          id, order_code, user_id, customer_name, email, phone,
          payment_method, payment_status, order_status, subtotal, discount_total,
          shipping_total, grand_total, shipping_address, note, coupon_code,
          guest_checkout, shipping_provider, tracking_code, created_at, updated_at, rewarded_points
        FROM dbo.orders
        WHERE id = @orderId
      `;
    });
    if (!rows.length) return res.status(404).json({ message: 'Order not found' });
    const items = await query((request) => {
      request.input('orderId', sql.Int, orderId);
      return `
        SELECT id, order_id, product_id, variant_id, product_name, sku, quantity, unit_price, line_total, selected_services, created_at
        FROM dbo.order_items
        WHERE order_id = @orderId
        ORDER BY id ASC
      `;
    });
    res.json({
      id: rows[0].id,
      order_code: rows[0].order_code,
      user_id: rows[0].user_id,
      customer_name: rows[0].customer_name,
      email: rows[0].email,
      phone: rows[0].phone,
      payment_method: rows[0].payment_method,
      payment_status: rows[0].payment_status,
      status: rows[0].order_status,
      subtotal: Number(rows[0].subtotal || 0),
      discount_total: Number(rows[0].discount_total || 0),
      shipping_total: Number(rows[0].shipping_total || 0),
      total: Number(rows[0].grand_total || 0),
      shipping_address: rows[0].shipping_address,
      note: rows[0].note,
      coupon_code: rows[0].coupon_code,
      guest_checkout: toBool(rows[0].guest_checkout),
      created_at: rows[0].created_at,
      updated_at: rows[0].updated_at,
      items: items.map((item) => ({
        id: item.id,
        order_id: item.order_id,
        product_id: item.product_id,
        variant_id: item.variant_id,
        product_name: item.product_name,
        sku: item.sku,
        quantity: item.quantity,
        unit_price: Number(item.unit_price || 0),
        line_total: Number(item.line_total || 0),
        selected_services: item.selected_services,
        created_at: item.created_at
      }))
    });
  } catch (error) {
    next(error);
  }
});

app.post('/sql/orders/checkout', async (req, res, next) => {
  const { userId, items, paymentMethod, note } = req.body;
  if (!Array.isArray(items) || !items.length) {
    return res.status(400).json({ message: 'items are required' });
  }

  const pool = await getPool();
  const transaction = new sql.Transaction(pool);

  try {
    await transaction.begin();

    const userRequest = new sql.Request(transaction);
    userRequest.input('userId', sql.Int, Number(userId || 0));
    const userResult = await userRequest.query(`
      SELECT TOP 1 id, full_name, email, phone
      FROM dbo.users
      WHERE id = @userId
    `);
    const user = userResult.recordset[0];
    if (!user) {
      await transaction.rollback();
      return res.status(400).json({ message: 'User not found in SQL database' });
    }

    const productIds = items.map((item) => Number(item.productId)).filter(Boolean);
    const productRequest = new sql.Request(transaction);
    const idList = productIds.join(',');
    const productResult = await productRequest.query(`
      SELECT id, sku, name, price, sale_price, stock_total
      FROM dbo.products
      WHERE id IN (${idList})
    `);
    const products = productResult.recordset;
    if (products.length !== productIds.length) {
      await transaction.rollback();
      return res.status(400).json({ message: 'One or more products were not found' });
    }

    const lines = items.map((item) => {
      const product = products.find((entry) => Number(entry.id) === Number(item.productId));
      const quantity = Number(item.quantity || 0);
      if (!product || quantity <= 0) {
        throw new Error('Invalid order item');
      }
      if (Number(product.stock_total || 0) < quantity) {
        throw new Error(`Not enough stock for product ${product.name}`);
      }
      const unitPrice = Number(product.sale_price || product.price || 0);
      return {
        product,
        quantity,
        unitPrice,
        lineTotal: unitPrice * quantity
      };
    });

    const subtotal = lines.reduce((sum, line) => sum + line.lineTotal, 0);
    const orderCode = `MS-${Date.now().toString(36).toUpperCase()}`;
    const orderRequest = new sql.Request(transaction);
    orderRequest.input('orderCode', sql.NVarChar, orderCode);
    orderRequest.input('userId', sql.Int, Number(user.id));
    orderRequest.input('customerName', sql.NVarChar, user.full_name);
    orderRequest.input('email', sql.NVarChar, user.email);
    orderRequest.input('phone', sql.NVarChar, user.phone || '');
    orderRequest.input('paymentMethod', sql.NVarChar, String(paymentMethod || 'microservice-demo'));
    orderRequest.input('note', sql.NVarChar(sql.MAX), String(note || '').trim());
    orderRequest.input('subtotal', sql.Decimal(18, 2), subtotal);
    orderRequest.input('grandTotal', sql.Decimal(18, 2), subtotal);
    const orderInsert = await orderRequest.query(`
      INSERT INTO dbo.orders(
        order_code, user_id, customer_name, email, phone, payment_method, payment_status,
        order_status, subtotal, discount_total, shipping_total, grand_total, shipping_address,
        note, coupon_code, guest_checkout, shipping_provider, tracking_code, created_at, updated_at, rewarded_points
      )
      OUTPUT INSERTED.id, INSERTED.order_code, INSERTED.created_at
      VALUES(
        @orderCode, @userId, @customerName, @email, @phone, @paymentMethod, 'pending',
        'created', @subtotal, 0, 0, @grandTotal, 'Frontend SQL adapter', @note, NULL,
        0, NULL, NULL, SYSDATETIME(), SYSDATETIME(), 0
      )
    `);
    const order = orderInsert.recordset[0];

    for (const line of lines) {
      const itemRequest = new sql.Request(transaction);
      itemRequest.input('orderId', sql.Int, order.id);
      itemRequest.input('productId', sql.Int, Number(line.product.id));
      itemRequest.input('productName', sql.NVarChar, line.product.name);
      itemRequest.input('sku', sql.NVarChar, line.product.sku || '');
      itemRequest.input('quantity', sql.Int, line.quantity);
      itemRequest.input('unitPrice', sql.Decimal(18, 2), line.unitPrice);
      itemRequest.input('lineTotal', sql.Decimal(18, 2), line.lineTotal);
      await itemRequest.query(`
        INSERT INTO dbo.order_items(
          order_id, product_id, variant_id, product_name, sku, quantity, unit_price, line_total, selected_services, created_at
        )
        VALUES(
          @orderId, @productId, NULL, @productName, @sku, @quantity, @unitPrice, @lineTotal, NULL, SYSDATETIME()
        )
      `);

      const stockRequest = new sql.Request(transaction);
      stockRequest.input('productId', sql.Int, Number(line.product.id));
      stockRequest.input('quantity', sql.Int, line.quantity);
      await stockRequest.query(`
        UPDATE dbo.products
        SET stock_total = stock_total - @quantity,
            sold_count = ISNULL(sold_count, 0) + @quantity,
            updated_at = SYSDATETIME()
        WHERE id = @productId
      `);
    }

    const noteRequest = new sql.Request(transaction);
    noteRequest.input('userId', sql.Int, Number(user.id));
    noteRequest.input('title', sql.NVarChar, `Don hang ${order.order_code} da duoc tao`);
    noteRequest.input('message', sql.NVarChar(sql.MAX), `Don hang tri gia ${subtotal.toLocaleString('vi-VN')} VND dang cho xu ly.`);
    await noteRequest.query(`
      INSERT INTO dbo.notifications(user_id, coupon_id, title, message, is_read, sent_at)
      VALUES(@userId, NULL, @title, @message, 0, SYSDATETIME())
    `);

    await transaction.commit();
    res.status(201).json({
      id: order.id,
      order_code: order.order_code,
      created_at: order.created_at,
      user_id: Number(user.id),
      total: subtotal,
      status: 'created'
    });
  } catch (error) {
    await transaction.rollback().catch(() => {});
    next(error);
  }
});

app.get('/sql/notifications', async (req, res, next) => {
  try {
    const userId = Number(req.query.userId || 0);
    const rows = await query((request) => {
      if (userId) request.input('userId', sql.Int, userId);
      return `
        SELECT id, user_id, coupon_id, title, message, is_read, sent_at
        FROM dbo.notifications
        ${userId ? 'WHERE user_id = @userId' : ''}
        ORDER BY sent_at DESC, id DESC
      `;
    });
    res.json(rows.map((row) => ({
      id: row.id,
      user_id: row.user_id,
      coupon_id: row.coupon_id,
      title: row.title,
      content: row.message,
      message: row.message,
      is_read: toBool(row.is_read),
      created_at: row.sent_at,
      sent_at: row.sent_at,
      event_type: row.coupon_id ? 'coupon' : 'order'
    })));
  } catch (error) {
    next(error);
  }
});

app.post('/sql/products', async (req, res, next) => {
  try {
    const { name, brand, category, price, description, imageUrl } = req.body;
    if (!name || price == null) {
      return res.status(400).json({ message: 'name and price are required' });
    }
    const categories = await query((request) => {
      request.input('name', sql.NVarChar, String(category || 'Phụ kiện').trim());
      return `
        SELECT TOP 1 id, name FROM dbo.categories WHERE name = @name
        UNION ALL
        SELECT TOP 1 id, name FROM dbo.categories ORDER BY id
      `;
    });
    const categoryId = Number(categories[0]?.id || 1);
    const slug = slugify(name);
    const sku = `SQL-${Date.now().toString(36).toUpperCase()}`;
    const rows = await query((request) => {
      request.input('slug', sql.NVarChar, slug);
      request.input('sku', sql.NVarChar, sku);
      request.input('name', sql.NVarChar, String(name).trim());
      request.input('brand', sql.NVarChar, String(brand || '').trim());
      request.input('type', sql.NVarChar, String(category || 'Accessory').trim());
      request.input('categoryId', sql.Int, categoryId);
      request.input('description', sql.NVarChar(sql.MAX), String(description || '').trim());
      request.input('price', sql.Decimal(18, 2), Number(price));
      request.input('imageUrl', sql.NVarChar(sql.MAX), String(imageUrl || '').trim());
      return `
        INSERT INTO dbo.products(
          slug, sku, name, brand, type, category_id, description, long_description, price, sale_price,
          cost, tip_size, shaft_material, joint_type, wrap_type, butt_material,
          stock_total, rating, review_count, sold_count, is_featured, is_active, metadata, created_at, updated_at
        )
        OUTPUT INSERTED.id, INSERTED.slug, INSERTED.sku, INSERTED.name, INSERTED.brand, INSERTED.type,
               INSERTED.description, INSERTED.long_description, INSERTED.price, INSERTED.sale_price,
               INSERTED.stock_total, INSERTED.rating, INSERTED.review_count, INSERTED.sold_count,
               INSERTED.is_featured, INSERTED.is_active, INSERTED.created_at, INSERTED.updated_at
        VALUES(
          @slug, @sku, @name, @brand, @type, @categoryId, @description, @description, @price, @price,
          0, NULL, NULL, NULL, NULL, NULL,
          0, 0, 0, 0, 0, 1, NULL, SYSDATETIME(), SYSDATETIME()
        );
      `;
    });
    const product = rows[0];
    if (imageUrl) {
      await exec((request) => {
        request.input('productId', sql.Int, product.id);
        request.input('imageUrl', sql.NVarChar(sql.MAX), String(imageUrl).trim());
        return `
          INSERT INTO dbo.product_images(product_id, image_url, alt_text, sort_order, created_at)
          VALUES(@productId, @imageUrl, NULL, 1, SYSDATETIME())
        `;
      });
    }
    const refreshed = await getSqlProducts('WHERE p.id = @id', (request) => request.input('id', sql.Int, product.id));
    res.status(201).json(mapProduct(refreshed[0]));
  } catch (error) {
    next(error);
  }
});

app.put('/sql/products/:id', async (req, res, next) => {
  try {
    const productId = Number(req.params.id);
    const { name, brand, category, price, description, imageUrl } = req.body;
    if (!productId) return res.status(400).json({ message: 'Invalid product id' });
    const categories = await query((request) => {
      request.input('name', sql.NVarChar, String(category || '').trim());
      return `SELECT TOP 1 id FROM dbo.categories WHERE name = @name ORDER BY id`;
    });
    await exec((request) => {
      request.input('id', sql.Int, productId);
      request.input('slug', sql.NVarChar, slugify(name));
      request.input('name', sql.NVarChar, String(name || '').trim());
      request.input('brand', sql.NVarChar, String(brand || '').trim());
      request.input('type', sql.NVarChar, String(category || '').trim());
      request.input('categoryId', sql.Int, Number(categories[0]?.id || 1));
      request.input('description', sql.NVarChar(sql.MAX), String(description || '').trim());
      request.input('price', sql.Decimal(18, 2), Number(price || 0));
      request.input('imageUrl', sql.NVarChar(sql.MAX), String(imageUrl || '').trim());
      return `
        UPDATE dbo.products
        SET
          slug = @slug,
          name = @name,
          brand = @brand,
          type = @type,
          category_id = @categoryId,
          description = @description,
          long_description = @description,
          price = @price,
          sale_price = @price,
          updated_at = SYSDATETIME()
        WHERE id = @id;

        DELETE FROM dbo.product_images WHERE product_id = @id;

        ${imageUrl ? `
        INSERT INTO dbo.product_images(product_id, image_url, alt_text, sort_order, created_at)
        VALUES(@id, @imageUrl, NULL, 1, SYSDATETIME());
        ` : ''}
      `;
    });
    const refreshed = await getSqlProducts('WHERE p.id = @id', (request) => request.input('id', sql.Int, productId));
    if (!refreshed.length) return res.status(404).json({ message: 'Product not found' });
    res.json(mapProduct(refreshed[0]));
  } catch (error) {
    next(error);
  }
});

app.delete('/sql/products/:id', async (req, res, next) => {
  try {
    const productId = Number(req.params.id);
    if (!productId) return res.status(400).json({ message: 'Invalid product id' });
    await exec((request) => {
      request.input('id', sql.Int, productId);
      return `
        DELETE FROM dbo.product_images WHERE product_id = @id;
        DELETE FROM dbo.product_reviews WHERE product_id = @id;
        DELETE FROM dbo.product_services WHERE product_id = @id;
        DELETE FROM dbo.product_variants WHERE product_id = @id;
        DELETE FROM dbo.products WHERE id = @id;
      `;
    });
    res.json({ message: 'Product deleted', id: productId });
  } catch (error) {
    next(error);
  }
});

function proxy(target, basePath) {
  return createProxyMiddleware({
    target,
    changeOrigin: true,
    pathRewrite: (path) => {
      if (path === '/' || path === '') {
        return basePath;
      }
      return `${basePath}${path}`;
    },
    on: {
      proxyReq: fixRequestBody,
      error(err, req, res) {
        console.error('Proxy error:', err.message);
        res.status(502).json({ message: 'Service temporarily unavailable', error: err.message });
      }
    }
  });
}

app.use('/users', proxy(process.env.USER_SERVICE_URL || 'http://localhost:3001', '/users'));
app.use('/products', proxy(process.env.PRODUCT_SERVICE_URL || 'http://localhost:3002', '/products'));
app.use('/orders', proxy(process.env.ORDER_SERVICE_URL || 'http://localhost:3003', '/orders'));
app.use('/inventory', proxy(process.env.INVENTORY_SERVICE_URL || 'http://localhost:3004', '/inventory'));
app.use('/notifications', proxy(process.env.NOTIFICATION_SERVICE_URL || 'http://localhost:3005', '/notifications'));

app.use((error, req, res, next) => {
  console.error('SQL adapter error:', error);
  res.status(error.status || 500).json(error.data || { message: error.message || 'Internal server error' });
});

app.listen(PORT, () => {
  console.log(`API Gateway running on port ${PORT}`);
});
