'use strict';

const byId = (id) => document.getElementById(id);
const message = (id, type, text) => showMsg(byId(id), type, text);
const sectionLink = (id, label, className = '') => h('a', { href: `#${id}`, class: className }, label);

function renderHeader() {
  const links = [['home', 'Home'], ['catalog', 'Produce'], ['farmers', 'Farmers'], ['about', 'About'], ['contact', 'Contact'], ['cart', `Cart (${Cart.count()})`]];
  const nav = h('nav', { class: 'main', 'aria-label': 'Main' }, links.map(([id, label]) => sectionLink(id, label)));
  const right = h('div', { class: 'nav-right' });
  if (ME) {
    if (ME.role !== 'admin') right.append(h('a', { href: 'dashboard.html' }, 'My dashboard'));
    if (ME.role === 'admin') right.append(sectionLink('admin-dashboard', 'Admin dashboard'));
    right.append(h('button', { class: 'btn small outline', type: 'button', onclick: logoutUser }, `Logout (${ME.full_name.split(' ')[0]})`));
  } else {
    right.append(sectionLink('login', 'Login'), sectionLink('register', 'Register'));
  }
  const header = h('header', { class: 'site-header' }, h('div', { class: 'container bar' },
    sectionLink('home', 'AgriConnect', 'logo'),
    h('button', { class: 'menu-btn', type: 'button', 'aria-label': 'Toggle menu', onclick: () => header.classList.toggle('open') }, '☰ Menu'),
    nav, right));
  const existing = document.querySelector('.site-header');
  if (existing) existing.replaceWith(header);
  else document.body.prepend(header);
}

function productTile(p) {
  return h('article', { class: 'card' },
    h('div', { class: 'thumb' }, h('img', { src: p.photo_url || CATEGORY_IMAGES[p.category], alt: p.photo_url ? `${p.name} produce` : `${p.category} produce`, loading: 'lazy' })),
    h('h3', {}, h('a', { href: '#product-detail', 'data-action': 'product', 'data-id': p.produce_id }, p.name)),
    h('span', { class: 'tag' }, p.category),
    h('div', { class: 'price' }, `${kes(p.price)} / ${p.unit}`),
    h('div', { class: 'muted' }, `${p.farm_name || p.farmer} · ${p.location || ''}`),
    h('button', { class: 'btn small', type: 'button', 'data-action': 'product', 'data-id': p.produce_id }, 'View & add to cart'));
}

async function loadCategories() {
  const { categories } = await api('/api/categories');
  const select = byId('catalog-category');
  select.replaceChildren(h('option', { value: '' }, 'All categories'));
  select.append(...categories.map((c) => h('option', { value: c.category_id }, c.name)));
  byId('categories').replaceChildren(...categories.map((c) =>
    h('button', { class: 'category-card', type: 'button', 'data-category': c.category_id, 'aria-label': `Browse ${c.name}` },
      h('img', { src: CATEGORY_IMAGES[c.name], alt: '', loading: 'lazy' }),
      h('span', {}, `${ICONS[c.name] || '🌱'} ${c.name}`))));
}

async function loadCatalog() {
  const form = byId('catalog-filters');
  const query = new URLSearchParams();
  for (const key of ['search', 'category', 'location']) {
    const value = form.elements[key].value.trim();
    if (value) query.set(key, value);
  }
  try {
    const { produce } = await api('/api/produce?' + query);
    byId('catalog-count').textContent = `${produce.length} item${produce.length === 1 ? '' : 's'} found`;
    byId('catalog-results').replaceChildren(...(produce.length
      ? produce.map(productTile)
      : [h('p', { class: 'muted' }, 'No produce matches your search. Try different words or clear the filters.')]));
  } catch (e) {
    byId('catalog-results').replaceChildren();
    showMsg(byId('catalog-count'), 'err', e.message);
  }
}

async function loadHome() {
  try {
    const { produce } = await api('/api/produce');
    byId('latest-produce').replaceChildren(...(produce.length
      ? produce.slice(0, 4).map(productTile)
      : [h('p', { class: 'muted' }, 'No produce listed yet.')]));
  } catch (e) {
    showMsg(byId('latest-produce'), 'err', e.message);
  }
}

