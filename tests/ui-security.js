'use strict';
// Browser-level security + usability checks (Playwright + Chromium).
// Usage: node tests/ui-security.js <output-dir>
const path = require('path');
const fs = require('fs');
const { chromium } = require('playwright');
const { open } = require('../src/db');
const { createApp } = require('../src/app');

const OUT = path.resolve(process.argv[2] || 'ui-evidence');
fs.mkdirSync(OUT, { recursive: true });
const results = [];
const record = (id, check, expected, ok, actual) => { results.push({ id, check, expected, actual, result: ok ? 'PASS' : 'FAIL' }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${id}  ${check}  — ${actual}`); };
const H = { 'Content-Type': 'application/json', 'X-Requested-With': 'AgriConnect' };

(async () => {
  const db = open(':memory:');
  const server = createApp(db);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();
  const dialogs = [];
  page.on('dialog', async (d) => { dialogs.push(d.message()); await d.dismiss(); });

  // ---- client-side validation on registration (no request should be sent) ----
  let apiCalls = 0; page.on('request', (r) => { if (r.url().includes('/api/register')) apiCalls++; });
  await page.goto(`${base}/index.html#register`);
  await page.fill('#register-name', 'A'); await page.fill('#register-email', 'bad-email'); await page.fill('#register-password', 'abc');
  await page.click('#register-form button[type=submit]');
  const errTexts = await page.locator('#register-form .field-error').allTextContents();
  record('UI-SEC-01', 'Client-side validation on registration', 'Errors shown for name, email and password; no API request sent',
    errTexts.filter(Boolean).length >= 3 && apiCalls === 0, `errors=${JSON.stringify(errTexts.filter(Boolean))}, api calls=${apiCalls}`);
  await page.screenshot({ path: path.join(OUT, 'client_validation_register.png') });

  // ---- stored XSS: malicious names must render as inert text ----
  const evil = { role: 'farmer', full_name: '<img src=x onerror="window.__xss=1">', email: 'evil@example.com', password: 'Secret123', farm_name: '<script>window.__xss=2</script>Evil Farm', bio: '"><svg onload=window.__xss=3>', location: 'Nairobi' };
  const reg = await fetch(`${base}/api/register`, { method: 'POST', headers: H, body: JSON.stringify(evil) });
  const evilId = (await reg.json()).user_id;
  // admin approves via the real login flow
  await page.goto(`${base}/index.html#login`);
  await page.fill('#login-email', 'admin@agriconnect.co.ke'); await page.fill('#login-password', 'Admin@1234');
  await page.click('#login-form button[type=submit]');
  await page.waitForSelector('#admin-users tr');
  await page.evaluate((id) => fetch(`/api/admin/users/${id}/approve`, { method: 'PUT', headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'AgriConnect' }, body: JSON.stringify({ approved: true }) }), evilId);
  await page.reload(); await page.waitForSelector('#admin-users tr');
  const adminText = await page.textContent('#admin-users');
  const xssAdmin = await page.evaluate(() => window.__xss);
  record('UI-SEC-02', 'Stored XSS in admin dashboard user list', 'Payload shown as text; no script runs', xssAdmin === undefined && adminText.includes('<img src=x'), `window.__xss=${xssAdmin}, literal text shown=${adminText.includes('<img src=x')}`);
  await page.screenshot({ path: path.join(OUT, 'xss_admin_dashboard.png') });
  await page.locator(`#farmer-list [data-id="${evilId}"]`).click();
  await page.waitForFunction((id) => document.querySelector('#farmer-profile').textContent.includes('Evil Farm'), evilId);
  const farmerXss = await page.evaluate(() => window.__xss);
  const farmerText = await page.textContent('#farmer-profile');
  record('UI-SEC-03-farmer', 'Stored XSS on the consolidated farmer profile', 'Payload shown as text; no script runs; no alert dialog',
    farmerXss === undefined && dialogs.length === 0 && farmerText.includes('<script>'), `window.__xss=${farmerXss}, literal text shown=${farmerText.includes('<script>')}`);
  await page.screenshot({ path: path.join(OUT, 'xss_farmer_profile.png') });

  // ---- reflected XSS via query string ----
  await page.goto(`${base}/index.html?search=%3Cimg%20src%3Dx%20onerror%3Dwindow.__xss%3D9%3E`, { waitUntil: 'networkidle' });
  record('UI-SEC-04', 'Reflected XSS via ?search= on catalogue', 'No script runs', (await page.evaluate(() => window.__xss)) === undefined && dialogs.length === 0, `window.__xss=${await page.evaluate(() => window.__xss)}`);

  // ---- protected pages when logged out ----
  const ctx2 = await browser.newContext(); const p2 = await ctx2.newPage();
  await p2.goto(`${base}/index.html#admin-dashboard`, { waitUntil: 'networkidle' });
  const url2 = p2.url(); const txt2 = await p2.textContent('body');
  record('UI-SEC-05', 'Admin section opened without logging in', 'Shown no admin data while logged out',
    !/System Administrator/.test(txt2) && (await p2.locator('#admin-users tr').count()) === 0,
    `url=${url2}, user rows visible=${await p2.locator('#admin-users tr').count()}, message="${(await p2.textContent('#admin-message')).trim().slice(0, 60)}"`);
  await p2.screenshot({ path: path.join(OUT, 'admin_page_logged_out.png') });
  await ctx2.close();

  // ---- usability / accessibility basics on key pages at both sizes ----
  for (const [name, vp] of [['desktop', { width: 1280, height: 800 }], ['mobile', { width: 375, height: 812 }]]) {
    const c = await browser.newContext({ viewport: vp }); const p = await c.newPage();
    for (const pg of ['index.html']) {
      await p.goto(`${base}/${pg}`, { waitUntil: 'networkidle' });
      const r = await p.evaluate(() => {
        const unlabeled = [...document.querySelectorAll('input:not([type=hidden]),select,textarea')].filter((el) => !el.labels || el.labels.length === 0 && !el.getAttribute('aria-label')).map((el) => el.id || el.name);
        const noAlt = [...document.querySelectorAll('img')].filter((i) => !i.hasAttribute('alt')).length;
        const small = [...document.querySelectorAll('button, .btn, input:not([type=hidden]), select')].filter((el) => el.offsetParent && el.getBoundingClientRect().height < 40).map((el) => el.id || el.className || el.tagName);
        return { lang: document.documentElement.lang, viewport: !!document.querySelector('meta[name=viewport]'), title: document.title, unlabeled, noAlt, small, h1: document.querySelectorAll('h1').length };
      });
      const good = r.lang && r.viewport && r.title && r.unlabeled.length === 0 && r.noAlt === 0 && r.small.length === 0 && r.h1 === 1;
      record(`UI-USA-${name}-${pg.replace('.html', '')}`, `Accessibility basics at ${vp.width}px (${pg})`, 'lang, viewport, title, one h1, labelled inputs, alt text, tap targets ≥ 40px', good, JSON.stringify(r));
    }
    await c.close();
  }

  await browser.close(); server.close();
  fs.writeFileSync(path.join(OUT, 'ui-security-results.json'), JSON.stringify(results, null, 2));
  const failed = results.filter((r) => r.result === 'FAIL').length;
  console.log(`\n${results.length - failed}/${results.length} UI security/usability checks passed`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
