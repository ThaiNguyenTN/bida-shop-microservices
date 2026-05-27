(function () {
  const store = window.BidaStore;
  const page = document.body.dataset.page;
  const app = document.getElementById('app');
  const state = {
    session: store.getSession(),
    settings: {},
    health: null,
    products: [],
    inventory: [],
    inventoryMap: new Map(),
    banners: [],
    posts: [],
    notifications: []
  };
  const LOCAL_BANNER_IMAGES = [
    '/uploads/banners/654726530-947000328192451-4563381930069128184-n-1776303571047-pf554u.jpg',
    '/uploads/banners/co-pha-nhay-1776303840426-m5ouap.jpg',
    '/uploads/banners/quoc-hoang-266-1714964573927282173865-1776304263384-7ap88k.webp'
  ];

  function $(selector, parent) {
    return (parent || document).querySelector(selector);
  }

  function $all(selector, parent) {
    return Array.from((parent || document).querySelectorAll(selector));
  }

  function param(name) {
    return new URLSearchParams(window.location.search).get(name);
  }

  function esc(value) {
    return String(value || '').replace(/[&<>"']/g, function (char) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char];
    });
  }

  function notify(text, type) {
    const node = document.createElement('div');
    node.className = `alert ${type || 'success'}`;
    node.style.position = 'fixed';
    node.style.left = '50%';
    node.style.bottom = '24px';
    node.style.transform = 'translateX(-50%)';
    node.style.zIndex = '120';
    node.textContent = text;
    document.body.appendChild(node);
    setTimeout(function () { node.remove(); }, 2600);
  }

  function currentTheme() {
    if (localStorage.getItem(store.THEME_KEY) === 'light') {
      document.body.classList.add('light');
    }
  }

  function setTheme(nextTheme) {
    document.body.classList.toggle('light', nextTheme === 'light');
    localStorage.setItem(store.THEME_KEY, nextTheme);
  }

  function fmtDate(value) {
    if (!value) return '-';
    return new Intl.DateTimeFormat('vi-VN', {
      dateStyle: 'medium',
      timeStyle: 'short'
    }).format(new Date(value));
  }

  function stars(value) {
    const rounded = Math.max(1, Math.min(5, Math.round(Number(value || 0))));
    return '★'.repeat(rounded) + '☆'.repeat(Math.max(0, 5 - rounded));
  }

  function orderStatusText(value) {
    const key = String(value || '').toLowerCase();
    return ({
      pending_inventory: 'Cho xu ly ton kho',
      confirmed: 'Da xac nhan',
      processing: 'Dang xu ly',
      shipping: 'Dang giao',
      completed: 'Hoan thanh',
      cancelled: 'Da huy'
    })[key] || (value || '-');
  }

  function imageMarkup(src, label, extraAttrs) {
    const safeSrc = store.resolveMediaUrl(src, label);
    const fallback = store.placeholderImage(label).replace(/'/g, '&#39;');
    return `<img src="${safeSrc}" alt="${esc(label)}" ${extraAttrs || ''} onerror="this.onerror=null;this.src='${fallback}'" />`;
  }

  function bannerImageUrl(banner, index) {
    const value = String(banner?.image_url || '').trim();
    if (/^\/?uploads\//i.test(value)) {
      return value;
    }
    return LOCAL_BANNER_IMAGES[index % LOCAL_BANNER_IMAGES.length] || value;
  }

  function featuredBrands(products) {
    const byBrand = new Map();
    products.forEach(function (product) {
      const key = String(product.brand || 'Billiard').trim();
      if (!byBrand.has(key)) {
        byBrand.set(key, product);
      }
    });
    return Array.from(byBrand.entries()).slice(0, 4).map(function ([brand, product]) {
      return { brand, product };
    });
  }

  function normalizedProducts() {
    return state.products.map(function (product) {
      const actualPrice = product.sale_price && Number(product.sale_price) > 0 ? Number(product.sale_price) : Number(product.price || 0);
      return {
        ...product,
        slug: product.slug || store.productSlug(product),
        type: product.type || product.category || 'Pool',
        coverImage: store.resolveMediaUrl(product.image_url, product.name),
        stockTotal: Number(state.inventoryMap.get(Number(product.id)) || product.stock_total || 0),
        ratingValue: Number(product.rating || 0),
        reviewCountValue: Number(product.review_count || 0),
        actualPrice
      };
    });
  }

  function getProductById(productId) {
    return normalizedProducts().find(function (product) {
      return Number(product.id) === Number(productId);
    });
  }

  function getProductBySlug(slug) {
    return normalizedProducts().find(function (product) {
      return String(product.slug) === String(slug);
    });
  }

  function getCart() {
    return store.getCart();
  }

  function setCart(cart) {
    store.setCart(cart);
    renderHeaderCounts();
  }

  function cartLines() {
    return getCart().items.map(function (item) {
      const product = getProductById(item.productId);
      if (!product) return null;
      return {
        ...item,
        product,
        subtotal: Number(product.actualPrice) * Number(item.quantity)
      };
    }).filter(Boolean);
  }

  function cartSummary() {
    const lines = cartLines();
    return {
      lines,
      totalQuantity: lines.reduce(function (sum, line) { return sum + Number(line.quantity); }, 0),
      subtotal: lines.reduce(function (sum, line) { return sum + Number(line.subtotal); }, 0)
    };
  }

  function addToCart(productId, quantity) {
    const cart = getCart();
    const product = getProductById(productId);
    if (!product) return;

    const found = cart.items.find(function (item) {
      return Number(item.productId) === Number(productId);
    });
    const nextQuantity = (found ? found.quantity : 0) + Number(quantity || 1);
    if (product.stockTotal > 0 && nextQuantity > product.stockTotal) {
      notify('So luong vuot qua ton kho hien tai.', 'warning');
      return;
    }

    if (found) {
      found.quantity = nextQuantity;
    } else {
      cart.items.push({ productId: Number(productId), quantity: Number(quantity || 1) });
    }

    setCart(cart);
    notify(`Da them ${product.name} vao gio hang.`);
  }

  function updateCartQuantity(productId, nextQuantity) {
    const cart = getCart();
    const found = cart.items.find(function (item) {
      return Number(item.productId) === Number(productId);
    });
    if (!found) return;

    if (nextQuantity <= 0) {
      cart.items = cart.items.filter(function (item) {
        return Number(item.productId) !== Number(productId);
      });
    } else {
      const product = getProductById(productId);
      if (product && product.stockTotal > 0 && nextQuantity > product.stockTotal) {
        notify('So luong vuot qua ton kho hien tai.', 'warning');
        return;
      }
      found.quantity = nextQuantity;
    }
    setCart(cart);
    if (page === 'cart') {
      renderCartPage();
    }
  }

  function renderHeader() {
    currentTheme();
    document.querySelector('.topbar')?.remove();
    document.querySelector('.floating-actions')?.remove();
    document.querySelector('.footer')?.remove();

    state.session = store.getSession();
    const siteName = state.settings.siteName || 'Bida Pro Shop';

    const header = document.createElement('header');
    header.className = 'topbar';
    header.innerHTML = `
      <div class="container">
        <a class="logo" href="index.html">
          <span class="logo-mark">8</span>
          <span>${esc(siteName)}</span>
        </a>
        <nav class="nav">
          <a class="${page === 'home' ? 'active' : ''}" href="index.html">Trang chu</a>
          <a class="${page === 'products' ? 'active' : ''}" href="products.html">San pham</a>
          <a class="${page === 'cart' ? 'active' : ''}" href="cart.html">Gio hang</a>
          <a class="${page === 'account' || page === 'review' ? 'active' : ''}" href="account.html">Tai khoan</a>
          <a class="${page === 'blog' ? 'active' : ''}" href="blog.html">Blog</a>
          <a class="${page === 'info' ? 'active' : ''}" href="info.html">Thong tin</a>
          <a href="admin.html" target="_blank" rel="noreferrer">Admin</a>
        </nav>
        <div class="header-actions">
          <div class="search-box" style="min-width:280px;">
            <input id="smartSearch" type="search" placeholder="Tim gay, thuong hieu..." />
            <div class="search-suggest" id="searchSuggest"></div>
          </div>
          <button class="btn" id="themeToggle" type="button">${document.body.classList.contains('light') ? '☀' : '☾'}</button>
          <a class="btn" href="account.html">${esc(state.session?.user?.name || 'Dang nhap')}</a>
          <a class="btn btn-primary" href="cart.html" id="cartCountBtn">Gio hang ${store.cartCount()}</a>
        </div>
      </div>
    `;
    document.body.prepend(header);

    $('#themeToggle').onclick = function () {
      const next = document.body.classList.contains('light') ? 'dark' : 'light';
      setTheme(next);
      $('#themeToggle').textContent = next === 'light' ? '☀' : '☾';
    };

    const input = $('#smartSearch');
    const suggest = $('#searchSuggest');
    input.addEventListener('input', function () {
      const query = input.value.trim().toLowerCase();
      if (!query) {
        suggest.classList.remove('active');
        suggest.innerHTML = '';
        return;
      }
      const matches = normalizedProducts().filter(function (product) {
        return [product.name, product.brand, product.type, product.sku].join(' ').toLowerCase().includes(query);
      }).slice(0, 6);
      suggest.innerHTML = matches.length ? matches.map(function (product) {
        return `
          <a class="search-item" href="product.html?slug=${product.slug}">
            ${imageMarkup(product.coverImage, product.name, 'width="66" height="50" style="border-radius:12px;object-fit:cover;"')}
            <div>
              <strong>${esc(product.name)}</strong>
              <div class="muted">${esc(product.brand || '-')} • ${store.currency(product.actualPrice)}</div>
            </div>
          </a>
        `;
      }).join('') : '<div class="empty">Khong tim thay san pham phu hop.</div>';
      suggest.classList.add('active');
    });

    document.addEventListener('click', function (event) {
      if (!event.target.closest('.search-box')) {
        suggest.classList.remove('active');
      }
    });

    const floating = document.createElement('div');
    floating.className = 'floating-actions';
    floating.innerHTML = `
      <a href="tel:${String(state.settings.hotline || '0909123456').replace(/\s+/g, '')}" title="Hotline">☎</a>
      <a href="products.html" title="San pham">♣</a>
      <a href="cart.html" title="Gio hang">🛒</a>
    `;
    document.body.appendChild(floating);

    const footer = document.createElement('footer');
    footer.className = 'footer';
    footer.innerHTML = `
      <div class="container grid-3">
        <div>
          <div class="logo" style="margin-bottom:12px;">
            <span class="logo-mark">8</span>
            <span>${esc(siteName)}</span>
          </div>
          <p class="muted">Catalog doc tu SQL Server, con checkout va don hang di qua luong microservice.</p>
        </div>
        <div>
          <strong>Thong tin nhanh</strong>
          <div class="muted">Hotline: ${esc(state.settings.hotline || '0909 123 456')}</div>
          <div class="muted">Showroom: ${esc(state.settings.showroom || 'TP.HCM')}</div>
          <div class="muted">Gateway: ${esc(store.API_BASE)}</div>
        </div>
        <div>
          <strong>Danh muc</strong>
          <div class="muted"><a href="products.html">Cue catalog</a></div>
          <div class="muted"><a href="blog.html">Blog</a></div>
          <div class="muted"><a href="admin.html">Admin</a></div>
        </div>
      </div>
    `;
    document.body.appendChild(footer);
  }

  function renderHeaderCounts() {
    const button = $('#cartCountBtn');
    if (button) {
      button.textContent = `Gio hang ${store.cartCount()}`;
    }
  }

  function heroSlides(products) {
    if (state.banners.length) {
      return state.banners.slice(0, 4).map(function (banner, index) {
        return `
          <a class="hero-slide ${index === 0 ? 'active' : ''}" href="${esc(banner.href || 'products.html')}">
            ${imageMarkup(bannerImageUrl(banner, index), banner.title)}
            <div class="hero-overlay hero-bottom">
              <div class="badge active">Showroom</div>
              <h1>${esc(banner.title)}</h1>
              <p>${esc(banner.subtitle || 'Bo suu tap moi cho nguoi choi bida yeu cau hieu nang va tham my.')}</p>
              <span class="btn btn-primary">Kham pha ngay</span>
            </div>
          </a>
        `;
      }).join('');
    }

    return products.slice(0, 3).map(function (product, index) {
      return `
        <a class="hero-slide ${index === 0 ? 'active' : ''}" href="product.html?slug=${product.slug}">
          ${imageMarkup(product.coverImage, product.name)}
          <div class="hero-overlay hero-bottom">
            <div class="badge active">${esc(product.brand || 'Billiard')}</div>
            <h1>${esc(product.name)}</h1>
            <p>${esc(product.description || 'Gay bida danh cho nguoi choi can do on dinh, can bang va cam tay chac.')}</p>
            <span class="btn btn-primary">Kham pha ngay</span>
          </div>
        </a>
      `;
    }).join('');
  }

  function initHeroSlider() {
    const slider = document.getElementById('heroSlider');
    if (!slider) return;
    const slides = Array.from(slider.querySelectorAll('.hero-slide'));
    const dots = Array.from(slider.querySelectorAll('.hero-dot'));
    const prev = document.getElementById('heroPrev');
    const next = document.getElementById('heroNext');
    let current = 0;
    let timer = null;
    if (slides.length <= 1) return;

    function show(index) {
      current = (index + slides.length) % slides.length;
      slides.forEach(function (slide, idx) { slide.classList.toggle('active', idx === current); });
      dots.forEach(function (dot, idx) { dot.classList.toggle('active', idx === current); });
    }

    function start() {
      stop();
      timer = setInterval(function () { show(current + 1); }, 4000);
    }

    function stop() {
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
    }

    prev?.addEventListener('click', function () { show(current - 1); start(); });
    next?.addEventListener('click', function () { show(current + 1); start(); });
    dots.forEach(function (dot) {
      dot.addEventListener('click', function () {
        show(Number(dot.dataset.index || 0));
        start();
      });
    });
    slider.addEventListener('mouseenter', stop);
    slider.addEventListener('mouseleave', start);
    start();
  }

  function productCard(product) {
    return `
      <article class="card product-card">
        ${imageMarkup(product.coverImage, product.name, 'loading="lazy"')}
        <div class="product-content">
          <div class="meta-row">
            <span class="badge">${esc(product.brand || 'No brand')}</span>
            <span>${esc(product.type)}</span>
            <span>${product.stockTotal > 0 ? `Con ${product.stockTotal}` : 'Het hang'}</span>
          </div>
          <h3>${esc(product.name)}</h3>
          <div class="price-row" style="margin:10px 0 14px;">
            <strong>${store.currency(product.actualPrice)}</strong>
            ${product.sale_price && Number(product.sale_price) < Number(product.price) ? `<span class="old-price">${store.currency(product.price)}</span>` : ''}
          </div>
          <div class="meta-row">
            <span class="rating">${stars(product.ratingValue || 0)}</span>
            <span>${product.reviewCountValue} danh gia</span>
          </div>
          <div class="inline-actions" style="margin-top:14px;">
            <a class="btn btn-primary" href="product.html?slug=${product.slug}">Xem chi tiet</a>
            <button class="btn" type="button" onclick="window.BidaCustomerApp.addToCart(${product.id}, 1)">Them gio</button>
          </div>
        </div>
      </article>
    `;
  }

  function renderHome() {
    const products = normalizedProducts();
    const brands = featuredBrands(products);

    app.innerHTML = `
      <section class="hero">
        <div class="container">
          <div class="hero-grid">
            <div class="hero-slider hero-card" id="heroSlider">
              <div class="hero-track">
                ${heroSlides(products)}
              </div>
              <button class="hero-nav prev" id="heroPrev" type="button">‹</button>
              <button class="hero-nav next" id="heroNext" type="button">›</button>
              <div class="hero-dots">
                ${(state.banners.length ? state.banners.slice(0, 4) : products.slice(0, 3)).map(function (_, index) {
                  return `<button class="hero-dot ${index === 0 ? 'active' : ''}" data-index="${index}" type="button"></button>`;
                }).join('')}
              </div>
            </div>
            <div class="hero-stats">
              <div class="hero-stat hero-card"><strong>${products.length}</strong><div class="muted">san pham dang mo ban</div></div>
              <div class="hero-stat hero-card"><strong>${products.filter(function (product) { return product.stockTotal > 0; }).length}</strong><div class="muted">mau con ton kho</div></div>
              <div class="hero-stat hero-card"><strong>${state.posts.length}</strong><div class="muted">bai viet tu SQL DB</div></div>
              <div class="hero-stat hero-card"><strong>${store.cartCount()}</strong><div class="muted">san pham trong gio</div></div>
            </div>
          </div>
        </div>
      </section>

      <section class="section">
        <div class="container">
          <div class="section-title">
            <div>
              <h2>Thuong hieu noi bat</h2>
              <p class="muted">Du lieu thuong hieu va san pham dang doc truc tiep tu table products cua BidaShopDB.</p>
            </div>
            <a class="btn" href="products.html">Xem tat ca</a>
          </div>
          <div class="grid-4">
            ${brands.map(function (entry) {
              return `
                <a class="card category-card" href="products.html?brand=${encodeURIComponent(entry.brand)}">
                  ${imageMarkup(entry.product.coverImage, entry.brand, 'loading="lazy"')}
                  <div class="category-content">
                    <h3>${esc(entry.brand)}</h3>
                    <p class="muted">Loc nhanh cac dong gay cua ${esc(entry.brand)}.</p>
                  </div>
                </a>
              `;
            }).join('')}
          </div>
        </div>
      </section>

      <section class="section">
        <div class="container">
          <div class="section-title">
            <div>
              <h2>San pham de xuat</h2>
              <p class="muted">Danh sach nay den tu SQL Server va hien dung cover image / sale price / stock total trong DB goc.</p>
            </div>
          </div>
          <div class="grid-4">
            ${products.slice(0, 8).map(productCard).join('')}
          </div>
        </div>
      </section>

      <section class="section">
        <div class="container">
          <div class="section-title">
            <div>
              <h2>Bai viet noi bat</h2>
              <p class="muted">Noi dung blog dang duoc lay tu table blog_posts.</p>
            </div>
            <a class="btn" href="blog.html">Xem blog</a>
          </div>
          <div class="grid-3">
            ${state.posts.slice(0, 3).map(function (post) {
              return `
                <article class="card blog-card">
                  ${imageMarkup(post.cover_image, post.title)}
                  <div class="blog-content">
                    <div class="meta-row"><span>${fmtDate(post.published_at)}</span></div>
                    <h3>${esc(post.title)}</h3>
                    <p class="muted">${esc(post.excerpt || '')}</p>
                    <a class="btn btn-primary" href="blog.html?slug=${post.slug}">Doc bai viet</a>
                  </div>
                </article>
              `;
            }).join('')}
          </div>
        </div>
      </section>
    `;

    initHeroSlider();
  }

  function renderProductsPage() {
    const allProducts = normalizedProducts();
    const brandQuery = param('brand');
    const sortQuery = param('sort') || 'featured';
    let filtered = allProducts.slice();

    if (brandQuery) {
      filtered = filtered.filter(function (product) { return product.brand === brandQuery; });
    }

    if (sortQuery === 'price-asc') {
      filtered.sort(function (a, b) { return Number(a.actualPrice) - Number(b.actualPrice); });
    } else if (sortQuery === 'price-desc') {
      filtered.sort(function (a, b) { return Number(b.actualPrice) - Number(a.actualPrice); });
    } else if (sortQuery === 'stock') {
      filtered.sort(function (a, b) { return Number(b.stockTotal) - Number(a.stockTotal); });
    }

    const brands = Array.from(new Set(allProducts.map(function (product) { return product.brand || 'Khac'; })));

    app.innerHTML = `
      <section class="section">
        <div class="container">
          <div class="section-title">
            <div>
              <h1>Danh muc san pham</h1>
              <p class="muted">Loc theo thuong hieu va sap xep gia/ton kho tren nguon SQL Server.</p>
            </div>
          </div>
          <div class="layout">
            <aside class="sticky">
              <div class="filter-box">
                <div class="filter-group">
                  <h4>Thuong hieu</h4>
                  <div class="option-list">
                    <a class="chip ${!brandQuery ? 'active' : ''}" href="products.html">Tat ca</a>
                    ${brands.map(function (brand) {
                      return `<a class="chip ${brandQuery === brand ? 'active' : ''}" href="products.html?brand=${encodeURIComponent(brand)}">${esc(brand)}</a>`;
                    }).join('')}
                  </div>
                </div>
                <div class="filter-group">
                  <h4>Database</h4>
              <div class="notice">Nguon san pham: BidaShopDB • Checkout: order-service • Gateway SQL: ${esc(state.health?.status || 'unknown')}</div>
                </div>
              </div>
            </aside>
            <div>
              <div class="product-toolbar">
                <div class="muted">${filtered.length} san pham</div>
                <form id="sortForm" class="inline-actions">
                  <input type="hidden" name="brand" value="${esc(brandQuery || '')}" />
                  <select name="sort">
                    <option value="featured" ${sortQuery === 'featured' ? 'selected' : ''}>Sap xep mac dinh</option>
                    <option value="price-asc" ${sortQuery === 'price-asc' ? 'selected' : ''}>Gia tu thap den cao</option>
                    <option value="price-desc" ${sortQuery === 'price-desc' ? 'selected' : ''}>Gia tu cao den thap</option>
                    <option value="stock" ${sortQuery === 'stock' ? 'selected' : ''}>Ton kho nhieu nhat</option>
                  </select>
                  <button class="btn btn-primary" type="submit">Ap dung</button>
                </form>
              </div>
              <div class="product-grid">
                ${filtered.map(productCard).join('') || '<div class="empty">Khong co san pham phu hop voi bo loc hien tai.</div>'}
              </div>
            </div>
          </div>
        </div>
      </section>
    `;

    $('#sortForm').onsubmit = function (event) {
      event.preventDefault();
      const formData = new FormData(event.target);
      const params = new URLSearchParams();
      if (formData.get('brand')) params.set('brand', formData.get('brand'));
      if (formData.get('sort')) params.set('sort', formData.get('sort'));
      window.location.href = `products.html?${params.toString()}`;
    };
  }

  async function renderProductDetail() {
    const slugOrId = param('slug') || param('id');
    if (!slugOrId) {
      app.innerHTML = '<section class="section"><div class="container"><div class="alert danger">Thieu slug hoac id san pham.</div></div></section>';
      return;
    }

    const product = await store.requestSql(`/products/${encodeURIComponent(slugOrId)}`);
    const gallery = product.images?.length ? product.images : [{ image_url: product.image_url }];

    app.innerHTML = `
      <section class="section">
        <div class="container">
          <div class="product-detail">
            <div class="card detail-card">
              <div class="gallery-main">
                ${imageMarkup(gallery[0]?.image_url || product.image_url, product.name, 'id="mainImage"')}
              </div>
              <div class="gallery-thumbs">
                ${gallery.map(function (image, index) {
                  const safe = store.resolveMediaUrl(image.image_url, product.name);
                  const fallback = store.placeholderImage(product.name).replace(/'/g, '&#39;');
                  return `<img class="${index === 0 ? 'active' : ''}" src="${safe}" alt="${esc(product.name)}" data-image="${safe}" onerror="this.onerror=null;this.src='${fallback}'" />`;
                }).join('')}
              </div>
            </div>
            <div class="card detail-card">
              <div class="badge active">${esc(product.brand || 'Billiard')}</div>
              <h1>${esc(product.name)}</h1>
              <div class="price-row" style="margin:14px 0;">
                <strong>${store.currency(product.sale_price && product.sale_price > 0 ? product.sale_price : product.price)}</strong>
                ${product.sale_price && Number(product.sale_price) < Number(product.price) ? `<span class="old-price">${store.currency(product.price)}</span>` : ''}
              </div>
              <div class="meta-row">
                <span class="rating">${stars(product.rating || 0)}</span>
                <span>${product.review_count || 0} danh gia</span>
                <span>${product.stock_total > 0 ? `Con ${product.stock_total} san pham` : 'Tam het hang'}</span>
              </div>
              <p class="muted" style="margin-top:16px;">${esc(product.description || '')}</p>
              <div class="inline-actions" style="margin-top:18px;">
                <input id="quantityInput" type="number" min="1" max="${Math.max(product.stock_total || 1, 1)}" value="1" style="width:110px;" />
                <button class="btn btn-primary" id="addToCartBtn" type="button">Them vao gio</button>
                <a class="btn" href="review.html?slug=${product.slug}">Viet danh gia</a>
              </div>
              <hr class="sep" />
              <table class="spec-table">
                <tr><th>SKU</th><td>${esc(product.sku || '-')}</td></tr>
                <tr><th>Thuong hieu</th><td>${esc(product.brand || '-')}</td></tr>
                <tr><th>Loai</th><td>${esc(product.type || product.category || '-')}</td></tr>
                <tr><th>Tip size</th><td>${esc(product.tip_size || '-')}</td></tr>
                <tr><th>Joint</th><td>${esc(product.joint_type || '-')}</td></tr>
                <tr><th>Ton kho</th><td>${product.stock_total}</td></tr>
              </table>
            </div>
          </div>
        </div>
      </section>

      <section class="section">
        <div class="container grid-2">
          <div class="card detail-card">
            <h2>Mo ta chi tiet</h2>
            <p class="muted">${esc(product.long_description || product.description || 'Chua co mo ta chi tiet.')}</p>
          </div>
          <div class="card detail-card">
            <h2>Danh gia khach hang</h2>
            ${(product.reviews || []).map(function (review) {
              return `
                <div class="notice" style="margin-bottom:12px;">
                  <div class="list-line"><strong>${esc(review.name)}</strong><span>${fmtDate(review.created_at)}</span></div>
                  <div class="rating">${stars(review.rating)}</div>
                  <div class="muted">${esc(review.comment || '')}</div>
                </div>
              `;
            }).join('') || '<div class="muted">Chua co danh gia nao.</div>'}
          </div>
        </div>
      </section>
    `;

    $all('.gallery-thumbs img').forEach(function (image) {
      image.onclick = function () {
        $('#mainImage').src = image.dataset.image;
        $all('.gallery-thumbs img').forEach(function (item) { item.classList.remove('active'); });
        image.classList.add('active');
      };
    });

    $('#addToCartBtn').onclick = function () {
      addToCart(product.id, Number($('#quantityInput').value || 1));
    };
  }

  function renderCartPage() {
    const summary = cartSummary();
    const session = store.getSession();

    app.innerHTML = `
      <section class="section">
        <div class="container">
          <div class="section-title">
            <div>
              <h1>Gio hang va thanh toan</h1>
              <p class="muted">Checkout nay tao don qua order-service va day su kien sang inventory-service, notification-service.</p>
            </div>
          </div>
          <div class="cart-layout">
            <div class="card checkout-box">
              <h2>San pham da chon</h2>
              ${summary.lines.length ? summary.lines.map(function (line) {
                return `
                  <div class="cart-row">
                    <div class="badge">${line.product.id}</div>
                    ${imageMarkup(line.product.coverImage, line.product.name, 'style="width:92px;height:92px;object-fit:cover;border-radius:16px;"')}
                    <div>
                      <strong>${esc(line.product.name)}</strong>
                      <div class="muted">${esc(line.product.brand || '-')} • ${store.currency(line.product.actualPrice)}</div>
                      <div class="qty-box" style="margin-top:12px;">
                        <button type="button" onclick="window.BidaCustomerApp.changeCartQuantity(${line.product.id}, -1)">-</button>
                        <span>${line.quantity}</span>
                        <button type="button" onclick="window.BidaCustomerApp.changeCartQuantity(${line.product.id}, 1)">+</button>
                      </div>
                    </div>
                    <div>
                      <strong>${store.currency(line.subtotal)}</strong>
                      <div style="margin-top:10px;"><button class="btn btn-danger" type="button" onclick="window.BidaCustomerApp.removeCartItem(${line.product.id})">Xoa</button></div>
                    </div>
                  </div>
                `;
              }).join('') : '<div class="empty">Gio hang dang trong.</div>'}
            </div>
            <div class="card summary-box">
              <h2>Thong tin checkout</h2>
              <div class="summary-line"><span>So san pham</span><strong>${summary.totalQuantity}</strong></div>
              <div class="summary-line"><span>Tam tinh</span><strong>${store.currency(summary.subtotal)}</strong></div>
              <div class="summary-line"><span>User hien tai</span><strong>${esc(session?.user?.name || 'Chua dang nhap')}</strong></div>
              <div class="summary-line total"><span>Tong thanh toan</span><strong>${store.currency(summary.subtotal)}</strong></div>
              <form id="checkoutForm" style="margin-top:18px;">
                <label><span>Ho ten nguoi dat</span><input name="name" value="${esc(session?.user?.name || '')}" ${session ? '' : 'disabled'} /></label>
                <label><span>Email</span><input name="email" value="${esc(session?.user?.email || '')}" ${session ? '' : 'disabled'} /></label>
                <label><span>So dien thoai</span><input name="phone" value="${esc(session?.user?.phone || '')}" ${session ? '' : 'disabled'} /></label>
                <label><span>Ghi chu</span><textarea name="note" placeholder="Them yeu cau neu can"></textarea></label>
                ${session ? '<button class="btn btn-primary" type="submit">Tao don hang</button>' : '<a class="btn btn-primary" href="account.html?redirect=cart.html">Dang nhap de dat hang</a>'}
              </form>
            </div>
          </div>
        </div>
      </section>
    `;

    if ($('#checkoutForm')) {
      $('#checkoutForm').onsubmit = async function (event) {
        event.preventDefault();
        const activeSession = store.getSession();
        if (!activeSession?.user?.id) {
          notify('Ban can dang nhap truoc khi dat hang.', 'warning');
          window.location.href = 'account.html?redirect=cart.html';
          return;
        }
        if (!summary.lines.length) {
          notify('Gio hang dang trong.', 'warning');
          return;
        }

        const button = $('#checkoutForm button[type="submit"]');
        button.disabled = true;
        button.textContent = 'Dang tao don...';
        try {
          const result = await store.request('/orders', {
            method: 'POST',
            body: JSON.stringify({
              userId: Number(activeSession.user.id),
              items: summary.lines.map(function (line) {
                return { productId: Number(line.product.id), quantity: Number(line.quantity) };
              })
            })
          });
          setCart({ items: [] });
          notify(`Da tao don ${result.order_code || `#${result.id}`}.`);
          window.location.href = `info.html?orderId=${result.id}`;
        } catch (error) {
          notify(error.message, 'danger');
          button.disabled = false;
          button.textContent = 'Tao don hang';
        }
      };
    }
  }

  async function loadUserOrders(userId) {
    return store.request(`/orders?userId=${encodeURIComponent(userId)}`);
  }

  async function renderAccountPage() {
    const session = store.getSession();
    if (!session?.user) {
      app.innerHTML = `
        <section class="section">
          <div class="container grid-2">
            <div class="card" style="padding:22px;">
              <h1>Dang nhap</h1>
              <form id="loginForm">
                <label><span>Email</span><input name="email" type="email" required /></label>
                <label><span>Mat khau</span><input name="password" type="password" required /></label>
                <button class="btn btn-primary" type="submit">Dang nhap</button>
              </form>
            </div>
            <div class="card" style="padding:22px;">
              <h2>Tao tai khoan</h2>
              <form id="registerForm">
                <div class="form-grid-2">
                  <label><span>Ho ten</span><input name="name" required /></label>
                  <label><span>Vai tro</span>
                    <select name="role">
                      <option value="customer">Khach hang</option>
                      <option value="admin">Admin</option>
                    </select>
                  </label>
                </div>
                <label><span>Email</span><input name="email" type="email" required /></label>
                <label><span>So dien thoai</span><input name="phone" /></label>
                <label><span>Mat khau</span><input name="password" type="password" required /></label>
                <button class="btn btn-primary" type="submit">Dang ky</button>
              </form>
            </div>
          </div>
        </section>
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
          store.setSession({ user: data.user });
          notify('Dang nhap thanh cong.');
          window.location.href = param('redirect') || 'account.html';
        } catch (error) {
          notify(error.message, 'danger');
        }
      };

      $('#registerForm').onsubmit = async function (event) {
        event.preventDefault();
        const formData = new FormData(event.target);
        const payload = {
          name: formData.get('name'),
          email: formData.get('email'),
          phone: formData.get('phone'),
          password: formData.get('password'),
          role: formData.get('role')
        };
        try {
          await store.requestSql('/auth/register', {
            method: 'POST',
            body: JSON.stringify(payload)
          });
          const data = await store.requestSql('/auth/login', {
            method: 'POST',
            body: JSON.stringify({
              email: payload.email,
              password: payload.password
            })
          });
          store.setSession({ user: data.user });
          notify('Dang ky va dang nhap thanh cong.');
          window.location.href = param('redirect') || 'account.html';
        } catch (error) {
          notify(error.message, 'danger');
        }
      };
      return;
    }

    const [orders, notifications] = await Promise.all([
      loadUserOrders(session.user.id),
      store.request('/notifications').catch(function () { return []; })
    ]);

    app.innerHTML = `
      <section class="section">
        <div class="container">
          <div class="section-title">
            <div>
              <h1>Tai khoan khach hang</h1>
              <p class="muted">Session va du lieu user dang doc tu table users cua SQL Server.</p>
            </div>
            <div class="inline-actions">
              ${session.user.role === 'admin' ? '<a class="btn btn-primary" href="admin.html" target="_blank" rel="noreferrer">Mo Admin</a>' : ''}
              <button class="btn" id="logoutBtn" type="button">Dang xuat</button>
            </div>
          </div>
          <div class="account-layout">
            <div class="card profile-card">
              <h2>Thong tin ca nhan</h2>
              <div class="kpi-list">
                <div class="list-line"><span>Ho ten</span><strong>${esc(session.user.name)}</strong></div>
                <div class="list-line"><span>Email</span><strong>${esc(session.user.email)}</strong></div>
                <div class="list-line"><span>Vai tro</span><strong>${esc(session.user.role)}</strong></div>
                <div class="list-line"><span>User ID</span><strong>${esc(session.user.id)}</strong></div>
              </div>
              <hr class="sep" />
              <h3>Thong bao he thong</h3>
              ${(notifications || []).map(function (note) {
                return `
                  <div class="notice" style="margin-bottom:10px;">
                    <strong>${esc(note.title)}</strong>
                    <div class="muted">${esc(note.content || note.message || '')}</div>
                    <div class="muted">${fmtDate(note.created_at || note.sent_at)}</div>
                  </div>
                `;
              }).join('') || '<div class="muted">Chua co notification nao.</div>'}
            </div>
            <div class="card order-box">
              <h2>Don hang cua toi</h2>
              ${(orders || []).map(function (order) {
                return `
                  <div class="order-item notice">
                    <div class="list-line">
                      <strong>${esc(order.order_code || `Don #${order.id}`)}</strong>
                      <span>${fmtDate(order.created_at)}</span>
                    </div>
                    <div class="muted">${esc(orderStatusText(order.status))} • ${store.currency(order.total || 0)}</div>
                    <div class="muted">Thanh toan: ${esc(order.payment_status || 'pending')}</div>
                  </div>
                `;
              }).join('') || '<div class="muted">Chua co don hang nao.</div>'}
            </div>
          </div>
        </div>
      </section>
    `;

    $('#logoutBtn').onclick = function () {
      store.clearSession();
      notify('Da dang xuat.');
      window.location.reload();
    };
  }

  function renderReviewPage() {
    const product = getProductBySlug(param('slug')) || getProductById(param('id'));
    if (!product) {
      app.innerHTML = '<section class="section"><div class="container"><div class="alert warning">Ban can chon mot san pham truoc khi viet review.</div></div></section>';
      return;
    }

    const session = store.getSession();
    app.innerHTML = `
      <section class="section">
        <div class="container">
          <div class="card" style="padding:22px;max-width:760px;margin:0 auto;">
            <h1>Danh gia san pham</h1>
            <p class="muted">Danh gia se duoc luu vao table product_reviews cua SQL Server.</p>
            <div class="notice">
              <strong>${esc(product.name)}</strong>
              <div class="muted">${store.currency(product.actualPrice)} • ${esc(product.brand || '-')}</div>
            </div>
            <form id="reviewForm" style="margin-top:16px;">
              <label><span>Ten hien thi</span><input name="name" value="${esc(session?.user?.name || '')}" ${session ? '' : 'disabled'} required /></label>
              <label><span>Diem danh gia</span>
                <select name="rating">
                  <option value="5">5 sao</option>
                  <option value="4">4 sao</option>
                  <option value="3">3 sao</option>
                  <option value="2">2 sao</option>
                  <option value="1">1 sao</option>
                </select>
              </label>
              <label><span>Nhan xet</span><textarea name="comment" minlength="10" required placeholder="Chia se trai nghiem cua ban"></textarea></label>
              <div class="inline-actions">
                ${session ? '<button class="btn btn-primary" type="submit">Gui danh gia</button>' : '<a class="btn btn-primary" href="account.html?redirect=review.html?slug=' + encodeURIComponent(product.slug) + '">Dang nhap de review</a>'}
                <a class="btn" href="product.html?slug=${product.slug}">Quay lai san pham</a>
              </div>
            </form>
          </div>
        </div>
      </section>
    `;

    if ($('#reviewForm') && session) {
      $('#reviewForm').onsubmit = async function (event) {
        event.preventDefault();
        const formData = new FormData(event.target);
        const comment = String(formData.get('comment') || '').trim();
        if (comment.length < 10) {
          notify('Nhan xet can it nhat 10 ky tu.', 'warning');
          return;
        }
        try {
          await store.requestSql('/reviews', {
            method: 'POST',
            body: JSON.stringify({
              userId: Number(session.user.id),
              productId: Number(product.id),
              rating: Number(formData.get('rating')),
              comment
            })
          });
          notify('Da gui danh gia.');
          window.location.href = `product.html?slug=${product.slug}`;
        } catch (error) {
          notify(error.message, 'danger');
        }
      };
    }
  }

  function renderInfoPage() {
    const orderId = param('orderId');
    const render = function (order) {
      const orderBlock = order ? `
        <div class="card" style="padding:22px;margin-bottom:18px;">
          <h2>${esc(order.order_code || `Don #${order.id}`)}</h2>
          <div class="kpi-list">
            <div class="list-line"><span>Trang thai</span><strong>${esc(orderStatusText(order.status))}</strong></div>
            <div class="list-line"><span>Thanh toan</span><strong>${esc(order.payment_status || 'pending')}</strong></div>
            <div class="list-line"><span>Tong tien</span><strong>${store.currency(order.total || 0)}</strong></div>
          </div>
        </div>
      ` : '';

      app.innerHTML = `
        <section class="section">
          <div class="container">
            ${orderBlock}
            <div class="info-layout">
              <div class="card info-card">
                <h1>Chinh sach mua hang</h1>
                <p class="muted">${esc(state.settings.returnPolicy || 'Ban co the trinh bay day la showroom online cua mon phan tan, ket hop giao dien refresh va nguon du lieu SQL Server.')}</p>
                <h2>Van chuyen</h2>
                <p class="muted">${esc(state.settings.shippingPolicy || 'Don hang duoc tao qua order-service, ton kho duoc xu ly boi inventory-service va thong bao duoc ghi nhan qua notification-service.')}</p>
                <h2>Bao hanh</h2>
                <p class="muted">${esc(state.settings.warrantyPolicy || 'Moi san pham bida can duoc bao quan dung cach de giu do on dinh khi thi dau.')}</p>
              </div>
              <div class="card info-card">
                <h2>Lien he showroom</h2>
                <div class="kpi-list">
                  <div class="list-line"><span>Website</span><strong>${esc(state.settings.siteName || 'Bida Pro Shop')}</strong></div>
                  <div class="list-line"><span>Hotline</span><strong>${esc(state.settings.hotline || '0909 123 456')}</strong></div>
                  <div class="list-line"><span>Showroom</span><strong>${esc(state.settings.showroom || 'TP.HCM')}</strong></div>
                </div>
              </div>
            </div>
          </div>
        </section>
      `;
    };

    if (!orderId) {
      render(null);
      return;
    }

    store.request(`/orders/${orderId}`).then(render).catch(function () { render(null); });
  }

  function renderBlogPage() {
    const slug = param('slug');
    if (!slug) {
      app.innerHTML = `
        <section class="section">
          <div class="container">
            <div class="section-title">
              <div>
                <h1>Blog va cam nang bida</h1>
                <p class="muted">Noi dung nay dang duoc lay tu table blog_posts cua BidaShopDB.</p>
              </div>
            </div>
            <div class="grid-3">
              ${state.posts.map(function (post) {
                return `
                  <article class="card blog-card">
                    ${imageMarkup(post.cover_image, post.title)}
                    <div class="blog-content">
                      <div class="meta-row"><span>${fmtDate(post.published_at)}</span></div>
                      <h3>${esc(post.title)}</h3>
                      <p class="muted">${esc(post.excerpt || '')}</p>
                      <a class="btn btn-primary" href="blog.html?slug=${post.slug}">Doc tiep</a>
                    </div>
                  </article>
                `;
              }).join('')}
            </div>
          </div>
        </section>
      `;
      return;
    }

    const post = state.posts.find(function (item) { return item.slug === slug; });
    if (!post) {
      app.innerHTML = '<section class="section"><div class="container"><div class="alert warning">Khong tim thay bai viet.</div></div></section>';
      return;
    }

    app.innerHTML = `
      <section class="section">
        <div class="container">
          <article class="card" style="padding:24px;">
            ${imageMarkup(post.cover_image, post.title, 'style="width:100%;max-height:420px;object-fit:cover;border-radius:18px;"')}
            <div style="margin-top:18px;">
              <div class="badge">Blog</div>
              <h1 style="margin-top:12px;">${esc(post.title)}</h1>
              <div class="muted" style="margin-bottom:16px;">${fmtDate(post.published_at)}</div>
              <p class="muted" style="font-size:18px;">${esc(post.excerpt || '')}</p>
              <div style="margin-top:20px;line-height:1.8;white-space:pre-line;">${esc(post.content || '')}</div>
            </div>
          </article>
        </div>
      </section>
    `;
  }

  async function bootstrap() {
    try {
      const [health, settings, products, inventory, banners, posts, notifications] = await Promise.all([
        store.requestSql('/health').catch(function () { return { status: 'DOWN', service: 'sql-adapter' }; }),
        store.requestSql('/settings').catch(function () { return {}; }),
        store.requestSql('/products'),
        store.request('/inventory').catch(function () { return []; }),
        store.requestSql('/banners').catch(function () { return []; }),
        store.requestSql('/blog-posts').catch(function () { return []; }),
        store.request('/notifications').catch(function () { return []; })
      ]);

      state.health = health;
      state.settings = settings || {};
      state.products = Array.isArray(products) ? products : [];
      state.inventory = Array.isArray(inventory) ? inventory : [];
      state.banners = Array.isArray(banners) ? banners : [];
      state.posts = Array.isArray(posts) ? posts : [];
      state.notifications = Array.isArray(notifications) ? notifications : [];
      state.inventoryMap = new Map(state.inventory.map(function (item) {
        return [Number(item.product_id), Number(item.quantity)];
      }));

      renderHeader();

      if (page === 'home') {
        renderHome();
      } else if (page === 'products') {
        renderProductsPage();
      } else if (page === 'product') {
        await renderProductDetail();
      } else if (page === 'cart') {
        renderCartPage();
      } else if (page === 'account') {
        await renderAccountPage();
      } else if (page === 'review') {
        renderReviewPage();
      } else if (page === 'info') {
        renderInfoPage();
      } else if (page === 'blog') {
        renderBlogPage();
      }
    } catch (error) {
      app.innerHTML = `<section class="section"><div class="container"><div class="alert danger">Khong tai duoc frontend: ${esc(error.message)}</div></div></section>`;
    }
  }

  window.BidaCustomerApp = {
    addToCart: addToCart,
    changeCartQuantity: function (productId, delta) {
      const line = cartLines().find(function (item) {
        return Number(item.product.id) === Number(productId);
      });
      if (!line) return;
      updateCartQuantity(productId, Number(line.quantity) + Number(delta));
    },
    removeCartItem: function (productId) {
      updateCartQuantity(productId, 0);
    }
  };

  bootstrap();
})();
