'use strict';
// AgriConnect automated API test suite (functional + security).
// Usage:  node tests/run-tests.js [--type functional|security] [--out <dir>]
// Each test states an expected result, records the actual result and PASS/FAIL, and the run is
// written to <dir>/results-<type>.json and .md so it can be attached to the test report.
const fs = require('fs');
const path = require('path');
const http = require('http');
const { open } = require('../src/db');
const { createApp } = require('../src/app');
const sec = require('../src/security');

const args = process.argv.slice(2);
const opt = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : null; };
const ONLY = opt('--type');
const OUT = opt('--out') ? path.resolve(opt('--out')) : null;

const tests = [];
const T = (id, module, type, title, expected, fn, kind = 'positive') => tests.push({ id, module, type, title, expected, fn, kind });
const ok = (cond, actual) => ({ pass: !!cond, actual });

let base, db, server;

// ---------- tiny HTTP client with a cookie jar ----------
class Client {
  constructor() { this.cookie = ''; }
  async call(method, url, body, extraHeaders = {}) {
    const headers = { ...extraHeaders };
    if (method !== 'GET' && !('X-Requested-With' in headers)) headers['X-Requested-With'] = 'AgriConnect';
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (this.cookie) headers.Cookie = this.cookie;
    const res = await fetch(base + url, { method, headers, body: body === undefined ? undefined : (typeof body === 'string' ? body : JSON.stringify(body)) });
    const sc = res.headers.get('set-cookie');
    if (sc) { const c = sc.split(';')[0]; this.cookie = c.endsWith('=') ? '' : c; }
    const ct = res.headers.get('content-type') || '';
    const data = ct.includes('json') ? await res.json() : Buffer.from(await res.arrayBuffer());
    return { status: res.status, data, headers: res.headers, setCookie: sc };
  }
  get(u) { return this.call('GET', u); }
  post(u, b) { return this.call('POST', u, b); }
  put(u, b) { return this.call('PUT', u, b); }
  del(u) { return this.call('DELETE', u); }
  async login(email, password) { const r = await this.post('/api/login', { email, password }); return r; }
}
const as = async (email, pw) => { const c = new Client(); const r = await c.login(email, pw); if (r.status !== 200) throw new Error(`login failed for ${email}: ${r.status}`); return c; };
const ADMIN = ['admin@agriconnect.co.ke', 'Admin@1234'];
const FARMER = ['wanjiru@farm.co.ke', 'Demo@1234'];
const FARMER2 = ['otieno@farm.co.ke', 'Demo@1234'];
const FARMER3 = ['chebet@farm.co.ke', 'Demo@1234'];
const BUYER = ['buyer@hotel.co.ke', 'Demo@1234'];
const validReg = (o = {}) => ({ full_name: 'Test User', email: `u${Math.random().toString(36).slice(2, 9)}@example.com`, password: 'Secret123', role: 'buyer', ...o });
const stock = (id) => db.prepare('SELECT quantity FROM produce WHERE produce_id=?').get(id).quantity;