async function showProduct(id) {
  const box = byId('product-detail');
  if (!/^\d+$/.test(String(id || ''))) return showMsg(box, 'err', 'No produce item selected.');
  box.replaceChildren(h('p', { class: 'muted' }, 'Loading produce details…'));
  try {
    const { produce: p } = await api(`/api/produce/${encodeURIComponent(id)}`);
    const qty = h('input', { class: 'qty-input', type: 'number', min: 1, max: p.quantity, step: 1, value: 1, 'aria-label': 'Quantity' });
    const msg = h('div', {});
    const add = h('button', { class: 'btn accent', type: 'button', disabled: p.quantity < 1 }, p.quantity < 1 ? 'Out of stock' : 'Add to cart');
    add.addEventListener('click', () => {
      const count = Number(qty.value);
      if (!Number.isInteger(count) || count < 1) return showMsg(msg, 'err', 'Enter a whole quantity of 1 or more.');
      if (count > p.quantity) return showMsg(msg, 'err', `Only ${p.quantity} ${p.unit} available.`);
      const currentItem = Cart.get().find((item) => item.produce_id === p.produce_id);
      if (currentItem && currentItem.quantity + count > p.quantity)
        return showMsg(msg, 'err', `Your cart already has ${currentItem.quantity} ${p.unit}. Only ${p.quantity - currentItem.quantity} more available.`);
      Cart.add(p, count);
      renderHeader();
      renderCart();
      showMsg(msg, 'ok', `${count} × ${p.name} added to your cart.`);
    });
    box.replaceChildren(h('div', { class: 'two-col' },
      h('div', { class: 'panel' }, h('div', { class: 'thumb big' }, h('img', { src: p.photo_url || CATEGORY_IMAGES[p.category], alt: p.photo_url ? p.name : `${p.category} produce` }))),
      h('div', { class: 'panel' },
        h('h3', {}, p.name),
        h('span', { class: 'tag' }, p.category),
        h('p', { class: 'price big-price' }, `${kes(p.price)} / ${p.unit}`),
        h('p', {}, p.description || 'No description provided.'),
        h('p', { class: 'muted' }, `In stock: ${p.quantity} ${p.unit} · Location: ${p.location || 'not stated'}`),
        h('p', {}, 'Sold by ', h('a', { href: '#farmer-profile', 'data-action': 'farmer', 'data-id': p.farmer_id }, p.farm_name || p.farmer)),
        h('div', { class: 'row' }, h('label', { class: 'inline-label' }, 'Quantity'), qty, add), msg)));
  } catch (e) {
    showMsg(box, 'err', e.status === 404 ? 'That produce item is no longer available.' : e.message);
  }
}

async function loadFarmers() {
  const list = byId('farmer-list');
  try {
    const { farmers } = await api('/api/farmers');
    list.replaceChildren(...(farmers.length ? farmers.map((f) => h('article', { class: 'card' },
      h('h3', {}, f.farm_name || f.full_name),
      h('div', { class: 'muted' }, `${f.full_name} · ${f.location || 'Kenya'}`),
      h('p', {}, f.bio || ''),
      h('span', { class: 'tag' }, `${f.listings} listing${f.listings === 1 ? '' : 's'}`),
      h('button', { class: 'btn small', type: 'button', 'data-action': 'farmer', 'data-id': f.user_id }, 'View profile'))) : [h('p', { class: 'muted' }, 'No farmers yet.')]));
  } catch (e) { showMsg(list, 'err', e.message); }
}

async function showFarmer(id) {
  const box = byId('farmer-profile');
  if (!/^\d+$/.test(String(id || ''))) return showMsg(box, 'err', 'No farmer selected.');
  box.replaceChildren(h('p', { class: 'muted' }, 'Loading farmer profile…'));
  try {
    const { farmer, produce } = await api(`/api/farmers/${encodeURIComponent(id)}`);
    const rows = produce.map((p) => h('tr', {},
      h('td', {}, h('button', { class: 'link-button', type: 'button', 'data-action': 'product', 'data-id': p.produce_id }, p.name)),
      h('td', {}, p.category),
      h('td', {}, `${kes(p.price)} / ${p.unit}`),
      h('td', {}, p.quantity)));
    box.replaceChildren(
      h('div', { class: 'panel' }, h('h3', {}, farmer.farm_name || farmer.full_name),
        h('p', { class: 'muted' }, `${farmer.full_name} · ${farmer.location || 'Kenya'}`), h('p', {}, farmer.bio || '')),
      h('h3', { class: 'section-title' }, 'Available produce'),
      h('div', { class: 'table-wrap' }, h('table', {},
        h('thead', {}, h('tr', {}, ['Produce', 'Category', 'Price', 'In stock'].map((text) => h('th', {}, text)))),
        h('tbody', {}, rows))));
  } catch (e) {
    showMsg(box, 'err', e.status === 404 ? 'Farmer not found.' : e.message);
  }
}

