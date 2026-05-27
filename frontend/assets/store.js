(function () {
  const API_BASE = `${window.location.protocol}//${window.location.hostname}:8081`;
  const SQL_BASE = `${API_BASE}/sql`;
  const TOKEN_KEY = 'billiard_shop_token';
  const SESSION_KEY = 'billiard_shop_session';
  const CART_KEY = 'billiard_shop_cart';
  const THEME_KEY = 'billiard_shop_theme';
  const REVIEW_KEY = 'billiard_shop_reviews';

  function currency(value) {
    return new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' }).format(Number(value || 0));
  }

  function placeholderImage(label) {
    const text = String(label || 'Billiard Cue').slice(0, 32);
    return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(
      `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="800" viewBox="0 0 1200 800">
        <defs>
          <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stop-color="#dff7f1"/>
            <stop offset="100%" stop-color="#f5efe7"/>
          </linearGradient>
        </defs>
        <rect width="1200" height="800" fill="url(#bg)"/>
        <circle cx="980" cy="180" r="120" fill="#0f9f8f" opacity="0.12"/>
        <circle cx="180" cy="660" r="160" fill="#ef476f" opacity="0.08"/>
        <rect x="140" y="180" width="920" height="440" rx="36" fill="#ffffff" opacity="0.86"/>
        <text x="50%" y="44%" dominant-baseline="middle" text-anchor="middle" font-family="Arial, sans-serif" font-size="56" font-weight="700" fill="#17202a">${text}</text>
        <text x="50%" y="56%" dominant-baseline="middle" text-anchor="middle" font-family="Arial, sans-serif" font-size="28" fill="#5b6b7e">Bida Pro Shop</text>
      </svg>`
    )}`;
  }

  function slugify(value) {
    return String(value || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
  }

  function readJson(key, fallback) {
    try {
      return JSON.parse(localStorage.getItem(key) || JSON.stringify(fallback));
    } catch {
      return fallback;
    }
  }

  function writeJson(key, value) {
    localStorage.setItem(key, JSON.stringify(value));
    return value;
  }

  function getToken() {
    return localStorage.getItem(TOKEN_KEY) || '';
  }

  function setToken(token) {
    if (token) {
      localStorage.setItem(TOKEN_KEY, token);
    } else {
      localStorage.removeItem(TOKEN_KEY);
    }
  }

  function getSession() {
    return readJson(SESSION_KEY, null);
  }

  function setSession(session) {
    return writeJson(SESSION_KEY, session);
  }

  function clearSession() {
    localStorage.removeItem(SESSION_KEY);
    localStorage.removeItem(TOKEN_KEY);
  }

  function getCart() {
    return readJson(CART_KEY, { items: [] });
  }

  function setCart(cart) {
    return writeJson(CART_KEY, cart || { items: [] });
  }

  function getReviews() {
    return readJson(REVIEW_KEY, {});
  }

  function saveReview(slug, review) {
    const reviews = getReviews();
    const key = String(slug || '');
    reviews[key] = reviews[key] || [];
    reviews[key].unshift({
      ...review,
      id: Date.now(),
      createdAt: new Date().toISOString()
    });
    writeJson(REVIEW_KEY, reviews);
    return reviews[key];
  }

  async function request(path, options = {}) {
    const headers = { ...(options.headers || {}) };
    const isFormData = typeof FormData !== 'undefined' && options.body instanceof FormData;
    if (!isFormData && !headers['Content-Type']) {
      headers['Content-Type'] = 'application/json';
    }

    const token = getToken();
    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }

    const response = await fetch(`${API_BASE}${path}`, { ...options, headers });
    const text = await response.text();
    let data = {};

    if (text) {
      try {
        data = JSON.parse(text);
      } catch {
        throw new Error(`API tra ve du lieu khong hop le cho ${path}`);
      }
    }

    if (!response.ok) {
      throw new Error(data.message || `HTTP ${response.status}`);
    }

    return data;
  }

  async function requestSql(path, options = {}) {
    const response = await fetch(`${SQL_BASE}${path}`, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...(options.headers || {})
      }
    });
    const text = await response.text();
    const data = text ? JSON.parse(text) : {};
    if (!response.ok) {
      throw new Error(data.message || `HTTP ${response.status}`);
    }
    return data;
  }

  function resolveMediaUrl(url, fallbackLabel) {
    const value = String(url || '').trim().replace(/\\/g, '/');
    if (!value) {
      return placeholderImage(fallbackLabel);
    }
    if (/^data:|^https?:/i.test(value)) {
      return value;
    }
    if (/^\/uploads\//i.test(value)) {
      return `${window.location.origin}/assets${value}`;
    }
    if (/^uploads\//i.test(value)) {
      return `${window.location.origin}/assets/${value}`;
    }
    return value;
  }

  function productSlug(product) {
    return `${slugify(product.name)}-${product.id}`;
  }

  function image(product) {
    const url = String(product?.image_url || '').trim();
    return resolveMediaUrl(url, product?.name);
  }

  function cartCount() {
    return getCart().items.reduce((sum, item) => sum + Number(item.quantity || 0), 0);
  }

  window.BidaStore = {
    API_BASE,
    SQL_BASE,
    TOKEN_KEY,
    SESSION_KEY,
    CART_KEY,
    THEME_KEY,
    REVIEW_KEY,
    currency,
    slugify,
    request,
    requestSql,
    getToken,
    setToken,
    getSession,
    setSession,
    clearSession,
    getCart,
    setCart,
    getReviews,
    saveReview,
    resolveMediaUrl,
    productSlug,
    image,
    placeholderImage,
    cartCount
  };
})();