// =====================================================================
// FUNCTIONAL: REGISTRATION / LOGIN
// =====================================================================
const R = 'Registration & Login';
T('REG-01', R, 'functional', 'Register a valid buyer', '201 Created; session established immediately', async () => {
  const c = new Client(); const e = validReg(); const r = await c.post('/api/register', e);
  const me = await c.get('/api/me');
  return ok(r.status === 201 && r.data.user.role === 'buyer' && me.data.user.email === e.email,
    `register=${r.status}, role=${r.data.user && r.data.user.role}, session=${me.data.user && me.data.user.email}`);
});
T('REG-02', R, 'functional', 'Register a valid farmer', '201 Created; farmer session established and can list produce immediately', async () => {
  const c = new Client(); const e = validReg({ role: 'farmer', farm_name: 'Test Farm' });
  const registered = await c.post('/api/register', e);
  const row = db.prepare('SELECT approved FROM users WHERE email=?').get(e.email);
  const r = await c.post('/api/produce', { name: 'Spinach', price: 50, quantity: 10, category_id: 1 });
  const me = await c.get('/api/me');
  return ok(registered.status === 201 && row.approved === 1 && me.data.user.role === 'farmer' && r.status === 201,
    `register=${registered.status}, approved=${row.approved}, role=${me.data.user.role}, create produce=${r.status}`);
});
T('REG-03', R, 'functional', 'Duplicate email is rejected', '409 Conflict', async () => {
  const r = await new Client().post('/api/register', validReg({ email: BUYER[0] }));
  return ok(r.status === 409, `status=${r.status}`);
}, 'negative');
T('REG-04', R, 'functional', 'Invalid email format is rejected', '400 with field error on email', async () => {
  const r = await new Client().post('/api/register', validReg({ email: 'not-an-email' }));
  return ok(r.status === 400 && r.data.fields && r.data.fields.email, `status=${r.status}, fields=${JSON.stringify(r.data.fields)}`);
}, 'negative');
T('REG-05', R, 'functional', 'BOUNDARY: password of 7 characters rejected', '400', async () => {
  const r = await new Client().post('/api/register', validReg({ password: 'Abcde12' }));
  return ok(r.status === 400, `status=${r.status}`);
}, 'boundary');
T('REG-06', R, 'functional', 'BOUNDARY: password of exactly 8 characters accepted', '201', async () => {
  const r = await new Client().post('/api/register', validReg({ password: 'Abcdef12' }));
  return ok(r.status === 201, `status=${r.status}`);
}, 'boundary');
T('REG-07', R, 'functional', 'Missing full name is rejected', '400 with field error on full_name', async () => {
  const r = await new Client().post('/api/register', validReg({ full_name: '' }));
  return ok(r.status === 400 && r.data.fields.full_name, `status=${r.status}`);
}, 'negative');
T('REG-13', R, 'functional', 'Registration request with the email field missing entirely', '400 with a field error (must not crash with 500)', async () => {
  const body = validReg(); delete body.email; const r = await new Client().post('/api/register', body);
  return ok(r.status === 400 && r.data.fields && r.data.fields.email, `status=${r.status}`);
}, 'negative');
T('REG-08', R, 'functional', 'Login with correct credentials', '200 and session cookie; /api/me returns the user', async () => {
  const c = new Client(); const r = await c.login(...BUYER); const me = await c.get('/api/me');
  return ok(r.status === 200 && me.data.user && me.data.user.email === BUYER[0], `login=${r.status}, me=${me.data.user && me.data.user.email}`);
});
T('REG-09', R, 'functional', 'Login with wrong password', '401 "Invalid email or password."', async () => {
  const r = await new Client().login(BUYER[0], 'WrongPass99');
  return ok(r.status === 401 && /Invalid email or password/.test(r.data.error), `status=${r.status}, msg=${r.data.error}`);
}, 'negative');
T('REG-10', R, 'functional', 'Login for unknown email gives the same message (no account enumeration)', '401, identical message to wrong password', async () => {
  const a = await new Client().login('nobody@nowhere.com', 'Whatever123');
  const b = await new Client().login(BUYER[0], 'WrongPass99');
  return ok(a.status === 401 && a.data.error === b.data.error, `unknown="${a.data.error}" vs wrong-pw="${b.data.error}"`);
}, 'negative');
T('REG-11', R, 'functional', 'Email is case-insensitive at login', '200', async () => {
  const r = await new Client().login(BUYER[0].toUpperCase(), BUYER[1]);
  return ok(r.status === 200, `status=${r.status}`);
});
T('REG-12', R, 'functional', 'Logout ends the session', '/api/me returns user:null afterwards', async () => {
  const c = await as(...BUYER); await c.post('/api/logout', {}); const me = await c.get('/api/me');
  return ok(me.data.user === null, `me.user=${JSON.stringify(me.data.user)}`);
});