function renderCart() {
  const box = byId('cart-content');
  const msg = byId('cart-message');
  const items = Cart.get();
  if (!items.length) {
    box.replaceChildren(h('div', { class: 'panel' }, h('p', {}, 'Your cart is empty.'), sectionLink('catalog', 'Browse produce', 'btn')));
    return;
  }
  const rows = items.map((item) => {
    const qty = h('input', { type: 'number', class: 'qty-input', min: 1, max: item.stock, step: 1, value: item.quantity, 'aria-label': `Quantity of ${item.name}` });
    qty.addEventListener('change', () => {
      const count = Number(qty.value);
      if (!Number.isInteger(count) || count < 1 || count > item.stock) {
        showMsg(msg, 'err', count > item.stock ? `Only ${item.stock} ${item.unit} of ${item.name} in stock.` : 'Quantity must be a whole number of 1 or more.');
        qty.value = item.quantity;
        return;
      }
      msg.replaceChildren();
      Cart.setQty(item.produce_id, count);
      renderHeader();
      renderCart();
    });
    return h('tr', {}, h('td', {}, item.name), h('td', {}, `${kes(item.price)} / ${item.unit}`), h('td', {}, qty),
      h('td', {}, kes(item.price * item.quantity)),
      h('td', {}, h('button', { class: 'btn small danger', type: 'button', onclick: () => { Cart.remove(item.produce_id); renderHeader(); renderCart(); } }, 'Remove')));
  });
  const address = h('textarea', { id: 'delivery-address', maxlength: 200, 'aria-describedby': 'delivery-address-error' });
  const err = h('div', { class: 'field-error', id: 'delivery-address-error', 'aria-live': 'polite' });
  const place = h('button', { class: 'btn accent', type: 'button' }, 'Place order');
  place.addEventListener('click', async () => {
    err.textContent = '';
    address.classList.remove('invalid');
    if (!ME) return showMsg(msg, 'info', 'Please log in as a buyer to place your order.');
    if (ME.role !== 'buyer') return showMsg(msg, 'err', 'Only buyer accounts can place orders.');
    if (address.value.trim().length < 5) { err.textContent = 'Delivery address is required.'; address.classList.add('invalid'); address.focus(); return; }
    place.disabled = true;
    try {
      const result = await api('/api/orders', { method: 'POST', body: { delivery_address: address.value, items: Cart.get().map((i) => ({ produce_id: i.produce_id, quantity: i.quantity })) } });
      Cart.clear();
      renderHeader();
      renderCart();
      await showOrder(result.order_id, true);
      location.hash = 'order-receipt';
    } catch (e) {
      place.disabled = false;
      if (e.fields && e.fields.delivery_address) { err.textContent = e.fields.delivery_address; address.classList.add('invalid'); }
      showMsg(msg, 'err', e.message);
    }
  });
  box.replaceChildren(
    h('div', { class: 'table-wrap' }, h('table', {}, h('thead', {}, h('tr', {}, ['Item', 'Price', 'Quantity', 'Subtotal', ''].map((text) => h('th', {}, text)))), h('tbody', {}, rows))),
    h('p', { class: 'price big-price' }, `Total: ${kes(Cart.total())}`),
    h('div', { class: 'panel' }, h('label', { for: 'delivery-address' }, 'Delivery address *'), address, err,
      h('div', { class: 'row' }, place, sectionLink('catalog', 'Continue shopping', 'btn outline'))));
}

