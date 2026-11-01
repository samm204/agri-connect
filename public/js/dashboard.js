'use strict';

const byId = (id) => document.getElementById(id);

function dashboardHeader() {
  const nav = h('nav', { class: 'main', 'aria-label': 'Main navigation' },
    [['home', 'Home'], ['catalog', 'Produce'], ['farmers', 'Farmers'], ['about', 'About']].map(([id, label]) =>
      h('a', { href: `index.html#${id}` }, label)));
  const right = h('div', { class: 'nav-right' },
    h('a', { href: 'index.html#cart' }, 'Cart'),
    h('span', { class: 'muted' }, ME.full_name),
    h('button', { class: 'btn small outline', type: 'button', onclick: logoutDashboard }, 'Log out'));
  const header = h('header', { class: 'site-header' }, h('div', { class: 'container bar' },
    h('a', { href: 'index.html#home', class: 'logo' }, 'AgriConnect'),
    h('button', { class: 'menu-btn', type: 'button', 'aria-label': 'Toggle menu', onclick: () => header.classList.toggle('open') }, '☰ Menu'),
    nav, right));
  document.body.prepend(h('a', { href: '#main', class: 'skip' }, 'Skip to content'), header);
}

async function logoutDashboard() {
  try {
    await api('/api/logout', { method: 'POST', body: {} });
    Cart.clear();
    location.href = 'index.html';
  } catch (error) {
    showMsg(byId('dashboard-message'), 'err', error.message);
  }
}

async function loadBuyerOrders() {
  const { orders } = await api('/api/orders');
  const list = byId('buyer-orders');
  if (!orders.length) {
    list.replaceChildren(h('div', { class: 'panel' }, 'You have not placed any orders yet.'));
    return;
  }
  list.replaceChildren(...orders.map((order) => {
    const ref = `AC-${String(order.order_id).padStart(5, '0')}`;
    return h('article', { class: 'panel order-line' },
      h('div', { class: 'row' }, h('strong', {}, `Order ${ref}`), h('span', { class: `status ${order.status}` }, order.status)),
      h('p', { class: 'muted' }, `${order.created_at} UTC · Total ${kes(order.total)}`),
      h('ul', {}, order.items.map((item) => h('li', {}, `${item.quantity} ${item.unit} × ${item.name}`))),
      h('a', { class: 'btn small', href: `/api/orders/${order.order_id}/receipt.pdf`, download: `receipt-${ref}.pdf` }, 'Download receipt'));
  }));
}

async function loadFarmerListings() {
  const { produce } = await api('/api/my/produce');
  byId('farmer-listings').replaceChildren(...(produce.length ? produce.map((item) => h('tr', {},
    h('td', {}, item.name, item.approved ? '' : h('span', { class: 'tag' }, 'Hidden')),
    h('td', {}, `${kes(item.price)} / ${item.unit}`),
    h('td', {}, item.quantity),
    h('td', {}, h('div', { class: 'row' },
      h('button', { class: 'btn small outline', type: 'button', onclick: () => editListing(item) }, 'Edit'),
      h('button', { class: 'btn small danger', type: 'button', onclick: () => removeListing(item) }, 'Delete')))))
    : [h('tr', {}, h('td', { colspan: 4 }, 'No listings yet.'))]));
}

async function loadFarmerOrders() {
  const { orders } = await api('/api/orders');
  const cards = orders.map((order) => h('article', { class: 'panel order-line' },
    h('strong', {}, `Order AC-${String(order.order_id).padStart(5, '0')}`), ' ',
    h('span', { class: `status ${order.status}` }, order.status),
    h('div', { class: 'muted' }, `${order.buyer_name} · ${order.delivery_address}`),
    h('ul', {}, order.items.map((item) => h('li', {}, `${item.quantity} ${item.unit} × ${item.name}`)))));
  if (!cards.length) cards.push(h('p', { class: 'muted' }, 'No orders for your produce yet.'));
  byId('farmer-orders').replaceChildren(...cards);
}