// =====================================================================
// FUNCTIONAL: PRODUCE CATALOGUE
// =====================================================================
const C = 'Produce Catalogue';
T('CAT-00', C, 'functional', 'Only the requested produce categories are available', 'Vegetables, Fruits, Cereals and Poultry', async () => {
  const r = await new Client().get('/api/categories');
  const names = r.data.categories.map((category) => category.name);
  const expected = ['Vegetables', 'Fruits', 'Cereals', 'Poultry'];
  return ok(r.status === 200 && expected.every((name) => names.includes(name)) && names.length === expected.length,
    `status=${r.status}, categories=${names.join(', ')}`);
});
T('CAT-01', C, 'functional', 'Public catalogue lists approved produce without logging in', '200 and 8 seeded items', async () => {
  const r = await new Client().get('/api/produce');
  return ok(r.status === 200 && r.data.produce.length >= 9, `status=${r.status}, items=${r.data.produce.length}`);
});
T('CAT-02', C, 'functional', 'Search by name (case-insensitive)', 'search=tomato returns Tomatoes', async () => {
  const r = await new Client().get('/api/produce?search=TOMATO');
  return ok(r.data.produce.length === 1 && r.data.produce[0].name === 'Tomatoes', `results=${r.data.produce.map((p) => p.name)}`);
});
T('CAT-03', C, 'functional', 'Filter by category', 'Only Fruits returned for category 2', async () => {
  const r = await new Client().get('/api/produce?category=2');
  return ok(r.data.produce.length > 0 && r.data.produce.every((p) => p.category === 'Fruits'), `results=${r.data.produce.map((p) => p.name)}`);
});
T('CAT-20', C, 'functional', 'Poultry products are available to buyers', 'Poultry category returns free-range eggs', async () => {
  const categories = await new Client().get('/api/categories');
  const poultry = categories.data.categories.find((category) => category.name === 'Poultry');
  const result = await new Client().get(`/api/produce?category=${poultry.category_id}`);
  return ok(result.status === 200 && result.data.produce.some((item) => item.category === 'Poultry' && /egg/i.test(item.name)),
    `category=${poultry.category_id}, items=${result.data.produce.map((item) => item.name).join(', ')}`);
});
T('CAT-21', C, 'functional', 'Farmer can sell poultry produce', 'Approved farmer can list poultry items for buyers', async () => {
  const categories = await new Client().get('/api/categories');
  const poultry = categories.data.categories.find((category) => category.name === 'Poultry');
  const farmer = await as(...FARMER);
  const listing = await farmer.post('/api/produce', {
    name: 'Farm fresh chicken',
    description: 'Fresh whole chicken raised on a small farm.',
    category_id: poultry.category_id,
    price: 650,
    unit: 'piece',
    quantity: 12,
  });
  const catalogue = await new Client().get(`/api/produce?category=${poultry.category_id}&search=Farm%20fresh%20chicken`);
  return ok(listing.status === 201 && catalogue.status === 200 && catalogue.data.produce.some((item) => item.name === 'Farm fresh chicken'),
    `listing=${listing.status}, buyer catalogue=${catalogue.data.produce.map((item) => item.name).join(', ')}`);
});
T('CAT-04', C, 'functional', 'Search with no match returns an empty list', '200 and []', async () => {
  const r = await new Client().get('/api/produce?search=zzzzzz');
  return ok(r.status === 200 && r.data.produce.length === 0, `items=${r.data.produce.length}`);
}, 'negative');
T('CAT-05', C, 'functional', 'Product detail for a valid id', '200 with name, price and farmer', async () => {
  const r = await new Client().get('/api/produce/1');
  return ok(r.status === 200 && r.data.produce.name && r.data.produce.farmer, `status=${r.status}, name=${r.data.produce && r.data.produce.name}`);
});
T('CAT-06', C, 'functional', 'Product detail for a non-existent id', '404', async () => {
  const r = await new Client().get('/api/produce/99999'); return ok(r.status === 404, `status=${r.status}`);
}, 'negative');
T('CAT-07', C, 'functional', 'Product detail for a non-numeric id', '400', async () => {
  const r = await new Client().get('/api/produce/abc'); return ok(r.status === 400, `status=${r.status}`);
}, 'negative');
T('CAT-08', C, 'functional', 'Farmer creates a listing (Create)', '201 and listing appears in catalogue', async () => {
  const c = await as(...FARMER); const r = await c.post('/api/produce', { name: 'Cabbage', price: 35, quantity: 100, category_id: 1, unit: 'head' });
  const list = await new Client().get('/api/produce?search=Cabbage');
  return ok(r.status === 201 && list.data.produce.length === 1, `create=${r.status}, visible=${list.data.produce.length}`);
});
T('CAT-09', C, 'functional', 'Farmer edits own listing (Update)', '200 and new price saved', async () => {
  const c = await as(...FARMER); const id = (await c.post('/api/produce', { name: 'Peas', price: 80, quantity: 20, category_id: 4 })).data.produce_id;
  const r = await c.put(`/api/produce/${id}`, { name: 'Peas', price: 95, quantity: 20, category_id: 4 });
  const p = await c.get(`/api/produce/${id}`);
  return ok(r.status === 200 && p.data.produce.price === 95, `update=${r.status}, price=${p.data.produce.price}`);
});
T('CAT-10', C, 'functional', 'Farmer deletes own listing (Delete)', '200 and listing gone', async () => {
  const c = await as(...FARMER); const id = (await c.post('/api/produce', { name: 'Temp', price: 10, quantity: 1, category_id: 1 })).data.produce_id;
  const r = await c.del(`/api/produce/${id}`); const p = await c.get(`/api/produce/${id}`);
  return ok(r.status === 200 && p.status === 404, `delete=${r.status}, afterwards=${p.status}`);
});
T('CAT-11', C, 'functional', 'BOUNDARY: price 0 rejected', '400', async () => {
  const c = await as(...FARMER); const r = await c.post('/api/produce', { name: 'Free', price: 0, quantity: 5, category_id: 1 });
  return ok(r.status === 400 && r.data.fields.price, `status=${r.status}`);
}, 'boundary');
T('CAT-12', C, 'functional', 'BOUNDARY: price 0.01 accepted', '201', async () => {
  const c = await as(...FARMER); const r = await c.post('/api/produce', { name: 'Cheap', price: 0.01, quantity: 5, category_id: 1 });
  return ok(r.status === 201, `status=${r.status}`);
}, 'boundary');
T('CAT-13', C, 'functional', 'BOUNDARY: quantity -1 rejected', '400', async () => {
  const c = await as(...FARMER); const r = await c.post('/api/produce', { name: 'Neg', price: 10, quantity: -1, category_id: 1 });
  return ok(r.status === 400 && r.data.fields.quantity, `status=${r.status}`);
}, 'boundary');
T('CAT-14', C, 'functional', 'BOUNDARY: quantity 0 accepted (sold out listing)', '201', async () => {
  const c = await as(...FARMER); const r = await c.post('/api/produce', { name: 'SoldOut', price: 10, quantity: 0, category_id: 1 });
  return ok(r.status === 201, `status=${r.status}`);
}, 'boundary');
T('CAT-15', C, 'functional', 'Farmer cannot edit another farmer\'s listing', '403', async () => {
  const c = await as(...FARMER); const r = await c.put('/api/produce/4', { name: 'Hacked', price: 1, quantity: 1, category_id: 2 }); // id 4 belongs to Otieno
  return ok(r.status === 403, `status=${r.status}`);
}, 'negative');
T('CAT-16', C, 'functional', 'Buyer cannot create produce', '403', async () => {
  const c = await as(...BUYER); const r = await c.post('/api/produce', { name: 'X', price: 1, quantity: 1, category_id: 1 });
  return ok(r.status === 403, `status=${r.status}`);
}, 'negative');
T('CAT-17', C, 'functional', 'Anonymous user cannot create produce', '401', async () => {
  const r = await new Client().post('/api/produce', { name: 'X', price: 1, quantity: 1, category_id: 1 }); return ok(r.status === 401, `status=${r.status}`);
}, 'negative');
T('CAT-18', C, 'functional', 'Suspended farmer\'s produce disappears from catalogue', 'Listings hidden while suspended and visible after reactivation', async () => {
  const a = await as(...ADMIN); const before = (await new Client().get('/api/produce?search=Maize')).data.produce.length;
  await a.put('/api/admin/users/3/approve', { approved: false });
  const during = (await new Client().get('/api/produce?search=Maize')).data.produce.length;
  await a.put('/api/admin/users/3/approve', { approved: true });
  const after = (await new Client().get('/api/produce?search=Maize')).data.produce.length;
  return ok(before === 1 && during === 0 && after === 1, `before=${before}, suspended=${during}, restored=${after}`);
});
T('CAT-19', C, 'functional', 'Existing farmer account can list produce without approval', '201', async () => {
  const f = await as(...FARMER3);
  const result = await f.post('/api/produce', { name: 'Beans', price: 120, quantity: 40, category_id: 4 });
  return ok(result.status === 201, `status=${result.status}`);
});