async function showOrder(id, isNew = false) {
  const box = byId('order-receipt');
  if (!/^\d+$/.test(String(id || ''))) return showMsg(box, 'err', 'No order selected.');
  try {
    const { order } = await api(`/api/orders/${encodeURIComponent(id)}`);
    const flow = ['Placed', 'Confirmed', 'Dispatched', 'Delivered'];
    const ref = `AC-${String(order.order_id).padStart(5, '0')}`;
    const itemRows = order.items.map((item) => h('tr', {},
      h('td', {}, item.name),
      h('td', {}, `${item.quantity} ${item.unit}`),
      h('td', {}, kes(item.unit_price)),
      h('td', {}, kes(item.unit_price * item.quantity))));
    const receipt = h('div', { class: 'panel' },
      h('h3', {}, `Receipt ${ref}`),
      h('p', {}, h('span', { class: `status ${order.status}` }, order.status), ` · ${order.created_at} UTC`),
      h('ol', { class: 'progress', 'aria-label': 'Order progress' }, flow.map((status, i) => h('li', { class: i <= flow.indexOf(order.status) ? 'done' : '' }, status))),
      h('p', {}, h('strong', {}, 'Buyer: '), `${order.buyer_name} (${order.buyer_email})`),
      h('p', {}, h('strong', {}, 'Delivery address: '), order.delivery_address),
      h('div', { class: 'table-wrap' }, h('table', {},
        h('thead', {}, h('tr', {}, ['Item', 'Qty', 'Unit price', 'Subtotal'].map((text) => h('th', {}, text)))),
        h('tbody', {}, itemRows))),
      h('p', { class: 'price big-price' }, `Total: ${kes(order.total)}`),
      h('div', { class: 'row no-print' },
        h('button', { class: 'btn', type: 'button', onclick: () => window.print() }, 'Print receipt'),
        h('a', {
          class: 'btn outline',
          href: `/api/orders/${encodeURIComponent(order.order_id)}/receipt.pdf`,
          download: `receipt-${ref}.pdf`,
        }, 'Download PDF')));
    box.replaceChildren(
      isNew ? h('div', { class: 'msg ok no-print', role: 'status' }, 'Thank you! Your order has been placed.') : null,
      receipt);
  } catch (e) { showMsg(box, 'err', e.status === 403 ? 'That order does not belong to you.' : e.message); }
}

function bindAuthForms() {
  const login = byId('login-form');
  login.addEventListener('submit', async (event) => {
    event.preventDefault(); clearFieldErrors(login); byId('login-message').replaceChildren();
    const email = login.elements.email.value.trim();
    const password = login.elements.password.value;
    const errors = {};
    if (Validate.email(email)) errors.email = Validate.email(email);
    if (!password) errors.password = 'Password is required.';
    if (Object.keys(errors).length) return showFieldErrors(login, errors);
    const button = login.querySelector('button[type=submit]');
    button.disabled = true;
    try {
      ({ user: ME } = await api('/api/login', { method: 'POST', body: { email, password } }));
      renderHeader();
      if (ME.role === 'admin') {
        await refreshRoleViews();
        location.hash = 'admin-dashboard';
      } else {
        location.href = 'dashboard.html';
      }
    } catch (e) { button.disabled = false; showMsg(byId('login-message'), 'err', e.message); }
  });

  const register = byId('register-form');
  const farmerFields = byId('register-farmer-fields');
  const toggleFarmerFields = () => farmerFields.classList.toggle('hidden', register.elements.role.value !== 'farmer');
  register.elements.role.addEventListener('change', toggleFarmerFields);
  toggleFarmerFields();
  register.addEventListener('submit', async (event) => {
    event.preventDefault(); clearFieldErrors(register); byId('register-message').replaceChildren();
    const value = (name) => register.elements[name].value.trim();
    const errors = {};
    if (value('full_name').length < 2) errors.full_name = 'Enter your full name.';
    if (Validate.email(value('email'))) errors.email = Validate.email(value('email'));
    const passwordError = Validate.password(register.elements.password.value);
    if (passwordError) errors.password = passwordError;
    if (value('phone') && !/^[0-9+\s-]{7,20}$/.test(value('phone'))) errors.phone = 'Enter a valid phone number.';
    if (Object.keys(errors).length) return showFieldErrors(register, errors);
    const button = register.querySelector('button[type=submit]');
    button.disabled = true;
    const body = {
      role: value('role'), full_name: value('full_name'), email: value('email'), password: register.elements.password.value,
      phone: value('phone'), location: value('location'), farm_name: value('farm_name'), bio: value('bio'),
    };
    try {
      ({ user: ME } = await api('/api/register', { method: 'POST', body }));
      location.href = 'dashboard.html';
    } catch (e) {
      showFieldErrors(register, e.fields);
      showMsg(byId('register-message'), 'err', e.message);
    } finally { button.disabled = false; }
  });
}

