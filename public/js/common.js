'use strict';
// Shared front-end code: DOM helper, API client, cart, header/footer, validation helpers.
// All user data is inserted with textContent (never innerHTML) to prevent XSS.

function h(tag, attrs, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === false || v === null || v === undefined) continue;
    if (k === 'class') el.className = v;
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c.nodeType ? c : document.createTextNode(String(c)));
  }
  return el;
}

const kes = (n) => 'KES ' + Number(n).toLocaleString('en-KE', { maximumFractionDigits: 2 });
const ICONS = { Vegetables: '🥬', Fruits: '🍋', Cereals: '🌽', Poultry: '🐔' };
const CATEGORY_IMAGES = {
  Vegetables: 'images/vegetables.jpg',
  Fruits: 'images/fruits.jpg',
  Cereals: 'images/cereals.jpg',
  Poultry: 'images/poultry.jpg',
};

// ---- API client ----
async function api(path, options = {}) {
  const opts = { method: options.method || 'GET', headers: { 'X-Requested-With': 'AgriConnect' }, credentials: 'same-origin' };
  if (options.body !== undefined) { opts.headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(options.body); }
  let res;
  try { res = await fetch(path, opts); } catch { throw Object.assign(new Error('Network error. Check your connection.'), { status: 0 }); }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error || 'Request failed.'), { status: res.status, fields: data.fields });
  return data;
}

// ---- Cart (localStorage; guarded because storage can be unavailable) ----
const Cart = {
  get() { try { return JSON.parse(localStorage.getItem('agri_cart') || '[]'); } catch { return []; } },
  save(items) { try { localStorage.setItem('agri_cart', JSON.stringify(items)); } catch { /* ignore */ } updateCartBadge(); },
  add(p, qty) {
    const items = this.get();
    const found = items.find((i) => i.produce_id === p.produce_id);
    if (found) found.quantity = Math.min(found.quantity + qty, p.quantity);
    else items.push({ produce_id: p.produce_id, name: p.name, price: p.price, unit: p.unit, stock: p.quantity, quantity: Math.min(qty, p.quantity) });
    this.save(items);
  },
  setQty(id, qty) { this.save(this.get().map((i) => (i.produce_id === id ? { ...i, quantity: qty } : i))); },
  remove(id) { this.save(this.get().filter((i) => i.produce_id !== id)); },
  clear() { this.save([]); },
  count() { return this.get().reduce((n, i) => n + i.quantity, 0); },
  total() { return this.get().reduce((n, i) => n + i.quantity * i.price, 0); },
};
function updateCartBadge() {
  const b = document.getElementById('cart-count');
  if (b) b.textContent = Cart.count();
}

// ---- Messages / form helpers ----
function showMsg(container, type, text) {
  container.replaceChildren(h('div', { class: `msg ${type}`, role: type === 'err' ? 'alert' : 'status' }, text));
}
function clearFieldErrors(form) {
  form.querySelectorAll('.field-error').forEach((e) => { e.textContent = ''; });
  form.querySelectorAll('.invalid').forEach((e) => e.classList.remove('invalid'));
}
function showFieldErrors(form, fields) {
  for (const [name, msg] of Object.entries(fields || {})) {
    const input = form.elements[name]; const out = form.querySelector(`[data-error-for="${name}"]`);
    if (input) input.classList.add('invalid');
    if (out) out.textContent = msg;
  }
}
function fieldError(name) { return h('div', { class: 'field-error', 'data-error-for': name, 'aria-live': 'polite' }); }

// client-side validation rules (mirror the server rules)
const Validate = {
  email: (v) => (/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v) ? '' : 'Enter a valid email address.'),
  password: (v) => (v.length < 8 ? 'Password must be at least 8 characters.' : !/[A-Za-z]/.test(v) || !/\d/.test(v) ? 'Password must contain a letter and a number.' : ''),
  required: (v, label = 'This field') => (v.trim().length ? '' : `${label} is required.`),
};