// =====================================================================
// FUNCTIONAL: CHECKOUT / ORDERS
// =====================================================================
const K = 'Checkout & Orders';
const addr = 'Hotel Grace, Moi Avenue, Nairobi';
T('ORD-01', K, 'functional', 'Place a valid order', '201; total = qty × price; stock reduced', async () => {
  const c = await as(...BUYER); const s0 = stock(1);
  const r = await c.post('/api/orders', { delivery_address: addr, items: [{ produce_id: 1, quantity: 3 }] });
  return ok(r.status === 201 && r.data.total === 360 && stock(1) === s0 - 3, `status=${r.status}, total=${r.data.total}, stock ${s0}→${stock(1)}`);
});
T('ORD-02', K, 'functional', 'Order with several items totals correctly', 'Total = 2×120 + 5×40 = 440', async () => {
  const c = await as(...BUYER); const r = await c.post('/api/orders', { delivery_address: addr, items: [{ produce_id: 1, quantity: 2 }, { produce_id: 2, quantity: 5 }] });
  return ok(r.status === 201 && r.data.total === 440, `total=${r.data.total}`);
});
T('ORD-03', K, 'functional', 'New order starts at status Placed', 'Placed', async () => {
  const c = await as(...BUYER); const id = (await c.post('/api/orders', { delivery_address: addr, items: [{ produce_id: 3, quantity: 1 }] })).data.order_id;
  const o = await c.get(`/api/orders/${id}`); return ok(o.data.order.status === 'Placed', `status=${o.data.order.status}`);
});
T('ORD-04', K, 'functional', 'Empty cart rejected', '400', async () => {
  const c = await as(...BUYER); const r = await c.post('/api/orders', { delivery_address: addr, items: [] }); return ok(r.status === 400, `status=${r.status}`);
}, 'negative');
T('ORD-05', K, 'functional', 'Missing delivery address rejected', '400 with field error', async () => {
  const c = await as(...BUYER); const r = await c.post('/api/orders', { delivery_address: '', items: [{ produce_id: 1, quantity: 1 }] });
  return ok(r.status === 400 && r.data.fields && r.data.fields.delivery_address, `status=${r.status}`);
}, 'negative');
T('ORD-06', K, 'functional', 'BOUNDARY: order exactly the stock available', '201 and stock becomes 0', async () => {
  const f = await as(...FARMER); const id = (await f.post('/api/produce', { name: 'LastLot', price: 10, quantity: 5, category_id: 1 })).data.produce_id;
  const c = await as(...BUYER); const r = await c.post('/api/orders', { delivery_address: addr, items: [{ produce_id: id, quantity: 5 }] });
  return ok(r.status === 201 && stock(id) === 0, `status=${r.status}, stock=${stock(id)}`);
}, 'boundary');
T('ORD-07', K, 'functional', 'BOUNDARY: order one more than stock', '409; stock unchanged', async () => {
  const f = await as(...FARMER); const id = (await f.post('/api/produce', { name: 'LimitedLot', price: 10, quantity: 5, category_id: 1 })).data.produce_id;
  const c = await as(...BUYER); const r = await c.post('/api/orders', { delivery_address: addr, items: [{ produce_id: id, quantity: 6 }] });
  return ok(r.status === 409 && stock(id) === 5, `status=${r.status}, stock=${stock(id)}`);
}, 'boundary');
T('ORD-08', K, 'functional', 'BOUNDARY: quantity 0 rejected', '400', async () => {
  const c = await as(...BUYER); const r = await c.post('/api/orders', { delivery_address: addr, items: [{ produce_id: 1, quantity: 0 }] }); return ok(r.status === 400, `status=${r.status}`);
}, 'boundary');
T('ORD-09', K, 'functional', 'Negative or fractional quantity rejected', '400 for -2 and 1.5', async () => {
  const c = await as(...BUYER);
  const a = await c.post('/api/orders', { delivery_address: addr, items: [{ produce_id: 1, quantity: -2 }] });
  const b = await c.post('/api/orders', { delivery_address: addr, items: [{ produce_id: 1, quantity: 1.5 }] });
  return ok(a.status === 400 && b.status === 400, `-2→${a.status}, 1.5→${b.status}`);
}, 'negative');
T('ORD-10', K, 'functional', 'Failed order is atomic (no partial stock deduction)', 'Item 1 stock unchanged when item 2 is out of stock', async () => {
  const c = await as(...BUYER); const s0 = stock(2);
  const r = await c.post('/api/orders', { delivery_address: addr, items: [{ produce_id: 2, quantity: 1 }, { produce_id: 1, quantity: 999999 }] });
  return ok(r.status === 409 && stock(2) === s0, `status=${r.status}, stock ${s0}→${stock(2)}`);
}, 'negative');
T('ORD-11', K, 'functional', 'Client-supplied price is ignored (price tampering)', 'Total uses database price (120), not 1', async () => {
  const c = await as(...BUYER); const r = await c.post('/api/orders', { delivery_address: addr, items: [{ produce_id: 1, quantity: 1, price: 1, unit_price: 1 }], total: 1 });
  return ok(r.status === 201 && r.data.total === 120, `total=${r.data.total}`);
}, 'negative');
T('ORD-12', K, 'functional', 'Anonymous and farmer users cannot place orders', '401 and 403', async () => {
  const a = await new Client().post('/api/orders', { delivery_address: addr, items: [{ produce_id: 1, quantity: 1 }] });
  const f = await (await as(...FARMER)).post('/api/orders', { delivery_address: addr, items: [{ produce_id: 1, quantity: 1 }] });
  return ok(a.status === 401 && f.status === 403, `anonymous=${a.status}, farmer=${f.status}`);
}, 'negative');
T('ORD-13', K, 'functional', 'Order lifecycle: Placed → Confirmed → Dispatched → Delivered', 'Each step accepted in order', async () => {
  const b = await as(...BUYER); const a = await as(...ADMIN);
  const id = (await b.post('/api/orders', { delivery_address: addr, items: [{ produce_id: 3, quantity: 1 }] })).data.order_id;
  const s = []; for (const st of ['Confirmed', 'Dispatched', 'Delivered']) s.push((await a.put(`/api/orders/${id}/status`, { status: st })).status);
  const final = (await a.get(`/api/orders/${id}`)).data.order.status;
  return ok(s.every((x) => x === 200) && final === 'Delivered', `steps=${s}, final=${final}`);
});
T('ORD-14', K, 'functional', 'Order cannot skip a lifecycle step', '409 for Placed → Delivered', async () => {
  const b = await as(...BUYER); const a = await as(...ADMIN);
  const id = (await b.post('/api/orders', { delivery_address: addr, items: [{ produce_id: 3, quantity: 1 }] })).data.order_id;
  const r = await a.put(`/api/orders/${id}/status`, { status: 'Delivered' }); return ok(r.status === 409, `status=${r.status}`);
}, 'negative');
T('ORD-15', K, 'functional', 'Buyer cannot change order status', '403', async () => {
  const b = await as(...BUYER); const id = (await b.post('/api/orders', { delivery_address: addr, items: [{ produce_id: 3, quantity: 1 }] })).data.order_id;
  const r = await b.put(`/api/orders/${id}/status`, { status: 'Confirmed' }); return ok(r.status === 403, `status=${r.status}`);
}, 'negative');
T('ORD-16', K, 'functional', 'Buyer cannot view another buyer\'s order', '403', async () => {
  const e = validReg(); await new Client().post('/api/register', e); const other = await as(e.email, e.password);
  const b = await as(...BUYER); const id = (await b.post('/api/orders', { delivery_address: addr, items: [{ produce_id: 3, quantity: 1 }] })).data.order_id;
  const r = await other.get(`/api/orders/${id}`); return ok(r.status === 403, `status=${r.status}`);
}, 'negative');
T('ORD-17', K, 'functional', 'Receipt PDF is generated for the buyer\'s order', '200, application/pdf, starts with %PDF', async () => {
  const b = await as(...BUYER); const id = (await b.post('/api/orders', { delivery_address: addr, items: [{ produce_id: 1, quantity: 1 }] })).data.order_id;
  const r = await b.get(`/api/orders/${id}/receipt.pdf`);
  const disposition = r.headers.get('content-disposition') || '';
  return ok(r.status === 200 && /pdf/.test(r.headers.get('content-type')) && /attachment/i.test(disposition)
    && disposition.includes(`receipt-AC-${String(id).padStart(5, '0')}.pdf`) && r.data.slice(0, 4).toString() === '%PDF',
    `status=${r.status}, type=${r.headers.get('content-type')}, disposition=${disposition}, magic=${r.data.slice(0, 4)}`);
});
T('ORD-18', K, 'functional', 'Admin dashboard stats reflect data', 'orders and revenue are > 0', async () => {
  const a = await as(...ADMIN); const s = (await a.get('/api/admin/stats')).data; return ok(s.orders > 0 && s.revenue > 0, JSON.stringify(s));
});