function bindContactForm() {
  const form = byId('contact-form');
  form.addEventListener('submit', async (event) => {
    event.preventDefault(); clearFieldErrors(form); byId('contact-message').replaceChildren();
    const value = (name) => form.elements[name].value.trim();
    const errors = {};
    if (value('name').length < 2) errors.name = 'Enter your name.';
    if (Validate.email(value('email'))) errors.email = Validate.email(value('email'));
    if (value('message').length < 5) errors.message = 'Message is too short.';
    if (Object.keys(errors).length) return showFieldErrors(form, errors);
    try {
      const result = await api('/api/contact', { method: 'POST', body: { name: value('name'), email: value('email'), message: value('message') } });
      form.reset(); showMsg(byId('contact-message'), 'ok', result.message);
    } catch (e) { showFieldErrors(form, e.fields); showMsg(byId('contact-message'), 'err', e.message); }
  });
}

function bindCatalog() {
  const form = byId('catalog-filters');
  form.addEventListener('submit', (event) => { event.preventDefault(); loadCatalog(); });
  form.addEventListener('reset', () => setTimeout(loadCatalog, 0));
  form.elements.category.addEventListener('change', loadCatalog);
  byId('categories').addEventListener('click', (event) => {
    const link = event.target.closest('[data-category]');
    if (!link) return;
    form.elements.category.value = link.dataset.category;
    loadCatalog();
  });
  document.addEventListener('click', (event) => {
    const target = event.target.closest('[data-action]');
    if (!target) return;
    if (target.dataset.action === 'product') { event.preventDefault(); showProduct(target.dataset.id); }
    if (target.dataset.action === 'farmer') { event.preventDefault(); showFarmer(target.dataset.id); }
    if (target.dataset.action === 'order') { event.preventDefault(); showOrder(target.dataset.id); }
  });
}

async function refreshRoleViews() {
  renderHeader();
  renderCart();
  if (ME && ME.role === 'admin') await initAdminDashboard();
  else byId('admin-message').replaceChildren(h('p', { class: 'muted' }, 'Log in as an administrator to manage users and orders.'));
}

async function logoutUser() {
  try { await api('/api/logout', { method: 'POST', body: {} }); }
  catch (e) { message('admin-message', 'err', e.message); return; }
  ME = null;
  Cart.clear();
  renderHeader();
  await refreshRoleViews();
  location.hash = 'home';
}

async function loadFarmerOrders() {
  const { orders } = await api('/api/orders');
  byId('farmer-orders').replaceChildren(...(orders.length ? orders.map((o) => h('div', { class: 'panel order-line' },
    h('strong', {}, `Order AC-${String(o.order_id).padStart(5, '0')}`), ' ', h('span', { class: `status ${o.status}` }, o.status),
    h('div', { class: 'muted' }, `${o.buyer_name} · ${o.delivery_address}`),
    h('ul', {}, o.items.map((item) => h('li', {}, `${item.quantity} ${item.unit} × ${item.name}`)))))
    : [h('p', { class: 'muted' }, 'No orders for your produce yet.')]));
}

function bindListingForm() {
  const form = byId('listing-form');
  const cancel = byId('cancel-listing-edit');
  const reset = () => {
    form.reset(); form.elements.produce_id.value = ''; form.elements.unit.value = 'kg';
    byId('listing-form-title').textContent = 'Add produce';
    cancel.classList.add('hidden');
    clearFieldErrors(form);
  };
  cancel.addEventListener('click', reset);
  form.addEventListener('submit', async (event) => {
    event.preventDefault(); clearFieldErrors(form); byId('farmer-message').replaceChildren();
    const value = (name) => form.elements[name].value.trim();
    const errors = {};
    if (value('name').length < 2) errors.name = 'Name must be at least 2 characters.';
    if (!(Number(value('price')) > 0)) errors.price = 'Price must be a number greater than 0.';
    if (!/^\d+$/.test(value('quantity'))) errors.quantity = 'Quantity must be a whole number, 0 or more.';
    if (Object.keys(errors).length) return showFieldErrors(form, errors);
    const body = {
      name: value('name'), category_id: Number(value('category_id')), price: Number(value('price')), unit: value('unit') || 'kg',
      quantity: Number(value('quantity')), location: value('location'), photo_url: value('photo_url'), description: value('description'),
    };
    const id = value('produce_id');
    try {
      const result = await api(id ? `/api/produce/${id}` : '/api/produce', { method: id ? 'PUT' : 'POST', body });
      message('farmer-message', 'ok', result.message);
      reset();
      await loadFarmerListings();
    } catch (e) { showFieldErrors(form, e.fields); message('farmer-message', 'err', e.message); }
  });
}

