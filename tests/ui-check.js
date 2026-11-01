'use strict';
// Browser-level checks (Playwright + Chromium): console/CSP errors, responsive overflow, full buyer journey.
// Usage: node tests/ui-check.js <output-dir>      (requires: playwright, available globally in the lab image)
const path = require('path');
const fs = require('fs');
const { chromium } = require('playwright');
const { open } = require('../src/db');
const { createApp } = require('../src/app');

const OUT = path.resolve(process.argv[2] || 'ui-evidence');
fs.mkdirSync(OUT, { recursive: true });
const VIEWPORTS = { desktop: { width: 1280, height: 800 }, mobile: { width: 375, height: 812 } };
const PAGES = ['index.html'];
const results = [];
const record = (id, check, ok, detail = '') => { results.push({ id, check, ok, detail }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${id}  ${check}${detail ? '  — ' + detail : ''}`); };

(async () => {
  const db = open(':memory:');
  const server = createApp(db);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch();

  for (const [vpName, vp] of Object.entries(VIEWPORTS)) {
    const ctx = await browser.newContext({ viewport: vp });
    const page = await ctx.newPage();
    const errors = [];
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
    page.on('pageerror', (e) => errors.push(String(e)));

    for (const p of PAGES) {
      errors.length = 0;
      await page.goto(`${base}/${p}`, { waitUntil: 'networkidle' });
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      record(`UI-${vpName}-${p.split('?')[0]}`, `renders at ${vp.width}px with no console/CSP errors and no horizontal scroll`, errors.length === 0 && overflow <= 1, errors.join(' | ') || (overflow > 1 ? `overflow ${overflow}px` : ''));
      const categories = await page.locator('#categories').textContent();
      record(`UI-${vpName}-categories`, 'shows Fruits, Vegetables, Cereals and Poultry', ['Fruits', 'Vegetables', 'Cereals', 'Poultry'].every((name) => categories.includes(name)), categories);
      const images = await page.locator('#categories img').evaluateAll((els) => els.map((image) => ({ complete: image.complete, width: image.naturalWidth })));
      record(`UI-${vpName}-category-images`, 'all category photos load', images.length === 4 && images.every((image) => image.complete && image.width > 0), JSON.stringify(images));
      await page.screenshot({ path: path.join(OUT, `${vpName}_${p.split('?')[0].replace('.html', '')}.png`), fullPage: true });
    }

    // ---- Buyer journey: login -> add to cart -> checkout -> receipt ----
    await page.goto(`${base}/index.html#login`);
    await page.fill('#login-email', 'buyer@hotel.co.ke'); await page.fill('#login-password', 'Demo@1234');
    await page.click('#login-form button[type=submit]');
    await page.waitForFunction(() => location.hash === '#catalog');
    await page.locator('#catalog-results [data-action=product]').first().click();
    await page.locator('#product-detail input[type=number]').fill('3');
    await page.locator('#product-detail button.accent').click();
    await page.locator('nav.main a[href="#cart"]').click();
    const rowText = await page.textContent('#cart-content tbody');
    record(`UI-${vpName}-cart`, 'cart shows added item and correct subtotal (3 × 120 = KES 360)', /Tomatoes/.test(rowText) && /360/.test(rowText));
    await page.click('#cart-content button.accent');
    const addrErr = await page.textContent('#delivery-address-error');
    record(`UI-${vpName}-checkout-validation`, 'empty delivery address is rejected with a message', /required/i.test(addrErr));
    await page.fill('#delivery-address', 'Hotel Grace, Moi Avenue, Nairobi');
    await page.click('#cart-content button.accent');
    await page.waitForSelector('#order-receipt h3');
    const heading = await page.textContent('#order-receipt h3');
    record(`UI-${vpName}-receipt`, 'receipt appears on the consolidated page', /Receipt AC-\d{5}/.test(heading), heading);
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.locator('#order-receipt a[href*="/receipt.pdf"]').click(),
    ]);
    record(`UI-${vpName}-receipt-download`, 'buyer can download a PDF receipt', download.suggestedFilename().endsWith('.pdf'), download.suggestedFilename());
    await page.screenshot({ path: path.join(OUT, `${vpName}_receipt.png`), fullPage: true });
    await ctx.close();
  }

  // ---- Admin dashboard & farmer dashboard render ----
  const ctx = await browser.newContext({ viewport: VIEWPORTS.desktop });
  const page = await ctx.newPage();
  await page.goto(`${base}/index.html#login`);
  await page.fill('#login-email', 'admin@agriconnect.co.ke'); await page.fill('#login-password', 'Admin@1234');
  await page.click('#login-form button[type=submit]');
  await page.waitForSelector('#admin-users tr');
  record('UI-admin', 'admin dashboard lists users and orders', (await page.locator('#admin-users tr').count()) >= 5);
  await page.screenshot({ path: path.join(OUT, 'desktop_admin.png'), fullPage: true });
  const farmerPage = await ctx.newPage();
  await farmerPage.goto(`${base}/index.html#login`);
  await farmerPage.fill('#login-email', 'wanjiru@farm.co.ke'); await farmerPage.fill('#login-password', 'Demo@1234');
  await farmerPage.click('#login-form button[type=submit]');
  await farmerPage.waitForSelector('#farmer-listings tr');
  record('UI-farmer', 'farmer dashboard lists own produce', (await farmerPage.locator('#farmer-listings tr').count()) >= 4);
  await farmerPage.screenshot({ path: path.join(OUT, 'desktop_dashboard.png'), fullPage: true });

  await browser.close(); server.close();
  fs.writeFileSync(path.join(OUT, 'ui-results.json'), JSON.stringify(results, null, 2));
  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - failed}/${results.length} UI checks passed`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
