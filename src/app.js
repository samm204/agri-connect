'use strict';
// AgriConnect HTTP application: REST API + static file server (no external dependencies).
const http = require('http');
const fs = require('fs');
const path = require('path');
const sec = require('./security');
const { receiptPdf } = require('./pdf');

const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const COOKIE = 'agri_sid';
const SESSION_MS = 8 * 60 * 60 * 1000;
const MAX_BODY = 100 * 1024;
const STATUS_FLOW = ['Placed', 'Confirmed', 'Dispatched', 'Delivered'];
const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.ico': 'image/x-icon', '.json': 'application/json',
};

class HttpError extends Error {
  constructor(status, message, fields) { super(message); this.status = status; this.fields = fields; }
}

function createApp(db) {
  const q = (sql) => db.prepare(sql);

  // ---------- helpers ----------
  function send(res, status, data, headers = {}) {
    const body = typeof data === 'string' || Buffer.isBuffer(data) ? data : JSON.stringify(data);
    res.writeHead(status, {
      'Content-Type': typeof data === 'object' && !Buffer.isBuffer(data) ? 'application/json; charset=utf-8' : 'text/plain; charset=utf-8',
      ...securityHeaders(), ...headers,
    });
    res.end(body);
  }

  function securityHeaders() {
    return {
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
      'Referrer-Policy': 'same-origin',
      'Content-Security-Policy': "default-src 'self'; img-src 'self' https: data:; style-src 'self'; script-src 'self'; frame-ancestors 'none'",
      'Cache-Control': 'no-store',
    };
  }

  function readBody(req) {
    return new Promise((resolve, reject) => {
      let size = 0; const chunks = [];
      req.on('data', (c) => {
        size += c.length;
        if (size > MAX_BODY) { reject(new HttpError(413, 'Request body too large.')); req.destroy(); return; }
        chunks.push(c);
      });
      req.on('end', () => {
        if (!chunks.length) return resolve({});
        try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
        catch { reject(new HttpError(400, 'Invalid JSON body.')); }
      });
      req.on('error', reject);
    });
  }

  function parseCookies(req) {
    const out = {};
    (req.headers.cookie || '').split(';').forEach((p) => {
      const i = p.indexOf('=');
      if (i > 0) out[p.slice(0, i).trim()] = p.slice(i + 1).trim();
    });
    return out;
  }

  function currentUser(req) {
    const token = parseCookies(req)[COOKIE];
    if (!token || !/^[a-f0-9]{64}$/.test(token)) return null;
    const row = q(`SELECT u.user_id,u.full_name,u.email,u.role,u.approved,u.location,u.phone,u.farm_name,s.expires_at
                   FROM sessions s JOIN users u ON u.user_id = s.user_id WHERE s.token = ?`).get(token);
    if (!row) return null;
    if (row.expires_at < Date.now()) { q('DELETE FROM sessions WHERE token = ?').run(token); return null; }
    return row;
  }

  function requireUser(req, ...roles) {
    const u = currentUser(req);
    if (!u) throw new HttpError(401, 'Please log in first.');
    if (roles.length && !roles.includes(u.role)) throw new HttpError(403, 'You do not have permission to do that.');
    return u;
  }

  const publicUser = (u) => ({ user_id: u.user_id, full_name: u.full_name, email: u.email, role: u.role, approved: !!u.approved, location: u.location, farm_name: u.farm_name });
  const toId = (v) => { const n = Number(v); if (!Number.isInteger(n) || n <= 0) throw new HttpError(400, 'Invalid id.'); return n; };

  function setSession(res, userId) {
    const token = sec.newToken();
    q('INSERT INTO sessions (token,user_id,expires_at) VALUES (?,?,?)').run(token, userId, Date.now() + SESSION_MS);
    const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
    res.setHeader('Set-Cookie', `${COOKIE}=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSION_MS / 1000}${secure}`);
  }

  // ---------- validation of produce payloads ----------
  function validateProduce(b) {
    const fields = {};
    const name = sec.cleanText(b.name, 80);
    const description = sec.cleanText(b.description, 500);
    const unit = sec.cleanText(b.unit || 'kg', 20);
    const location = sec.cleanText(b.location, 80);
    const price = Number(b.price);
    const quantity = Number(b.quantity);
    const category_id = Number(b.category_id);
    let photo_url = sec.cleanText(b.photo_url, 300);
    if (name.length < 2) fields.name = 'Name must be at least 2 characters.';
    if (!Number.isFinite(price) || price <= 0 || price > 10000000) fields.price = 'Price must be a number greater than 0.';
    if (!Number.isInteger(quantity) || quantity < 0 || quantity > 10000000) fields.quantity = 'Quantity must be a whole number, 0 or more.';
    if (!Number.isInteger(category_id) || !q('SELECT 1 FROM categories WHERE category_id = ?').get(category_id)) fields.category_id = 'Choose a valid category.';
    if (photo_url && !/^https?:\/\/[^\s]+$/i.test(photo_url)) fields.photo_url = 'Photo must be a http(s) link.';
    if (!photo_url) photo_url = null;
    if (Object.keys(fields).length) throw new HttpError(400, 'Please correct the highlighted fields.', fields);
    return { name, description, unit, location, price, quantity, category_id, photo_url };
  }

  // ---------- route table ----------
  const routes = [];
  const route = (method, pattern, handler) => {
    const keys = [];
    const re = new RegExp('^' + pattern.replace(/:([a-z]+)/g, (_, k) => { keys.push(k); return '([^/]+)'; }) + '/?$');
    routes.push({ method, re, keys, handler });
  };

  route('GET', '/health', async () => ({ ok: true, time: new Date().toISOString() }));

  // ----- Auth -----
  route('POST', '/api/register', async (req, res, ctx) => {
    const b = ctx.body; const fields = {};
    const full_name = sec.cleanText(b.full_name, 80);
    const email = sec.cleanText(b.email, 120).toLowerCase();
    const role = b.role;
    if (full_name.length < 2) fields.full_name = 'Enter your full name.';
    if (!sec.validateEmail(email)) fields.email = 'Enter a valid email address.';
    const pwErr = sec.validatePassword(b.password);
    if (pwErr) fields.password = pwErr;
    if (!['buyer', 'farmer'].includes(role)) fields.role = 'Choose Buyer or Farmer.';
    const phone = sec.cleanText(b.phone, 20);
    if (phone && !/^[0-9+\s-]{7,20}$/.test(phone)) fields.phone = 'Enter a valid phone number.';
    if (Object.keys(fields).length) throw new HttpError(400, 'Please correct the highlighted fields.', fields);
    if (q('SELECT 1 FROM users WHERE email = ?').get(email)) throw new HttpError(409, 'An account with that email already exists.', { email: 'Email already registered.' });
    const approved = role === 'farmer' ? 0 : 1; // farmers wait for admin approval
    const r = q(`INSERT INTO users (full_name,email,password_hash,role,phone,location,farm_name,bio,approved)
                 VALUES (?,?,?,?,?,?,?,?,?)`).run(full_name, email, sec.hashPassword(b.password), role, phone || null,
      sec.cleanText(b.location, 80) || null, role === 'farmer' ? sec.cleanText(b.farm_name, 80) || null : null,
      role === 'farmer' ? sec.cleanText(b.bio, 400) || null : null, approved);
    return { status: 201, data: { message: role === 'farmer' ? 'Registered. An administrator must approve your farmer account before you can list produce.' : 'Registered. You can now log in.', user_id: Number(r.lastInsertRowid) } };
  });

  route('POST', '/api/login', async (req, res, ctx) => {
    const email = sec.cleanText(ctx.body.email, 120).toLowerCase();
    const password = typeof ctx.body.password === 'string' ? ctx.body.password : '';
    const key = `${email}|${req.socket.remoteAddress}`;
    if (sec.tooManyAttempts(key)) throw new HttpError(429, 'Too many failed attempts. Try again in 15 minutes.');
    const u = q('SELECT * FROM users WHERE email = ?').get(email);
    // verify against a dummy hash when user is unknown, so timing does not reveal which emails exist
    const ok = u ? sec.verifyPassword(password, u.password_hash) : (sec.verifyPassword(password, DUMMY_HASH), false);
    if (!ok) { sec.recordFailure(key); throw new HttpError(401, 'Invalid email or password.'); }
    sec.clearFailures(key);
    setSession(res, u.user_id);
    return { user: publicUser(u) };
  });

  route('POST', '/api/logout', async (req, res) => {
    const token = parseCookies(req)[COOKIE];
    if (token) q('DELETE FROM sessions WHERE token = ?').run(token);
    res.setHeader('Set-Cookie', `${COOKIE}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0`);
    return { message: 'Logged out.' };
  });

  route('GET', '/api/me', async (req) => {
    const u = currentUser(req);
    return { user: u ? publicUser(u) : null };
  });

  // ----- Catalogue -----
  route('GET', '/api/categories', async () => ({ categories: q('SELECT * FROM categories ORDER BY category_id').all() }));

  route('GET', '/api/produce', async (req, res, ctx) => {
    const { search, category, location } = ctx.query;
    let sql = `SELECT p.produce_id,p.name,p.description,p.price,p.unit,p.quantity,p.location,p.photo_url,
                      c.name AS category, c.category_id, u.full_name AS farmer, u.farm_name, u.user_id AS farmer_id
               FROM produce p JOIN categories c ON c.category_id = p.category_id
               JOIN users u ON u.user_id = p.farmer_id
               WHERE p.approved = 1 AND u.approved = 1`;
    const args = [];
    if (search) { sql += ' AND (p.name LIKE ? OR p.description LIKE ?)'; const s = `%${sec.cleanText(search, 50)}%`; args.push(s, s); }
    if (category) { sql += ' AND p.category_id = ?'; args.push(toId(category)); }
    if (location) { sql += ' AND p.location LIKE ?'; args.push(`%${sec.cleanText(location, 50)}%`); }
    sql += ' ORDER BY p.created_at DESC, p.produce_id DESC';
    return { produce: q(sql).all(...args) };
  });

  route('GET', '/api/produce/:id', async (req, res, ctx) => {
    const row = q(`SELECT p.*, c.name AS category, u.full_name AS farmer, u.farm_name, u.user_id AS farmer_id
                   FROM produce p JOIN categories c ON c.category_id = p.category_id
                   JOIN users u ON u.user_id = p.farmer_id
                   WHERE p.produce_id = ? AND p.approved = 1 AND u.approved = 1`).get(toId(ctx.params.id));
    if (!row) throw new HttpError(404, 'Produce not found.');
    return { produce: row };
  });

  // ----- Farmer produce CRUD -----
  route('GET', '/api/my/produce', async (req) => {
    const u = requireUser(req, 'farmer');
    return { produce: q(`SELECT p.*, c.name AS category FROM produce p JOIN categories c ON c.category_id = p.category_id
                         WHERE p.farmer_id = ? ORDER BY p.produce_id DESC`).all(u.user_id) };
  });

  route('POST', '/api/produce', async (req, res, ctx) => {
    const u = requireUser(req, 'farmer');
    if (!u.approved) throw new HttpError(403, 'Your farmer account is awaiting administrator approval.');
    const p = validateProduce(ctx.body);
    const r = q(`INSERT INTO produce (farmer_id,category_id,name,description,price,unit,quantity,location,photo_url)
                 VALUES (?,?,?,?,?,?,?,?,?)`).run(u.user_id, p.category_id, p.name, p.description, p.price, p.unit, p.quantity, p.location || u.location, p.photo_url);
    return { status: 201, data: { message: 'Produce listed.', produce_id: Number(r.lastInsertRowid) } };
  });

  route('PUT', '/api/produce/:id', async (req, res, ctx) => {
    const u = requireUser(req, 'farmer');
    const id = toId(ctx.params.id);
    const existing = q('SELECT farmer_id FROM produce WHERE produce_id = ?').get(id);
    if (!existing) throw new HttpError(404, 'Produce not found.');
    if (existing.farmer_id !== u.user_id) throw new HttpError(403, 'You can only edit your own listings.');
    const p = validateProduce(ctx.body);
    q(`UPDATE produce SET category_id=?,name=?,description=?,price=?,unit=?,quantity=?,location=?,photo_url=? WHERE produce_id=?`)
      .run(p.category_id, p.name, p.description, p.price, p.unit, p.quantity, p.location, p.photo_url, id);
    return { message: 'Listing updated.' };
  });

  route('DELETE', '/api/produce/:id', async (req, res, ctx) => {
    const u = requireUser(req, 'farmer', 'admin');
    const id = toId(ctx.params.id);
    const existing = q('SELECT farmer_id FROM produce WHERE produce_id = ?').get(id);
    if (!existing) throw new HttpError(404, 'Produce not found.');
    if (u.role === 'farmer' && existing.farmer_id !== u.user_id) throw new HttpError(403, 'You can only delete your own listings.');
    if (q('SELECT 1 FROM order_items WHERE produce_id = ?').get(id)) {
      // keep order history intact: hide the listing instead of deleting it
      q('UPDATE produce SET approved = 0, quantity = 0 WHERE produce_id = ?').run(id);
      return { message: 'Listing removed from the catalogue (kept in past orders).' };
    }
    q('DELETE FROM produce WHERE produce_id = ?').run(id);
    return { message: 'Listing deleted.' };
  });

  // ----- Farmers -----
  route('GET', '/api/farmers', async () => ({
    farmers: q(`SELECT u.user_id, u.full_name, u.farm_name, u.location, u.bio,
                (SELECT COUNT(*) FROM produce p WHERE p.farmer_id = u.user_id AND p.approved = 1) AS listings
                FROM users u WHERE u.role = 'farmer' AND u.approved = 1 ORDER BY u.full_name`).all(),
  }));

  route('GET', '/api/farmers/:id', async (req, res, ctx) => {
    const id = toId(ctx.params.id);
    const farmer = q(`SELECT user_id, full_name, farm_name, location, bio FROM users WHERE user_id = ? AND role='farmer' AND approved = 1`).get(id);
    if (!farmer) throw new HttpError(404, 'Farmer not found.');
    const produce = q(`SELECT p.produce_id,p.name,p.price,p.unit,p.quantity,c.name AS category FROM produce p
                       JOIN categories c ON c.category_id = p.category_id WHERE p.farmer_id = ? AND p.approved = 1`).all(id);
    return { farmer, produce };
  });

  // ----- Orders -----
  route('POST', '/api/orders', async (req, res, ctx) => {
    const u = requireUser(req, 'buyer');
    const items = ctx.body.items;
    const address = sec.cleanText(ctx.body.delivery_address, 200);
    if (address.length < 5) throw new HttpError(400, 'Please enter a delivery address.', { delivery_address: 'Delivery address is required.' });
    if (!Array.isArray(items) || items.length === 0 || items.length > 50) throw new HttpError(400, 'Your cart is empty.');

    db.exec('BEGIN');
    try {
      let total = 0; const lines = [];
      for (const it of items) {
        const pid = toId(it.produce_id);
        const qty = Number(it.quantity);
        if (!Number.isInteger(qty) || qty <= 0) throw new HttpError(400, 'Quantity must be a whole number greater than 0.');
        const p = q(`SELECT p.produce_id,p.name,p.price,p.quantity FROM produce p JOIN users f ON f.user_id = p.farmer_id
                     WHERE p.produce_id = ? AND p.approved = 1 AND f.approved = 1`).get(pid);
        if (!p) throw new HttpError(404, 'An item in your cart is no longer available.');
        if (qty > p.quantity) throw new HttpError(409, `Only ${p.quantity} of "${p.name}" in stock.`);
        lines.push({ pid, qty, price: p.price });
        total += p.price * qty;
      }
      const o = q('INSERT INTO orders (buyer_id,delivery_address,total) VALUES (?,?,?)').run(u.user_id, address, total);
      const orderId = Number(o.lastInsertRowid);
      for (const l of lines) {
        q('INSERT INTO order_items (order_id,produce_id,quantity,unit_price) VALUES (?,?,?,?)').run(orderId, l.pid, l.qty, l.price);
        q('UPDATE produce SET quantity = quantity - ? WHERE produce_id = ?').run(l.qty, l.pid);
      }
      db.exec('COMMIT');
      return { status: 201, data: { message: 'Order placed.', order_id: orderId, total } };
    } catch (e) { db.exec('ROLLBACK'); throw e; }
  });

  function orderWithItems(orderId, farmerId) {
    const order = q(`SELECT o.*, u.full_name AS buyer_name, u.email AS buyer_email FROM orders o JOIN users u ON u.user_id = o.buyer_id WHERE o.order_id = ?`).get(orderId);
    if (!order) return null;
    let sql = `SELECT i.item_id,i.produce_id,i.quantity,i.unit_price,p.name,p.unit,p.farmer_id FROM order_items i
               JOIN produce p ON p.produce_id = i.produce_id WHERE i.order_id = ?`;
    const args = [orderId];
    if (farmerId) { sql += ' AND p.farmer_id = ?'; args.push(farmerId); }
    return { ...order, items: q(sql).all(...args) };
  }

  route('GET', '/api/orders', async (req) => {
    const u = requireUser(req);
    let ids;
    if (u.role === 'buyer') ids = q('SELECT order_id FROM orders WHERE buyer_id = ? ORDER BY order_id DESC').all(u.user_id);
    else if (u.role === 'farmer') ids = q(`SELECT DISTINCT o.order_id FROM orders o JOIN order_items i ON i.order_id = o.order_id
                                           JOIN produce p ON p.produce_id = i.produce_id WHERE p.farmer_id = ? ORDER BY o.order_id DESC`).all(u.user_id);
    else ids = q('SELECT order_id FROM orders ORDER BY order_id DESC').all();
    return { orders: ids.map((r) => orderWithItems(r.order_id, u.role === 'farmer' ? u.user_id : null)) };
  });

  function authorisedOrder(req, id) {
    const u = requireUser(req);
    const o = orderWithItems(id);
    if (!o) throw new HttpError(404, 'Order not found.');
    if (u.role === 'buyer' && o.buyer_id !== u.user_id) throw new HttpError(403, 'That order does not belong to you.');
    if (u.role === 'farmer') throw new HttpError(403, 'You do not have permission to do that.');
    return o;
  }

  route('GET', '/api/orders/:id', async (req, res, ctx) => ({ order: authorisedOrder(req, toId(ctx.params.id)) }));

  route('GET', '/api/orders/:id/receipt.pdf', async (req, res, ctx) => {
    const o = authorisedOrder(req, toId(ctx.params.id));
    const buf = receiptPdf(o, o.items, { full_name: o.buyer_name, email: o.buyer_email });
    return { raw: buf, headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': `attachment; filename="receipt-AC-${String(o.order_id).padStart(5, '0')}.pdf"` } };
  });

  route('PUT', '/api/orders/:id/status', async (req, res, ctx) => {
    requireUser(req, 'admin');
    const id = toId(ctx.params.id);
    const o = q('SELECT status FROM orders WHERE order_id = ?').get(id);
    if (!o) throw new HttpError(404, 'Order not found.');
    const next = ctx.body.status;
    if (!STATUS_FLOW.includes(next)) throw new HttpError(400, 'Unknown status.');
    if (STATUS_FLOW.indexOf(next) !== STATUS_FLOW.indexOf(o.status) + 1)
      throw new HttpError(409, `Order must move ${o.status} → ${STATUS_FLOW[STATUS_FLOW.indexOf(o.status) + 1] || '(final)'} in sequence.`);
    q('UPDATE orders SET status = ? WHERE order_id = ?').run(next, id);
    return { message: `Order marked ${next}.` };
  });

  // ----- Admin -----
  route('GET', '/api/admin/users', async (req) => {
    requireUser(req, 'admin');
    return { users: q('SELECT user_id,full_name,email,role,approved,location,farm_name,created_at FROM users ORDER BY created_at DESC, user_id DESC').all() };
  });

  route('PUT', '/api/admin/users/:id/approve', async (req, res, ctx) => {
    requireUser(req, 'admin');
    const id = toId(ctx.params.id);
    const target = q('SELECT role FROM users WHERE user_id = ?').get(id);
    if (!target) throw new HttpError(404, 'User not found.');
    const approved = ctx.body.approved === false ? 0 : 1;
    if (target.role === 'admin') throw new HttpError(400, 'Administrator accounts cannot be changed here.');
    q('UPDATE users SET approved = ? WHERE user_id = ?').run(approved, id);
    return { message: approved ? 'Account approved.' : 'Account suspended.' };
  });

  route('GET', '/api/admin/stats', async (req) => {
    requireUser(req, 'admin');
    const n = (sql) => q(sql).get().n;
    return {
      farmers: n("SELECT COUNT(*) n FROM users WHERE role='farmer'"),
      pending_farmers: n("SELECT COUNT(*) n FROM users WHERE role='farmer' AND approved=0"),
      buyers: n("SELECT COUNT(*) n FROM users WHERE role='buyer'"),
      listings: n('SELECT COUNT(*) n FROM produce WHERE approved=1'),
      orders: n('SELECT COUNT(*) n FROM orders'),
      revenue: q('SELECT COALESCE(SUM(total),0) n FROM orders').get().n,
    };
  });

  // ----- Contact -----
  route('POST', '/api/contact', async (req, res, ctx) => {
    const name = sec.cleanText(ctx.body.name, 80);
    const email = sec.cleanText(ctx.body.email, 120);
    const body = sec.cleanText(ctx.body.message, 1000);
    const fields = {};
    if (name.length < 2) fields.name = 'Enter your name.';
    if (!sec.validateEmail(email)) fields.email = 'Enter a valid email address.';
    if (body.length < 5) fields.message = 'Message is too short.';
    if (Object.keys(fields).length) throw new HttpError(400, 'Please correct the highlighted fields.', fields);
    q('INSERT INTO messages (name,email,body) VALUES (?,?,?)').run(name, email, body);
    return { status: 201, data: { message: 'Thank you, we will be in touch.' } };
  });

  const DUMMY_HASH = sec.hashPassword('dummy-password-1');

  // ---------- static files ----------
  function serveStatic(req, res, pathname) {
    let rel = decodeURIComponent(pathname);
    if (rel === '/') rel = '/index.html';
    const file = path.normalize(path.join(PUBLIC_DIR, rel));
    if (!file.startsWith(PUBLIC_DIR + path.sep)) return send(res, 403, 'Forbidden'); // blocks ../ traversal
    fs.stat(file, (err, st) => {
      if (err || !st.isFile()) return send(res, 404, 'Not found');
      res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', ...securityHeaders(), 'Cache-Control': 'public, max-age=300' });
      fs.createReadStream(file).pipe(res);
    });
  }

  // ---------- request handler ----------
  async function handler(req, res) {
    const url = new URL(req.url, 'http://localhost');
    const pathname = url.pathname;
    try {
      if (pathname.startsWith('/api/') || pathname === '/health') {
        // CSRF defence in depth: SameSite=Strict cookie + required header on state-changing calls
        if (['POST', 'PUT', 'DELETE'].includes(req.method) && req.headers['x-requested-with'] !== 'AgriConnect')
          throw new HttpError(403, 'Missing request header.');
        for (const r of routes) {
          if (r.method !== req.method) continue;
          const m = r.re.exec(pathname);
          if (!m) continue;
          const params = {}; r.keys.forEach((k, i) => { params[k] = decodeURIComponent(m[i + 1]); });
          const body = ['POST', 'PUT'].includes(req.method) ? await readBody(req) : {};
          const out = await r.handler(req, res, { params, body, query: Object.fromEntries(url.searchParams) });
          if (out && out.raw) return send(res, 200, out.raw, out.headers);
          if (out && out.status) return send(res, out.status, out.data);
          return send(res, 200, out);
        }
        if (routes.some((r) => r.re.test(pathname))) throw new HttpError(405, 'Method not allowed.');
        throw new HttpError(404, 'Not found.');
      }
      if (req.method !== 'GET' && req.method !== 'HEAD') throw new HttpError(405, 'Method not allowed.');
      return serveStatic(req, res, pathname);
    } catch (e) {
      if (e instanceof HttpError) return send(res, e.status, { error: e.message, fields: e.fields });
      console.error('Unhandled error:', e);
      return send(res, 500, { error: 'Something went wrong on the server.' });
    }
  }

  return http.createServer(handler);
}

module.exports = { createApp };