// ---- Page chrome ----
let ME = null;
async function loadMe() {
  try { ME = (await api('/api/me')).user; } catch { ME = null; }
  return ME;
}

function buildHeader(active) {
  const links = [['home', 'Home'], ['catalog', 'Produce'], ['farmers', 'Farmers'], ['about', 'About Us'], ['contact', 'Contact Us']];
  const nav = h('nav', { class: 'main', 'aria-label': 'Main' }, links.map(([section, label]) => h('a', { href: `#${section}`, class: active === section ? 'active' : '' }, label)));
  const right = h('div', { class: 'nav-right' });
  right.append(h('a', { href: '#cart', class: active === 'cart' ? 'active' : '' }, 'Cart', h('span', { class: 'badge', id: 'cart-count' }, Cart.count())));
  if (ME) {
    const dash = ME.role === 'admin' ? ['index.html#admin-dashboard', 'Admin'] : ['dashboard.html', 'My dashboard'];
    right.append(h('a', { href: dash[0] }, dash[1]));
    right.append(h('button', { class: 'btn small outline', type: 'button', id: 'logout-btn', onclick: logout }, `Logout (${ME.full_name.split(' ')[0]})`));
  } else {
    right.append(h('a', { href: '#login' }, 'Login'), h('a', { href: '#register' }, 'Register'));
  }
  const header = h('header', { class: 'site-header' }, h('div', { class: 'container bar' },
    h('a', { href: '#home', class: 'logo' }, 'Agri', h('span', {}, 'Connect')),
    h('button', { class: 'menu-btn', type: 'button', 'aria-label': 'Toggle menu', onclick: () => header.classList.toggle('open') }, '☰ Menu'),
    nav, right));
  return header;
}

function buildFooter() {
  return h('footer', { class: 'site-footer' }, h('div', { class: 'container foot-grid' },
    h('div', {}, h('strong', {}, 'AgriConnect'), h('p', {}, 'Connecting smallholder farmers directly with buyers.')),
    h('div', {}, h('strong', {}, 'Quick links'), h('p', {}, h('a', { href: '#catalog' }, 'Browse produce'), ' · ', h('a', { href: '#register' }, 'Join as farmer'))),
    h('div', {}, h('strong', {}, 'Contact'), h('p', {}, 'info@agriconnect.co.ke · +254 700 000 000')),
  ), h('div', { class: 'container muted' }, '© 2026 AgriConnect. Academic project – Software Development Level 6.'));
}

async function logout() {
  try { await api('/api/logout', { method: 'POST', body: {} }); } catch { /* ignore */ }
  Cart.clear();
  location.href = 'index.html';
}

async function initPage(options = {}) {
  await loadMe();
  const active = location.hash.slice(1) || 'home';
  document.body.prepend(h('a', { href: '#main', class: 'skip' }, 'Skip to content'), buildHeader(active));
  document.body.append(buildFooter());
  if (options.roles && !options.roles.includes(ME && ME.role)) {
    const main = document.getElementById('main');
    main.replaceChildren(h('div', { class: 'container' }, h('div', { class: 'msg info' },
      ME ? 'You do not have access to this page.' : 'Please log in to view this page. ', ME ? '' : h('a', { href: '#login' }, 'Go to login'))));
    return false;
  }
  return true;
}

function productCard(p) {
  return h('article', { class: 'card' },
    h('div', { class: 'thumb', 'aria-hidden': 'true' }, p.photo_url ? h('img', { src: p.photo_url, alt: '', loading: 'lazy' }) : ICONS[p.category] || '🌱'),
    h('h3', {}, h('a', { href: `product.html?id=${encodeURIComponent(p.produce_id)}` }, p.name)),
    h('div', {}, h('span', { class: 'tag' }, p.category)),
    h('div', { class: 'price' }, `${kes(p.price)} / ${p.unit}`),
    h('div', { class: 'muted' }, `${p.farm_name || p.farmer} · ${p.location || ''}`),
    h('a', { class: 'btn small', href: `product.html?id=${encodeURIComponent(p.produce_id)}` }, 'View & add to cart'));
}
