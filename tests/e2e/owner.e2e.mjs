// Browser test of the owner dashboard on the offline stack.
// Run: node tests/e2e/owner.e2e.mjs [--shots dir]
import { createRequire } from 'node:module';
import { mkdirSync, readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { startStack } from './stack.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const shotsAt = process.argv.includes('--shots') ? process.argv[process.argv.indexOf('--shots') + 1] : null;
if (shotsAt) mkdirSync(shotsAt, { recursive: true });
const asset = (f) => new URL(`./assets/${f}`, import.meta.url).pathname;

const stack = await startStack({ quiet: true });
const { url, emu } = stack;
const browser = await chromium.launch();
const errors = [];
let step = 0;
const log = (m) => console.log(`  ✓ ${m}`);

try {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true });
  await ctx.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && !/ERR_FAILED|fonts|net::|status of 401/.test(m.text()) && errors.push(m.text()));
  page.on('dialog', (d) => d.accept());
  const shot = async (name, full = false) => shotsAt && page.screenshot({ path: `${shotsAt}/${String(++step).padStart(2, '0')}-${name}.png`, fullPage: full });

  // a shopper who is waiting for After Hours black M, plus a paid order to look at
  const shopper = async (email) => {
    const r = await fetch(`${url}/api/auth/signup`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-knotily': '1', origin: url }, body: JSON.stringify({ email, password: 'shop1234', confirmPassword: 'shop1234', fullName: 'Kabir Mehta', acceptTerms: true }) });
    assert.equal(r.status, 200);
    const link = (await (await fetch(`${emu.base}/__mail?to=${email}`)).json()).at(-1).link;
    const hash = new URLSearchParams((await fetch(link, { redirect: 'manual' })).headers.get('location').split('#')[1]);
    const s = await fetch(`${url}/api/auth/session`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-knotily': '1', origin: url }, body: JSON.stringify({ access_token: hash.get('access_token'), refresh_token: hash.get('refresh_token') }) });
    const cookie = s.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
    return (method, path, body) => fetch(url + path, { method, headers: { 'content-type': 'application/json', 'x-knotily': '1', origin: url, cookie }, body: body && JSON.stringify(body) }).then((r) => r.json());
  };
  const kabir = await shopper('kabir@e2e.in');
  const oos = await emu.sql(`select v.id from product_variants v join products p on p.id=v.product_id join product_colors c on c.id=v.color_id where p.slug='after-hours-oversized-tee' and c.name='Latex Black' and v.size='M'`);
  await kabir('POST', '/api/reminders', { variantId: oos });
  const v2 = await emu.sql(`select v.id from product_variants v join products p on p.id=v.product_id join product_colors c on c.id=v.color_id where p.slug='poison-oversized-tee' and c.name='Poison' and v.size='L'`);
  await kabir('PUT', '/api/cart/items', { variantId: v2, qty: 2, mode: 'add' });
  const co = await kabir('POST', '/api/checkout', { shipping: { fullName: 'Kabir Mehta', phone: '9123456780', line1: '4 MG Road', landmark: 'Near Forum Mall', city: 'Bengaluru', state: 'Karnataka', pin: '560001', age: 29, gender: 'male' }, sessionId: 'kabir-visit' });
  await kabir('POST', '/api/events', { consent: true, events: [
    { name: 'page_view', session_id: 'kabir-visit', path: '/', utm_source: 'instagram', utm_campaign: 'drop04' },
    { name: 'product_view', session_id: 'kabir-visit', product_id: await emu.sql(`select id from products where slug='poison-oversized-tee'`), props: { color: 'Poison' } },
    { name: 'size_select', session_id: 'kabir-visit', props: { size: 'L' } },
    { name: 'checkout_start', session_id: 'kabir-visit' },
  ] });
  await kabir('POST', '/api/payments/mock-complete', { orderId: co.order_id, outcome: 'success' });

  // owner signs up through the site, then gets the owner role (done once in SQL; see docs/SETUP.md)
  await page.goto(url + '/account?mode=signup', { waitUntil: 'networkidle' });
  await page.click('.consent [data-choice="no"]').catch(() => {});
  await page.fill('#a-fullName', 'Store Owner');
  await page.fill('#a-email', 'owner@e2e.in');
  await page.fill('#a-password', 'owner1234');
  await page.fill('#a-confirmPassword', 'owner1234');
  await page.check('input[name=acceptTerms]');
  await page.click('[type=submit]');
  await page.waitForSelector('[data-auth="verify"]');
  const link = (await (await fetch(`${emu.base}/__mail?to=owner@e2e.in`)).json()).at(-1).link;
  await emu.makeOwner('owner@e2e.in').catch(() => {});
  await page.goto(link, { waitUntil: 'networkidle' });
  await emu.makeOwner('owner@e2e.in');
  await page.goto(url + '/admin', { waitUntil: 'networkidle' });
  await page.waitForSelector('.kpis');
  assert.match(await page.textContent('.kpis'), /₹/);
  await page.waitForTimeout(300);
  await shot('overview', true);
  log('overview: KPIs, charts, funnel, devices');

  // products → edit After Hours: restock the sold-out size, upload artwork, track and a photo
  await page.click('.adm-nav a[href="/admin/products"]');
  await page.waitForSelector('.adm-table tbody tr');
  await shot('products');
  await page.click('.adm-table a.adm-strong:has-text("After Hours Oversized Tee")');
  await page.waitForSelector('[data-editor]').catch(async (e) => {
    console.error('URL', page.url(), (await page.textContent('[data-adm-main]')).slice(0, 300));
    throw e;
  });
  await page.fill('input[data-stock="Latex Black|M"]', '9');
  await page.setInputFiles('input[data-upload="art-front"]', asset('art.png'));
  await page.waitForSelector('.file-current img');
  await page.setInputFiles('input[data-upload="audio"]', asset('tone.wav'));
  await page.waitForSelector('.adm-audio');
  await page.setInputFiles('input[data-upload="media"]', asset('model.jpg'));
  await page.waitForSelector('.media-grid li');
  await page.fill('[data-mf="alt"]', 'Model wearing After Hours, back print');
  await page.fill('#e-disc', '15');
  await page.waitForTimeout(1500); // 3D preview repaints with the artwork
  await shot('editor', true);
  await page.click('.save-bar [type=submit]');
  await page.waitForFunction(() => [...document.querySelectorAll('.adm-flash-ok')].some((e) => /1 shopper emailed/.test(e.textContent)));
  const back = (await (await fetch(`${emu.base}/__mail`)).json()).length; // auth mails only; app mails go to the outbox
  assert.ok(back >= 2);
  const p = JSON.parse(await emu.sql(`select json_build_object('art', print_front_url, 'audio', audio_url, 'disc', discount_pct, 'media', (select count(*) from product_media m where m.product_id = products.id)) from products where slug='after-hours-oversized-tee'`));
  assert.ok(p.art && p.audio && p.disc === 15 && p.media === 1);
  log('editor: restock emailed the waiting shopper; artwork, track, photo and discount saved');

  // the shop shows the new artwork on the 3D tee, the photo, and the track
  const shop = await ctx.newPage();
  await shop.goto(url + '/product/after-hours-oversized-tee', { waitUntil: 'networkidle' });
  await shop.waitForSelector('.pg-item img[src^="http"]');
  await shop.waitForSelector('.track-pill.in');
  assert.match(await shop.textContent('.pdp-price'), /15% off/);
  await shop.waitForTimeout(1500);
  if (shotsAt) await shop.screenshot({ path: `${shotsAt}/${String(++step).padStart(2, '0')}-shop-after-edit.png` });
  await shop.close();
  log('shop: owner photo leads the gallery, track, discount');

  // inventory
  await page.goto(url + '/admin/inventory?filter=low', { waitUntil: 'networkidle' });
  await page.waitForSelector('.inv-table tbody tr');
  const row = page.locator('.inv-table tbody tr').first();
  await row.locator('[data-f=stock]').fill('40');
  await row.locator('[data-save]').click();
  await page.waitForSelector('.adm-flash-ok');
  await shot('inventory');
  log('inventory: low filter and in-place stock save');

  // orders: decrypted address, journey, packed → shipped
  await page.goto(url + '/admin/orders', { waitUntil: 'networkidle' });
  await page.click('[data-more]');
  await page.waitForSelector('.journey li');
  assert.match(await page.textContent('.ship'), /Near Forum Mall/);
  assert.match(await page.textContent('.journey-sum'), /instagram/);
  await shot('orders-journey');
  await page.selectOption('[data-status]', 'packed');
  await page.waitForSelector('.adm-flash-ok');
  await page.selectOption('[data-status]', 'shipped');
  await page.waitForFunction(() => [...document.querySelectorAll('.adm-flash-ok')].some((e) => /emailed/.test(e.textContent)));
  log('orders: decrypted address, journey from Instagram, packed → shipped');

  // alerts and settings
  await page.goto(url + '/admin/alerts', { waitUntil: 'networkidle' });
  await page.waitForSelector('.alert-list li');
  await shot('alerts');
  await page.goto(url + '/admin/settings', { waitUntil: 'networkidle' });
  await page.fill('#s-email', 'alerts@e2e.in');
  await page.fill('#s-vol', '30');
  await page.click('[data-settings] [type=submit]');
  await page.waitForSelector('.adm-flash-ok');
  assert.equal(await emu.sql(`select value #>> '{}' from settings where key='audio_volume'`), '0.3');
  log('alerts inbox; settings saved');

  // homepage banners
  await page.goto(url + '/admin/homepage', { waitUntil: 'networkidle' });
  await page.click('[data-new="hero"]');
  await page.fill('#b-title', 'Drop 05: No strings');
  await page.fill('#b-link', '/shop/tees');
  await page.setInputFiles('input[data-up="image_url"]', asset('model.jpg'));
  await page.waitForSelector('.banner-prev');
  await page.click('[data-form] [type=submit]');
  await page.waitForFunction(() => [...document.querySelectorAll('.adm-flash-ok')].some((e) => /Saved/.test(e.textContent)));
  await page.click('[data-new="announcement"]');
  await page.fill('#b-title', 'Drop 05 lands Friday');
  await page.click('[data-form] [type=submit]');
  await page.waitForSelector('.banner-list li >> nth=1');
  const home = await ctx.newPage();
  await home.goto(url + '/', { waitUntil: 'networkidle' });
  await home.waitForSelector('.hero-slide.is-on img');
  assert.match(await home.textContent('.hero-title'), /Drop 05/);
  await home.waitForFunction(() => /Drop 05 lands Friday/.test(document.querySelector('[data-ann-msg]').textContent));
  if (shotsAt) await home.screenshot({ path: `${shotsAt}/${String(++step).padStart(2, '0')}-home-with-banner.png` });
  await home.close();
  log('homepage: hero slide + announcement from the dashboard show in the shop');

  // categories
  await page.goto(url + '/admin/categories', { waitUntil: 'networkidle' });
  const last = page.locator('.adm-table tbody tr').last();
  await last.locator('[data-f=name]').fill('Co-ord sets');
  await last.locator('[data-save]').click();
  await page.waitForSelector('text=co-ord-sets', { state: 'attached' }).catch(() => {});
  assert.equal(await emu.sql(`select count(*) from categories where slug='co-ord-sets'`), '1');
  log('categories: added');

  // decrypted download behind the password
  await page.goto(url + '/admin/export', { waitUntil: 'networkidle' });
  await page.fill('#x-pw', 'wrongpass1');
  await page.click('[data-unlock] [type=submit]');
  await page.waitForSelector('.adm-flash-error');
  await page.fill('#x-pw', 'owner1234');
  await page.click('[data-unlock] [type=submit]');
  await page.waitForSelector('[data-dl="orders"]');
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('[data-dl="orders"]')]);
  const csv = readFileSync(await dl.path(), 'utf8');
  assert.match(csv, /Kabir Mehta/);
  assert.match(csv, /Near Forum Mall/);
  assert.match(csv, /9123456780/);
  await shot('export');
  log(`export: password re-check, decrypted orders CSV (${dl.suggestedFilename()})`);

  // a shopper can't open the dashboard
  const other = await browser.newContext();
  const op = await other.newPage();
  await op.goto(url + '/admin', { waitUntil: 'networkidle' });
  await op.waitForSelector('[data-auth="login"]');
  await other.close();
  log('signed-out visitors get the log-in form; the API refuses non-owners (see api tests)');

  assert.deepEqual(errors, [], 'no page errors');
  console.log('\nOWNER E2E PASSED');
} catch (e) {
  console.error('\nFAILED:', e.message);
  if (errors.length) console.error('page errors:', errors);
  process.exitCode = 1;
} finally {
  await browser.close();
  stack.close();
}