// =====================================================================
// SECURITY
// =====================================================================
const S = 'Security';
T('SEC-01', S, 'security', 'Input validation: script tag in name is stored as inert text and API returns JSON', 'Registration succeeds; value returned unchanged inside JSON (output encoding is the front end\'s job - see UI XSS test)', async () => {
  const e = validReg({ full_name: '<script>alert(1)</script>' }); const r = await new Client().post('/api/register', e);
  const c = await as(e.email, e.password); const me = await c.get('/api/me');
  return ok(r.status === 201 && me.data.user.full_name === '<script>alert(1)</script>', `register=${r.status}, stored=${me.data.user.full_name}`);
});
T('SEC-02', S, 'security', 'Input validation: control characters stripped from text', 'Null/newline characters replaced by spaces', async () => {
  const c = await as(...FARMER); const id = (await c.post('/api/produce', { name: 'Bad\u0000Name\nHere', price: 10, quantity: 1, category_id: 1 })).data.produce_id;
  const p = (await c.get(`/api/produce/${id}`)).data.produce; return ok(!/[\u0000\n]/.test(p.name), `name=${JSON.stringify(p.name)}`);
});
T('SEC-03', S, 'security', 'Input validation: oversized request body', '413 Payload Too Large', async () => {
  const r = await new Client().post('/api/contact', JSON.stringify({ name: 'x', email: 'a@b.co', message: 'y'.repeat(200000) })).catch((e) => ({ status: 'connection reset' }));
  return ok(r.status === 413 || r.status === 'connection reset', `status=${r.status}`);
}, 'negative');
T('SEC-04', S, 'security', 'Input validation: malformed JSON', '400 (not 500)', async () => {
  const r = await new Client().post('/api/login', '{bad json'); return ok(r.status === 400, `status=${r.status}`);
}, 'negative');
T('SEC-05', S, 'security', 'SQL injection in login email: \' OR \'1\'=\'1', '401; no session created', async () => {
  const c = new Client(); const r = await c.login("' OR '1'='1", "' OR '1'='1"); const me = await c.get('/api/me');
  return ok(r.status === 401 && me.data.user === null, `login=${r.status}, session user=${me.data.user}`);
}, 'negative');
T('SEC-06', S, 'security', 'SQL injection comment attack on admin email: admin@agriconnect.co.ke\'--', '401', async () => {
  const r = await new Client().login("admin@agriconnect.co.ke'--", 'x'); return ok(r.status === 401, `status=${r.status}`);
}, 'negative');
T('SEC-07', S, 'security', 'SQL injection in catalogue search: \' OR 1=1--', 'Treated as literal text: 0 results, no 500 error', async () => {
  const r = await new Client().get('/api/produce?search=' + encodeURIComponent("' OR 1=1--"));
  return ok(r.status === 200 && r.data.produce.length === 0, `status=${r.status}, rows=${r.data.produce && r.data.produce.length}`);
}, 'negative');
T('SEC-08', S, 'security', 'SQL injection: stacked statement \'; DROP TABLE users;--', 'Users table still intact afterwards', async () => {
  await new Client().get('/api/produce?search=' + encodeURIComponent("'; DROP TABLE users;--"));
  await new Client().login("'; DROP TABLE users;--", 'x'); await new Client().post('/api/register', validReg({ full_name: "x'); DROP TABLE users;--" }));
  const n = db.prepare('SELECT COUNT(*) n FROM users').get().n; return ok(n >= 5, `users rows=${n}`);
}, 'negative');
T('SEC-09', S, 'security', 'SQL injection in URL parameter /api/produce/1 OR 1=1', '400 invalid id', async () => {
  const r = await new Client().get('/api/produce/' + encodeURIComponent('1 OR 1=1')); return ok(r.status === 400, `status=${r.status}`);
}, 'negative');
T('SEC-10', S, 'security', 'Weak passwords rejected: "password", "12345678", "abcdefgh", "Pass1"', 'All four return 400', async () => {
  const codes = []; for (const pw of ['password', '12345678', 'abcdefgh', 'Pass1']) codes.push((await new Client().post('/api/register', validReg({ password: pw }))).status);
  return ok(codes.every((x) => x === 400), `statuses=${codes}`);
}, 'negative');
T('SEC-11', S, 'security', 'Common password rejected even if it meets length/complexity ("Password1")', '400', async () => {
  const r = await new Client().post('/api/register', validReg({ password: 'Password1' })); return ok(r.status === 400, `status=${r.status}`);
}, 'negative');
T('SEC-12', S, 'security', 'Passwords stored hashed with salt, never plain text', 'password_hash starts with scrypt$ and differs for identical passwords', async () => {
  const e1 = validReg({ password: 'SamePass123' }), e2 = validReg({ password: 'SamePass123' });
  await new Client().post('/api/register', e1); await new Client().post('/api/register', e2);
  const h1 = db.prepare('SELECT password_hash h FROM users WHERE email=?').get(e1.email).h, h2 = db.prepare('SELECT password_hash h FROM users WHERE email=?').get(e2.email).h;
  return ok(h1.startsWith('scrypt$') && !h1.includes('SamePass123') && h1 !== h2, `hash prefix=${h1.slice(0, 18)}…, identical-password hashes equal? ${h1 === h2}`);
});
T('SEC-13', S, 'security', 'API responses never leak password hashes', 'No "password" text in /api/me, /api/admin/users, /api/farmers', async () => {
  const a = await as(...ADMIN); const bodies = [JSON.stringify((await a.get('/api/me')).data), JSON.stringify((await a.get('/api/admin/users')).data), JSON.stringify((await new Client().get('/api/farmers')).data)];
  return ok(bodies.every((b) => !/password|scrypt/i.test(b)), 'none found');
});
T('SEC-14', S, 'security', 'Session cookie flags', 'HttpOnly and SameSite=Strict set (Secure is added in production)', async () => {
  const r = await new Client().login(...BUYER); return ok(/HttpOnly/i.test(r.setCookie) && /SameSite=Strict/i.test(r.setCookie), r.setCookie.replace(/=[a-f0-9]{64}/, '=<token>'));
});
T('SEC-15', S, 'security', 'Forged / tampered session token is rejected', '/api/me returns user:null', async () => {
  const c = new Client(); c.cookie = 'agri_sid=' + 'a'.repeat(64); const me = await c.get('/api/me');
  const d = new Client(); d.cookie = "agri_sid=' OR 1=1--"; const me2 = await d.get('/api/me');
  return ok(me.data.user === null && me2.data.user === null, `forged=${me.data.user}, sqli-token=${me2.data.user}`);
}, 'negative');
T('SEC-16', S, 'security', 'Old session token is invalid after logout (no replay)', '401 on protected call with the old token', async () => {
  const c = await as(...BUYER); const old = c.cookie; await c.post('/api/logout', {});
  const replay = new Client(); replay.cookie = old; const r = await replay.get('/api/orders'); return ok(r.status === 401, `status=${r.status}`);
}, 'negative');
T('SEC-17', S, 'security', 'Brute force: account locked after 5 failed logins', '429 on 6th attempt, even with the correct password', async () => {
  const e = validReg(); await new Client().post('/api/register', e); const codes = [];
  for (let i = 0; i < 5; i++) codes.push((await new Client().login(e.email, 'Wrong' + i + 'xx')).status);
  const sixth = (await new Client().login(e.email, e.password)).status;
  return ok(codes.every((x) => x === 401) && sixth === 429, `attempts 1-5=${codes}, attempt 6 (correct pw)=${sixth}`);
}, 'negative');
T('SEC-18', S, 'security', 'Privilege escalation at registration: role=admin', '400', async () => {
  const r = await new Client().post('/api/register', validReg({ role: 'admin' })); return ok(r.status === 400, `status=${r.status}`);
}, 'negative');
T('SEC-19', S, 'security', 'Admin endpoints reject buyers, farmers and anonymous users', '403 / 403 / 401', async () => {
  const b = (await (await as(...BUYER)).get('/api/admin/users')).status, f = (await (await as(...FARMER)).get('/api/admin/stats')).status, a = (await new Client().get('/api/admin/users')).status;
  return ok(b === 403 && f === 403 && a === 401, `buyer=${b}, farmer=${f}, anonymous=${a}`);
}, 'negative');
T('SEC-20', S, 'security', 'Farmer cannot reactivate accounts through the admin API', '403', async () => {
  const r = await (await as(...FARMER3)).put('/api/admin/users/4/approve', { approved: true }); return ok(r.status === 403, `status=${r.status}`);
}, 'negative');
T('SEC-21', S, 'security', 'CSRF defence: state-changing call without the custom header', '403', async () => {
  const c = await as(...BUYER); const r = await c.call('POST', '/api/orders', { delivery_address: addr, items: [{ produce_id: 1, quantity: 1 }] }, { 'X-Requested-With': '' });
  return ok(r.status === 403, `status=${r.status}`);
}, 'negative');
T('SEC-22', S, 'security', 'Path traversal to read server source (/../src/app.js)', '403 or 404, source never returned', async () => {
  const get = (p) => new Promise((res) => { const u = new URL(base); http.get({ host: u.hostname, port: u.port, path: p }, (r) => { let d = ''; r.on('data', (c) => (d += c)); r.on('end', () => res({ status: r.statusCode, body: d })); }); });
  const a = await get('/../src/app.js'), b = await get('/..%2fsrc%2fapp.js'), c = await get('/%2e%2e/db/schema.sql');
  return ok([a, b, c].every((x) => (x.status === 403 || x.status === 404) && !/createApp|CREATE TABLE/.test(x.body)), `statuses=${a.status},${b.status},${c.status}`);
}, 'negative');
T('SEC-23', S, 'security', 'Database file and source are not web-accessible', '404 for /db/agriconnect.sqlite and /package.json', async () => {
  const a = await new Client().get('/db/agriconnect.sqlite'), b = await new Client().get('/package.json'); return ok(a.status === 404 && b.status === 404, `${a.status}, ${b.status}`);
}, 'negative');
T('SEC-24', S, 'security', 'Security headers present', 'CSP, X-Frame-Options, X-Content-Type-Options, Referrer-Policy', async () => {
  const c = new Client(); const r = await c.get('/index.html'); const root = await c.get('/'); const image = await c.get('/images/vegetables.jpg'); const h = (n) => r.headers.get(n);
  return ok(r.status === 200 && root.status === 200 && r.data.equals(root.data) && image.status === 200 && image.headers.get('content-type') === 'image/jpeg'
    && h('content-security-policy') && h('x-frame-options') === 'DENY' && h('x-content-type-options') === 'nosniff' && h('referrer-policy'),
    `index=${r.status}, root=${root.status}, image=${image.status}/${image.headers.get('content-type')}, CSP=${!!h('content-security-policy')}, XFO=${h('x-frame-options')}, nosniff=${h('x-content-type-options')}`);
});
T('SEC-25', S, 'security', 'Errors do not leak stack traces or SQL', '404/400 bodies contain only a short message', async () => {
  const r = await new Client().get('/api/produce/abc'); const s = JSON.stringify(r.data); return ok(!/at .*\.js|SELECT|sqlite/i.test(s), s);
});
T('SEC-26', S, 'security', 'Insecure direct object reference: buyer reads another buyer\'s receipt PDF', '403', async () => {
  const e = validReg(); await new Client().post('/api/register', e); const other = await as(e.email, e.password);
  const b = await as(...BUYER); const id = (await b.post('/api/orders', { delivery_address: addr, items: [{ produce_id: 3, quantity: 1 }] })).data.order_id;
  const r = await other.get(`/api/orders/${id}/receipt.pdf`); return ok(r.status === 403, `status=${r.status}`);
}, 'negative');
T('SEC-27', S, 'security', 'Unauthenticated user cannot read orders', '401', async () => {
  const r = await new Client().get('/api/orders'); return ok(r.status === 401, `status=${r.status}`);
}, 'negative');