async function initAdminDashboard() {
  if (!ME || ME.role !== 'admin') return;
  try { await loadAdminDashboard(); }
  catch (e) { message('admin-message', 'err', e.message); }
}

async function loadAdminDashboard() {
  const [stats, usersResult, ordersResult] = await Promise.all([
    api('/api/admin/stats'), api('/api/admin/users'), api('/api/orders'),
  ]);
  const tile = (label, value) => h('div', { class: 'panel stat' }, h('b', {}, value), label);
  byId('admin-stats').replaceChildren(tile('Farmers', stats.farmers),
    tile('Buyers', stats.buyers), tile('Live listings', stats.listings), tile('Orders', stats.orders), tile('Order value', kes(stats.revenue)));
  byId('admin-users').replaceChildren(...usersResult.users.map((user) => h('tr', {},
    h('td', {}, user.full_name), h('td', {}, user.email), h('td', {}, user.role),
    h('td', {}, user.approved ? 'Active' : 'Suspended'),
    h('td', {}, user.role === 'admin' ? '—' : user.approved
      ? h('button', { class: 'btn small danger', type: 'button', onclick: () => setUserApproval(user, false) }, 'Suspend')
      : h('button', { class: 'btn small', type: 'button', onclick: () => setUserApproval(user, true) }, 'Reactivate')))));
  const flow = ['Placed', 'Confirmed', 'Dispatched', 'Delivered'];
  byId('admin-orders').replaceChildren(...(ordersResult.orders.length ? ordersResult.orders.map((order) => {
    const next = flow[flow.indexOf(order.status) + 1];
    return h('tr', {},
      h('td', {}, h('button', { class: 'link-button', type: 'button', 'data-action': 'order', 'data-id': order.order_id }, `AC-${String(order.order_id).padStart(5, '0')}`)),
      h('td', {}, order.buyer_name), h('td', {}, kes(order.total)),
      h('td', {}, h('span', { class: `status ${order.status}` }, order.status)),
      h('td', {}, next ? h('button', { class: 'btn small', type: 'button', onclick: () => advanceOrder(order, next) }, `Mark ${next}`) : 'Complete'));
  }) : [h('tr', {}, h('td', { colspan: 5 }, 'No orders yet.'))]));
}

async function setUserApproval(user, approved) {
  try {
    const result = await api(`/api/admin/users/${user.user_id}/approve`, { method: 'PUT', body: { approved } });
    message('admin-message', 'ok', result.message);
    await loadAdminDashboard();
  } catch (e) { message('admin-message', 'err', e.message); }
}

async function advanceOrder(order, status) {
  try {
    const result = await api(`/api/orders/${order.order_id}/status`, { method: 'PUT', body: { status } });
    message('admin-message', 'ok', result.message);
    await loadAdminDashboard();
  } catch (e) { message('admin-message', 'err', e.message); }
}

async function startSinglePage() {
  document.body.prepend(h('a', { href: '#main', class: 'skip' }, 'Skip to content'));
  await loadMe();
  renderHeader();
  bindAuthForms();
  bindContactForm();
  bindCatalog();
  try {
    await loadCategories();
  } catch (e) { showMsg(byId('categories'), 'err', e.message); }
  const params = new URLSearchParams(location.search);
  byId('catalog-filters').elements.search.value = params.get('search') || '';
  byId('catalog-filters').elements.location.value = params.get('location') || '';
  byId('catalog-filters').elements.category.value = params.get('category') || '';
  await Promise.all([loadHome(), loadCatalog(), loadFarmers()]);
  await refreshRoleViews();
}

document.addEventListener('DOMContentLoaded', startSinglePage);