function editListing(item) {
  const form = byId('listing-form');
  for (const key of ['name', 'category_id', 'price', 'unit', 'quantity', 'location', 'photo_url', 'description']) {
    form.elements[key].value = item[key] ?? '';
  }
  form.elements.produce_id.value = item.produce_id;
  byId('listing-form-title').textContent = `Edit: ${item.name}`;
  byId('cancel-listing-edit').classList.remove('hidden');
  form.scrollIntoView({ behavior: 'smooth' });
}

async function removeListing(item) {
  if (!confirm(`Delete "${item.name}"?`)) return;
  try {
    const result = await api(`/api/produce/${item.produce_id}`, { method: 'DELETE' });
    showMsg(byId('dashboard-message'), 'ok', result.message);
    await loadFarmerListings();
  } catch (error) {
    showMsg(byId('dashboard-message'), 'err', error.message);
  }
}

async function bindListingForm() {
  const form = byId('listing-form');
  const cancel = byId('cancel-listing-edit');
  const { categories } = await api('/api/categories');
  byId('listing-category').replaceChildren(...categories.map((category) =>
    h('option', { value: category.category_id }, category.name)));
  const reset = () => {
    form.reset();
    form.elements.produce_id.value = '';
    form.elements.unit.value = 'kg';
    byId('listing-form-title').textContent = 'Add produce';
    cancel.classList.add('hidden');
    clearFieldErrors(form);
  };
  cancel.addEventListener('click', reset);
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    clearFieldErrors(form);
    const value = (name) => form.elements[name].value.trim();
    const errors = {};
    if (value('name').length < 2) errors.name = 'Name must be at least 2 characters.';
    if (!(Number(value('price')) > 0)) errors.price = 'Price must be greater than 0.';
    if (!/^\d+$/.test(value('quantity'))) errors.quantity = 'Quantity must be a whole number, 0 or more.';
    if (Object.keys(errors).length) return showFieldErrors(form, errors);
    const body = {
      name: value('name'), category_id: Number(value('category_id')), price: Number(value('price')),
      unit: value('unit') || 'kg', quantity: Number(value('quantity')), location: value('location'),
      photo_url: value('photo_url'), description: value('description'),
    };
    const id = value('produce_id');
    try {
      const result = await api(id ? `/api/produce/${id}` : '/api/produce', { method: id ? 'PUT' : 'POST', body });
      showMsg(byId('dashboard-message'), 'ok', result.message);
      reset();
      await loadFarmerListings();
    } catch (error) {
      showFieldErrors(form, error.fields);
      showMsg(byId('dashboard-message'), 'err', error.message);
    }
  });
  await loadFarmerListings();
  await loadFarmerOrders();
}

async function startDashboard() {
  try {
    ({ user: ME } = await api('/api/me'));
  } catch (error) {
    if (error.status === 401) {
      location.href = 'index.html#login';
      return;
    }
    showMsg(byId('dashboard-message'), 'err', error.message);
    return;
  }
  if (ME.role === 'admin') {
    location.href = 'index.html#admin-dashboard';
    return;
  }
  if (!['buyer', 'farmer'].includes(ME.role)) {
    location.href = 'index.html#login';
    return;
  }
  dashboardHeader();
  byId('dashboard-title').textContent = `${ME.role === 'farmer' ? 'Farmer' : 'Buyer'} dashboard`;
  byId('dashboard-welcome').textContent = `Welcome, ${ME.full_name}.`;
  if (ME.role === 'buyer') {
    byId('buyer-dashboard').classList.remove('hidden');
    try {
      await loadBuyerOrders();
    } catch (error) {
      showMsg(byId('dashboard-message'), 'err', error.message);
    }
  } else {
    byId('farmer-dashboard').classList.remove('hidden');
    try {
      await bindListingForm();
    } catch (error) {
      showMsg(byId('dashboard-message'), 'err', error.message);
    }
  }
}

document.addEventListener('DOMContentLoaded', startDashboard);
