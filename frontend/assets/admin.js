(function () {
  const store = window.BidaStore;
  const app = document.getElementById('adminApp');
  const state = {
    session: store.getSession(),
    activeTab: 'dashboard',
    health: null,
    products: [],
    orders: [],
    users: [],
    inventory: [],
    notifications: [],
    editingProductId: null
  };

  function $(selector, parent) {
    return (parent || document).querySelector(selector);
  }

  function $all(selector, parent) {
    return Array.from((parent || document).querySelectorAll(selector));
  }

  function esc(value) {
    return String(value || '').replace(/[&<>"']/g, function (char) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char];
    });
  }

  function fmtDate(value) {
    if (!value) return '-';
    return new Intl.DateTimeFormat('vi-VN', {
      dateStyle: 'medium',
      timeStyle: 'short'
    }).format(new Date(value));
  }

  function notify(text, type) {
    const node = document.createElement('div');
    node.className = `alert ${type || 'success'}`;
    Object.assign(node.style, {
      position: 'fixed',
      right: '20px',
      bottom: '20px',
      zIndex: '200'
    });
    node.textContent = text;
    document.body.appendChild(node);
    setTimeout(function () {
      node.remove();
    }, 2800);
  }

  function currentTheme() {
    if (localStorage.getItem(store.THEME_KEY) === 'light') {
      document.body.classList.add('light');
    } else {
      document.body.classList.remove('light');
    }
  }

  function stockStatus(stock) {
    if (stock <= 0) return '<span class="pill-status status-danger">Het hang</span>';
    if (stock < 5) return '<span class="pill-status status-warning">Sap het</span>';
    return '<span class="pill-status status-success">On dinh</span>';
  }

  function productStock(productId) {
    const found = state.inventory.find(function (item) {
      return Number(item.product_id) === Number(productId);
    });
    return Number(found?.quantity || 0);
  }

  function normalizedProducts() {
    return state.products.map(function (product) {
      return {
        ...product,
        stockTotal: productStock(product.id),
        actualPrice: product.sale_price && Number(product.sale_price) > 0 ? Number(product.sale_price) : Number(product.price || 0)
      };
    });
  }

  function orderStatusOptions() {
    return [
      ['created', 'Moi tao'],
      ['confirmed', 'Da xac nhan'],
      ['processing', 'Dang xu ly'],
      ['shipping', 'Dang giao'],
      ['completed', 'Hoan thanh'],
      ['cancelled', 'Da huy']
    ];
  }

  function orderStatusLabel(status) {
    const aliases = {
      pending_inventory: 'created',
      confirmed: 'confirmed',
      processing: 'processing',
      shipping: 'shipping',
      completed: 'completed',
      cancelled: 'cancelled'
    };
    const key = aliases[String(status || '').toLowerCase()] || String(status || '').toLowerCase();
    const match = orderStatusOptions().find(function (item) {
      return item[0] === key;
    });
    return match ? match[1] : (status || '-');
  }

  function orderStatusClass(status) {
    const key = String(status || '').toLowerCase();
    if (key === 'pending_inventory') return 'status-warning';
    if (key === 'completed' || key === 'confirmed') return 'status-success';
    if (key === 'cancelled') return 'status-danger';
    if (key === 'shipping' || key === 'processing' || key === 'created') return 'status-warning';
    return '';
  }

  async function loadData() {
    const [health, products, orders, users, inventory, notifications] = await Promise.all([
      store.requestSql('/health').catch(function () { return { status: 'DOWN', service: 'sql-adapter' }; }),
      store.requestSql('/products'),
      store.request('/orders'),
      store.requestSql('/users'),
      store.request('/inventory'),
      store.request('/notifications')
    ]);

    state.health = health;
    state.products = Array.isArray(products) ? products : [];
    state.orders = Array.isArray(orders) ? orders : [];
    state.users = Array.isArray(users) ? users : [];
    state.inventory = Array.isArray(inventory) ? inventory : [];
    state.notifications = Array.isArray(notifications) ? notifications : [];
  }

  function tabList() {
    return [
      ['dashboard', 'Tong quan'],
      ['products', 'San pham'],
      ['orders', 'Don hang'],
      ['users', 'Khach hang'],
      ['inventory', 'Ton kho'],
      ['notifications', 'Thong bao']
    ];
  }

  function tabIcon(id) {
    return ({
      dashboard: 'DB',
      products: 'SP',
      orders: 'DH',
      users: 'KH',
      inventory: 'TK',
      notifications: 'TB'
    })[id] || '--';
  }

  function renderLogin() {
    app.innerHTML = `
      <div class="login-screen">
        <div class="card login-card">
          <div class="section-title">
            <h1>Admin - Bida Pro Shop</h1>
            <span class="badge">SQL Server</span>
          </div>
          <p class="muted">Dang nhap bang tai khoan admin.</p>
          <form id="loginForm">
            <label><span>Email</span><input name="email" type="email" required /></label>
            <label><span>Mat khau</span><input name="password" type="password" required /></label>
            <button class="btn btn-primary" type="submit">Dang nhap admin</button>
          </form>
        </div>
      </div>
    `;

    $('#loginForm').onsubmit = async function (event) {
      event.preventDefault();
      const formData = new FormData(event.target);
      try {
        const data = await store.requestSql('/auth/login', {
          method: 'POST',
          body: JSON.stringify({
            email: formData.get('email'),
            password: formData.get('password')
          })
        });
        if (data.user?.role !== 'admin') {
          notify('Tai khoan nay khong co quyen admin.', 'danger');
          return;
        }
        store.setSession({ user: data.user });
        state.session = store.getSession();
        await bootstrap();
      } catch (error) {
        notify(error.message, 'danger');
      }
    };
  }

  function renderShell() {
    const activeTitle = tabList().find(function (tab) {
      return tab[0] === state.activeTab;
    })?.[1] || '';

    app.innerHTML = `
      <div class="admin-shell">
        <aside class="admin-sidebar">
          <div class="logo admin-brand">
            <span class="logo-mark">8</span>
            <span class="admin-brand-text">Admin Panel</span>
          </div>
          <div class="notice admin-user-card">
            <strong>${esc(state.session.user.name)}</strong>
            <div class="muted">${esc(state.session.user.email)}</div>
            <div class="muted">role: ${esc(state.session.user.role)}</div>
          </div>
          <div class="admin-menu">
            ${tabList().map(function (tab) {
              return `
                <button class="btn ${state.activeTab === tab[0] ? 'btn-primary' : ''}" data-tab="${tab[0]}" type="button">
                  <span class="admin-nav-icon">${tabIcon(tab[0])}</span>
                  <span class="admin-nav-label">${esc(tab[1])}</span>
                </button>
              `;
            }).join('')}
          </div>
          <div class="admin-sidebar-actions">
            <button class="btn" id="openFrontendBtn" type="button">
              <span class="admin-nav-icon">WE</span>
              <span class="admin-nav-label">Mo web khach</span>
            </button>
            <button class="btn" id="toggleThemeBtn" type="button">
              <span class="admin-nav-icon">GD</span>
              <span class="admin-nav-label">Doi giao dien</span>
            </button>
            <button class="btn btn-danger" id="logoutBtn" type="button">
              <span class="admin-nav-icon">DX</span>
              <span class="admin-nav-label">Dang xuat</span>
            </button>
          </div>
        </aside>
        <main class="admin-content">
          <div class="admin-topbar">
            <div>
              <h1 style="margin:0;">${esc(activeTitle)}</h1>
            </div>
            <div class="inline-actions">
              <button class="btn" id="reloadAdminBtn" type="button">Dong bo du lieu</button>
            </div>
          </div>
          <div id="tabContent"></div>
        </main>
      </div>
    `;
  }

  function bindShellEvents() {
    $all('[data-tab]').forEach(function (button) {
      button.onclick = async function () {
        state.activeTab = button.dataset.tab;
        renderShell();
        bindShellEvents();
        await renderTab();
      };
    });

    $('#openFrontendBtn').onclick = function () {
      window.open('index.html', '_blank');
    };

    $('#toggleThemeBtn').onclick = function () {
      document.body.classList.toggle('light');
      localStorage.setItem(store.THEME_KEY, document.body.classList.contains('light') ? 'light' : 'dark');
    };

    $('#logoutBtn').onclick = function () {
      store.clearSession();
      window.location.reload();
    };

    $('#reloadAdminBtn').onclick = async function () {
      await loadData();
      renderShell();
      bindShellEvents();
      await renderTab();
      notify('Da dong bo du lieu admin.');
    };
  }

  function renderDashboard() {
    const products = normalizedProducts();
    const revenue = state.orders.reduce(function (sum, order) {
      return sum + Number(order.total || 0);
    }, 0);
    const lowStock = products.filter(function (product) {
      return product.stockTotal < 5;
    }).slice(0, 8);

    $('#tabContent').innerHTML = `
      <div class="stats-grid">
        <div class="stat-card"><h3>Doanh thu</h3><strong>${store.currency(revenue)}</strong></div>
        <div class="stat-card"><h3>Don hang</h3><strong>${state.orders.length}</strong></div>
        <div class="stat-card"><h3>Khach hang</h3><strong>${state.users.length}</strong></div>
        <div class="stat-card"><h3>Thong bao</h3><strong>${state.notifications.length}</strong></div>
      </div>
      <div class="grid-2" style="margin-top:18px;">
        <div class="card" style="padding:18px;">
          <h2>Don hang gan day</h2>
          <table class="admin-table compact">
            <thead><tr><th>Ma don</th><th>Khach</th><th>Tong</th><th>Trang thai</th></tr></thead>
            <tbody>
              ${state.orders.slice(0, 8).map(function (order) {
                return `<tr><td>${esc(order.order_code || `#${order.id}`)}</td><td>${esc(order.customer_name || `User ${order.user_id}`)}</td><td>${store.currency(order.total || 0)}</td><td><span class="pill-status ${orderStatusClass(order.status)}">${esc(orderStatusLabel(order.status))}</span></td></tr>`;
              }).join('') || '<tr><td colspan="4" class="muted">Chua co don hang.</td></tr>'}
            </tbody>
          </table>
        </div>
        <div class="card" style="padding:18px;">
          <h2>Canh bao ton kho</h2>
          <table class="admin-table compact">
            <thead><tr><th>San pham</th><th>Ton</th><th>Trang thai</th></tr></thead>
            <tbody>
              ${lowStock.map(function (product) {
                return `<tr><td>${esc(product.name)}</td><td>${product.stockTotal}</td><td>${stockStatus(product.stockTotal)}</td></tr>`;
              }).join('') || '<tr><td colspan="3" class="muted">Kho dang on dinh.</td></tr>'}
            </tbody>
          </table>
        </div>
      </div>
    `;
  }

  function loadProductIntoForm(productId) {
    const product = normalizedProducts().find(function (item) {
      return Number(item.id) === Number(productId);
    });
    if (!product) return;

    state.editingProductId = product.id;
    const form = $('#productForm');
    form.name.value = product.name || '';
    form.brand.value = product.brand || '';
    form.category.value = product.type || product.category || '';
    form.price.value = product.actualPrice || product.price || 0;
    form.description.value = product.description || '';
    form.imageUrl.value = product.image_url || '';
    $('#productFormTitle').textContent = `Sua san pham #${product.id}`;
    $('#productSubmitBtn').textContent = 'Luu thay doi';
    form.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function resetProductForm() {
    state.editingProductId = null;
    $('#productForm')?.reset();
    if ($('#productFormTitle')) $('#productFormTitle').textContent = 'Them / sua san pham';
    if ($('#productSubmitBtn')) $('#productSubmitBtn').textContent = 'Them san pham';
  }

  function renderProducts() {
    const products = normalizedProducts();

    $('#tabContent').innerHTML = `
      <div class="grid-2">
        <section class="card" style="padding:18px;">
          <div class="section-title"><h2>Danh sach san pham</h2></div>
          <div class="table-shell">
            <table class="admin-table beautiful-table compact">
              <thead><tr><th>ID</th><th>San pham</th><th>Brand</th><th>Gia</th><th>Ton</th><th>Xu ly</th></tr></thead>
              <tbody>
                ${products.map(function (product) {
                  return `
                    <tr>
                      <td>#${product.id}</td>
                      <td><strong>${esc(product.name)}</strong><div class="muted">${esc(product.type || '-')}</div></td>
                      <td>${esc(product.brand || '-')}</td>
                      <td>${store.currency(product.actualPrice)}</td>
                      <td>${product.stockTotal}</td>
                      <td class="inline-actions">
                        <button class="btn edit-product" data-id="${product.id}" type="button">Sua</button>
                        <button class="btn btn-danger delete-product" data-id="${product.id}" type="button">Xoa</button>
                      </td>
                    </tr>
                  `;
                }).join('') || '<tr><td colspan="6" class="muted">Chua co san pham.</td></tr>'}
              </tbody>
            </table>
          </div>
        </section>
        <section class="card" style="padding:18px;">
          <div class="section-title">
            <h2 id="productFormTitle">Them / sua san pham</h2>
            <button class="btn" id="resetProductBtn" type="button">Lam moi</button>
          </div>
          <form id="productForm">
            <div class="form-grid-2">
              <label><span>Ten san pham</span><input name="name" required /></label>
              <label><span>Thuong hieu</span><input name="brand" required /></label>
            </div>
            <div class="form-grid-2">
              <label><span>Loai</span><input name="category" value="Pool" required /></label>
              <label><span>Gia</span><input name="price" type="number" min="0" required /></label>
            </div>
            <label><span>Image URL</span><input name="imageUrl" /></label>
            <label><span>Mo ta</span><textarea name="description"></textarea></label>
            <button class="btn btn-primary" id="productSubmitBtn" type="submit">${state.editingProductId ? 'Luu thay doi' : 'Them san pham'}</button>
          </form>
        </section>
      </div>
    `;

    $all('.edit-product').forEach(function (button) {
      button.onclick = function () {
        loadProductIntoForm(button.dataset.id);
      };
    });

    $all('.delete-product').forEach(function (button) {
      button.onclick = async function () {
        if (!window.confirm(`Xoa san pham #${button.dataset.id}?`)) return;
        try {
          await store.requestSql(`/products/${button.dataset.id}`, { method: 'DELETE' });
          await loadData();
          renderProducts();
          notify('Da xoa san pham.');
        } catch (error) {
          notify(error.message, 'danger');
        }
      };
    });

    $('#resetProductBtn').onclick = resetProductForm;

    $('#productForm').onsubmit = async function (event) {
      event.preventDefault();
      const formData = new FormData(event.target);
      const payload = {
        name: formData.get('name'),
        brand: formData.get('brand'),
        category: formData.get('category'),
        price: Number(formData.get('price') || 0),
        description: formData.get('description'),
        imageUrl: formData.get('imageUrl')
      };
      const isEditing = Boolean(state.editingProductId);

      try {
        await store.requestSql(isEditing ? `/products/${state.editingProductId}` : '/products', {
          method: isEditing ? 'PUT' : 'POST',
          body: JSON.stringify(payload)
        });
        await loadData();
        resetProductForm();
        renderProducts();
        notify(isEditing ? 'Da cap nhat san pham.' : 'Da tao san pham.');
      } catch (error) {
        notify(error.message, 'danger');
      }
    };
  }

  async function renderOrders() {
    const orders = await Promise.all(state.orders.map(function (order) {
      return store.request(`/orders/${order.id}`).catch(function () {
        return order;
      });
    }));

    $('#tabContent').innerHTML = `
      <section class="card" style="padding:18px;">
        <div class="section-title"><h2>Danh sach don hang</h2></div>
        <div class="table-shell">
          <table class="admin-table beautiful-table">
            <thead><tr><th>Ma don</th><th>Khach</th><th>Tong</th><th>Trang thai</th><th>Cap nhat</th><th>Chi tiet</th></tr></thead>
            <tbody>
              ${orders.map(function (order) {
                return `
                  <tr>
                    <td>${esc(order.order_code || `#${order.id}`)}</td>
                    <td>${esc(order.customer_name || `User ${order.user_id}`)}</td>
                    <td>${store.currency(order.total || 0)}</td>
                    <td><span class="pill-status ${orderStatusClass(order.status)}">${esc(orderStatusLabel(order.status))}</span></td>
                    <td>
                      <div class="order-status-editor">
                        <select class="order-status-select" data-order-status="${order.id}">
                          ${orderStatusOptions().map(function (option) {
                            const currentStatus = String(order.status || '').toLowerCase() === 'pending_inventory'
                              ? 'created'
                              : String(order.status || '').toLowerCase();
                            return `<option value="${option[0]}" ${currentStatus === option[0] ? 'selected' : ''}>${option[1]}</option>`;
                          }).join('')}
                        </select>
                        <button class="btn btn-primary save-order-status" data-order-id="${order.id}" type="button">Luu</button>
                      </div>
                    </td>
                    <td>
                      ${(order.items || []).map(function (item) {
                        return `<div>${esc(item.product_name || `Product #${item.product_id}`)} x${item.quantity}</div>`;
                      }).join('') || '<span class="muted">Khong co item</span>'}
                    </td>
                  </tr>
                `;
              }).join('') || '<tr><td colspan="6" class="muted">Chua co don hang.</td></tr>'}
            </tbody>
          </table>
        </div>
      </section>
    `;

    $all('.save-order-status').forEach(function (button) {
      button.onclick = async function () {
        const orderId = button.dataset.orderId;
        const select = $(`[data-order-status="${orderId}"]`);
        if (!select) return;

        button.disabled = true;
        button.textContent = 'Dang luu...';
        try {
          await store.request(`/orders/${orderId}/status`, {
            method: 'PATCH',
            body: JSON.stringify({ status: select.value })
          });
          await loadData();
          await renderOrders();
          notify('Da cap nhat trang thai don hang.');
        } catch (error) {
          notify(error.message, 'danger');
        } finally {
          button.disabled = false;
          button.textContent = 'Luu';
        }
      };
    });
  }

  function renderUsers() {
    $('#tabContent').innerHTML = `
      <section class="card" style="padding:18px;">
        <div class="section-title">
          <h2>Danh sach khach hang</h2>
          <div class="customer-total-badge">${state.users.length} tai khoan</div>
        </div>
        <div class="customer-card-list customer-card-grid customer-card-grid-wide">
          ${state.users.map(function (user) {
            return `
              <article class="customer-card">
                <div class="customer-card-top">
                  <div class="customer-avatar">${esc(String(user.name || '?').slice(0, 2).toUpperCase())}</div>
                  <div>
                    <strong>${esc(user.name)}</strong>
                    <div class="muted">${esc(user.email)}</div>
                    <div class="tag-pill ${user.role === 'admin' ? 'vip' : 'new'}">${esc(user.role)}</div>
                  </div>
                </div>
                <div class="customer-card-stats">
                  <div><span>User ID</span><strong>${user.id}</strong></div>
                  <div><span>Diem</span><strong>${user.points || 0}</strong></div>
                  <div><span>Tao luc</span><strong>${fmtDate(user.created_at)}</strong></div>
                </div>
              </article>
            `;
          }).join('') || '<div class="customer-empty-state">Chua co tai khoan nao.</div>'}
        </div>
      </section>
    `;
  }

  function renderInventory() {
    const products = normalizedProducts();

    $('#tabContent').innerHTML = `
      <div class="grid-2">
        <section class="card" style="padding:18px;">
          <div class="section-title"><h2>Cap nhat ton kho</h2></div>
          <form id="inventoryForm">
            <label><span>San pham</span>
              <select name="productId">
                ${products.map(function (product) {
                  return `<option value="${product.id}">${esc(product.name)} (#${product.id})</option>`;
                }).join('')}
              </select>
            </label>
            <label><span>So luong moi</span><input name="quantity" type="number" min="0" value="20" required /></label>
            <button class="btn btn-primary" type="submit">Cap nhat ton</button>
          </form>
        </section>
        <section class="card" style="padding:18px;">
          <div class="section-title"><h2>Snapshot inventory</h2></div>
          <table class="admin-table compact">
            <thead><tr><th>Product ID</th><th>San pham</th><th>Ton</th><th>Trang thai</th></tr></thead>
            <tbody>
              ${products.map(function (product) {
                return `<tr><td>${product.id}</td><td>${esc(product.name)}</td><td>${product.stockTotal}</td><td>${stockStatus(product.stockTotal)}</td></tr>`;
              }).join('') || '<tr><td colspan="4" class="muted">Chua co du lieu ton kho.</td></tr>'}
            </tbody>
          </table>
        </section>
      </div>
    `;

    $('#inventoryForm').onsubmit = async function (event) {
      event.preventDefault();
      const formData = new FormData(event.target);
      try {
        await store.request(`/inventory/${formData.get('productId')}`, {
          method: 'PATCH',
          body: JSON.stringify({ quantity: Number(formData.get('quantity') || 0) })
        });
        await loadData();
        renderInventory();
        notify('Da cap nhat ton kho.');
      } catch (error) {
        notify(error.message, 'danger');
      }
    };
  }

  function renderNotifications() {
    $('#tabContent').innerHTML = `
      <section class="card" style="padding:18px;">
        <div class="section-title"><h2>Thong bao va event feed</h2></div>
        <div class="kpi-list">
          ${state.notifications.map(function (note) {
            return `
              <div class="notice">
                <div class="list-line">
                  <strong>${esc(note.title)}</strong>
                  <span>${fmtDate(note.created_at || note.sent_at)}</span>
                </div>
                <div class="muted">${esc(note.content || note.message || '')}</div>
                <div class="muted">${esc(note.event_type || 'notification')}</div>
              </div>
            `;
          }).join('') || '<div class="muted">Chua co notification nao.</div>'}
        </div>
      </section>
    `;
  }

  async function renderTab() {
    if (state.activeTab === 'dashboard') {
      renderDashboard();
      return;
    }
    if (state.activeTab === 'products') {
      renderProducts();
      return;
    }
    if (state.activeTab === 'orders') {
      await renderOrders();
      return;
    }
    if (state.activeTab === 'users') {
      renderUsers();
      return;
    }
    if (state.activeTab === 'inventory') {
      renderInventory();
      return;
    }
    if (state.activeTab === 'notifications') {
      renderNotifications();
    }
  }

  async function bootstrap() {
    currentTheme();
    state.session = store.getSession();

    if (!state.session?.user || state.session.user.role !== 'admin') {
      renderLogin();
      return;
    }

    try {
      await loadData();
      renderShell();
      bindShellEvents();
      await renderTab();
    } catch (error) {
      app.innerHTML = `<div class="login-screen"><div class="card login-card"><div class="alert danger">Khong tai duoc admin: ${esc(error.message)}</div></div></div>`;
    }
  }

  bootstrap();
})();