T('SEC-28', S, 'security', 'No default admin password in production', 'Production start-up refuses to run without a strong ADMIN_PASSWORD (or with the .env.example placeholder); with one set, the admin logs in with it and NOT with the development default', async () => {
  const saved = { n: process.env.NODE_ENV, a: process.env.ADMIN_PASSWORD }; let missing = '', weakMsg = '', placeholderMsg = '', hashOk = false, defaultWorks = true;
  try {
    process.env.NODE_ENV = 'production'; delete process.env.ADMIN_PASSWORD;
    try { open(':memory:'); } catch (e) { missing = e.message; }
    process.env.ADMIN_PASSWORD = 'short';
    try { open(':memory:'); } catch (e) { weakMsg = e.message; }
    process.env.ADMIN_PASSWORD = 'change-me-before-production-1';
    try { open(':memory:'); } catch (e) { placeholderMsg = e.message; }
    process.env.ADMIN_PASSWORD = 'Str0ng-Prod-Secret';
    const d = open(':memory:'); const h = d.prepare("SELECT password_hash h FROM users WHERE role='admin'").get().h;
    hashOk = sec.verifyPassword('Str0ng-Prod-Secret', h); defaultWorks = sec.verifyPassword('Admin@1234', h);
  } finally { process.env.NODE_ENV = saved.n; if (saved.n === undefined) delete process.env.NODE_ENV; if (saved.a === undefined) delete process.env.ADMIN_PASSWORD; else process.env.ADMIN_PASSWORD = saved.a; }
  return ok(/not set/.test(missing) && /not strong/.test(weakMsg) && /placeholder/.test(placeholderMsg) && hashOk && !defaultWorks, `unset → "${missing.slice(0, 40)}…"; weak → "${weakMsg.slice(0, 50)}…"; strong value works=${hashOk}; dev default works=${defaultWorks}`);
}, 'negative');

// =====================================================================
(async () => {
  db = open(':memory:'); server = createApp(db);
  await new Promise((r) => server.listen(0, '127.0.0.1', r)); base = `http://127.0.0.1:${server.address().port}`;
  const selected = tests.filter((t) => !ONLY || t.type === ONLY);
  const results = [];
  for (const t of selected) {
    let r;
    try { r = await t.fn(); } catch (e) { r = { pass: false, actual: 'EXCEPTION: ' + e.message }; }
    results.push({ id: t.id, module: t.module, type: t.type, kind: t.kind, title: t.title, expected: t.expected, actual: r.actual, result: r.pass ? 'PASS' : 'FAIL' });
    console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${t.id}  ${t.title}${r.pass ? '' : '\n        expected: ' + t.expected + '\n        actual:   ' + r.actual}`);
  }
  const failed = results.filter((r) => r.result === 'FAIL');
  console.log(`\n${results.length - failed.length}/${results.length} tests passed`);
  if (OUT) {
    fs.mkdirSync(OUT, { recursive: true });
    const tag = ONLY || 'all';
    fs.writeFileSync(path.join(OUT, `results-${tag}.json`), JSON.stringify(results, null, 2));
    const esc = (s) => String(s).replace(/\|/g, '\\|').replace(/\n/g, ' ');
    let md = `# Executed test results (${tag})\n\nRun date: ${new Date().toISOString()}  \nEnvironment: Node ${process.version}, in-memory SQLite database seeded with demo data, server on a random localhost port.  \nResult: **${results.length - failed.length} of ${results.length} passed**\n`;
    for (const mod of [...new Set(results.map((r) => r.module))]) {
      md += `\n## ${mod}\n\n| ID | Type | Test case | Expected result | Actual result | Result |\n|---|---|---|---|---|---|\n`;
      for (const r of results.filter((x) => x.module === mod)) md += `| ${r.id} | ${r.kind} | ${esc(r.title)} | ${esc(r.expected)} | ${esc(r.actual)} | **${r.result}** |\n`;
    }
    fs.writeFileSync(path.join(OUT, `results-${tag}.md`), md);
  }
  server.close();
  process.exit(failed.length ? 1 : 0);
})();
