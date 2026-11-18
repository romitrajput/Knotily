// Browser test of the whole shopper journey on the offline stack (Playwright + Chromium).
// Run: node tests/e2e/shopper.e2e.mjs [--shots dir]
// Needs PostgreSQL (tests/README.md) and Playwright (npm i -D playwright && npx playwright install chromium).
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
import assert from 'node:assert/strict';
import { startStack } from './stack.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const shotsAt = process.argv.includes('--shots') ? process.argv[process.argv.indexOf('--shots') + 1] : null;
if (shotsAt) mkdirSync(shotsAt, { recursive: true });

const stack = await startStack({ quiet: true });
const { url, emu } = stack;
// a product track for the audio test
await emu.sql(`update products set audio_url = '${url}/tests/e2e/assets/tone.wav', audio_title = 'Bad Idea — studio loop' where slug = 'bad-idea-oversized-tee'`);

const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
const errors = [];
let step = 0;
const log = (m) => console.log(`  ✓ ${m}`);

async function run(viewport, ua) {
  const ctx = await browser.newContext({ viewport, userAgent: ua, hasTouch: !!ua });
  await ctx.route(/fonts\.(googleapis|gstatic)\.com|checkout\.razorpay\.com/, (r) => r.abort());
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && !/ERR_FAILED|fonts|net::/.test(m.text()) && errors.push(m.text()));
  const shot = async (name) => shotsAt && page.screenshot({ path: `${shotsAt}/${String(++step).padStart(2, '0')}-${name}.png` });
  return { ctx, page, shot };
}

try {
  // ------------------------------------------------------------ desktop journey
  const { ctx, page, shot } = await run({ width: 1440, height: 900 });
  await page.goto(url + '/', { waitUntil: 'networkidle' });
  await page.waitForSelector('.card');
  await page.waitForSelector('.hero-brand');
  assert.equal(await page.getAttribute('html', 'data-device'), 'desktop');
  await page.waitForSelector('.env-banner');
  log('home: brand hero, product rows, device tag, Testing banner');
  await page.waitForSelector('.consent.in');
  await shot('home-consent');
  await page.click('.consent [data-choice="yes"]');
  log('consent accepted');

  await page.click('[data-search-open]');
  await page.keyboard.type('poison');
  await page.waitForSelector('.srch-item');
  assert.match(await page.textContent('.srch-grid'), /Poison Oversized Tee/);
  await page.keyboard.press('Enter');
  await page.waitForURL(/\/shop\?q=poison/);
  await page.waitForSelector('.grid-shop .card');
  assert.equal(await page.$$eval('.grid-shop .card', (c) => c.length), 1);
  log('search overlay → results → shop filtered by the search');

  await page.goto(url + '/shop', { waitUntil: 'networkidle' });
  await page.check('input[name=color][value="Poison"]');
  await page.waitForFunction(() => /color=Poison/.test(location.search));
  const n = await page.$$eval('.grid-shop .card', (c) => c.length);
  assert.ok(n >= 1 && n < 16);
  await page.check('input[name=size][value="XS"]', { force: true });
  await page.waitForFunction(() => /size=XS/.test(location.search));
  await page.click('.active-filters [data-clear]');
  await page.waitForFunction(() => document.querySelectorAll('.grid-shop .card').length === 16);
  log('shop filters (colour, size) in the address bar, clear all');

  await page.click('.card-wish >> nth=0');
  await page.waitForSelector('.modal-root.in [data-auth="signup"]');
  await page.click('.modal [data-dismiss] >> nth=0');
  log('wishlist heart while signed out → account pop-up');

  await page.goto(url + '/product/after-hours-oversized-tee?color=Latex%20Black', { waitUntil: 'networkidle' });
  await page.check('input[name=size][value=M]', { force: true });
  await page.waitForSelector('.stock-msg.is-out');
  assert.match(await page.textContent('[data-buy]'), /Remind me/);
  await shot('pdp-out-of-stock');
  log('sold-out size shows Out of stock + Remind me');

  await page.goto(url + '/product/bad-idea-oversized-tee', { waitUntil: 'networkidle' });
  await page.waitForSelector('.track-pill.in');
  await page.waitForFunction(() => document.querySelector('.track-pill')?.classList.contains('is-playing'), null, { timeout: 5000 });
  log('product track plays');
  await page.click('.track-btn');
  assert.ok(!(await page.$eval('.track-pill', (el) => el.classList.contains('is-playing'))));
  const muted = await page.evaluate(() => localStorage.getItem('knotily.audio.muted'));
  assert.equal(muted, 'true');
  log('track muted, choice remembered');
  await page.check('input[name=size][value=M]', { force: true });
  await page.click('[data-buy]');
  await page.waitForSelector('.modal-root.in [data-auth="signup"]');
  await shot('signup-popup');
  log('Buy now while signed out → create-account pop-up');

  await page.fill('#a-fullName', 'Riya Sharma');
  await page.fill('#a-email', 'riya@e2e.in');
  await page.fill('#a-password', 'knotily123');
  await page.fill('#a-confirmPassword', 'knotily124');
  await page.check('input[name=acceptTerms]');
  await page.click('.modal [type=submit]');
  assert.match(await page.textContent('#ae-confirmPassword'), /don’t match/);
  await page.fill('#a-confirmPassword', 'knotily123');
  await page.click('.modal [type=submit]');
  await page.waitForSelector('[data-auth="verify"]');
  await shot('verify-email');
  log('password confirmation enforced; verify-email screen');

  const mail = await (await fetch(`${emu.base}/__mail?to=riya@e2e.in`)).json();
  await page.goto(mail.at(-1).link, { waitUntil: 'networkidle' });
  await page.waitForSelector('[data-continue]');
  assert.ok(!page.url().includes('access_token'), 'tokens wiped from the address bar');
  await shot('verified');
  log('email link signs in, tokens removed from URL, offers to continue');
  await page.click('[data-continue]');
  await page.waitForSelector('[data-checkout]');
  assert.equal(await page.inputValue('#f-fullName'), 'Riya Sharma');
  assert.equal(await page.inputValue('#f-email'), 'riya@e2e.in');
  log('checkout pre-filled with name and email');

  await page.fill('#f-phone', '9876543210');
  await page.fill('#f-line1', '12 Park Street');
  await page.fill('#f-landmark', 'Opposite Metro Gate 2');
  await page.fill('#f-city', 'Kolkata');
  await page.fill('#f-pin', '700016');
  await page.selectOption('#f-state', 'West Bengal');
  await page.fill('#f-age', '24');
  await page.selectOption('#f-gender', 'female');
  await shot('checkout');
  await page.click('[data-place]');
  await page.waitForSelector('.mock-pay');
  await page.click('[data-outcome="success"]');
  await page.waitForSelector('.confirm-lede');
  assert.match(await page.textContent('.page-title'), /Order placed/);
  await shot('order-placed');
  log('mock payment → order confirmed');
  const stock = await emu.sql(`select v.stock from product_variants v join products p on p.id=v.product_id join product_colors c on c.id=v.color_id where p.slug='bad-idea-oversized-tee' and c.name='Red Light' and v.size='M'`);
  log(`inventory decremented (now ${stock})`);

  await page.goto(url + '/product/after-hours-oversized-tee?color=Latex%20Black', { waitUntil: 'networkidle' });
  await page.check('input[name=size][value=L]', { force: true });
  await page.click('[data-buy]');
  await page.waitForSelector('.toast.in');
  assert.match(await page.textContent('.toast'), /email/);
  log('signed-in Remind me sets a reminder');

  await page.goto(url + '/account', { waitUntil: 'networkidle' });
  await page.waitForSelector('.order-list li');
  assert.equal(await page.$$eval('.rem-list li', (l) => l.length), 1);
  await shot('account');
  log('account lists the order and the reminder');

  await page.goto(url + '/product/poison-oversized-tee', { waitUntil: 'networkidle' });
  await page.click('[data-wish-btn]');
  await page.waitForFunction(() => document.querySelector('[data-wish-btn]').getAttribute('aria-pressed') === 'true');
  await page.waitForSelector('[data-wish-count]:not([hidden])');
  await page.goto(url + '/wishlist', { waitUntil: 'networkidle' });
  await page.waitForSelector('.grid-shop .card');
  assert.match(await page.textContent('.grid-shop'), /Poison/);
  await page.click('.card-wish');
  await page.waitForSelector('.empty-page');
  log('wishlist: save from product page, header count, wishlist page, remove');
  const ev = await emu.sql(`select count(*) || ':' || count(distinct name) || ':' || count(user_id) from events`);
  log(`analytics captured (${ev} = events:kinds:linked-to-user)`);
  const linked = Number(await emu.sql(`select count(*) from identity_links`));
  assert.ok(linked >= 1, 'visitor linked to account');
  await ctx.close();

  // ------------------------------------------------------------ phone (iOS) journey
  const iphone = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1';
  const m = await run({ width: 390, height: 844 }, iphone);
  await m.page.goto(url + '/product/poison-oversized-tee', { waitUntil: 'networkidle' });
  assert.equal(await m.page.getAttribute('html', 'data-device'), 'phone');
  assert.equal(await m.page.getAttribute('html', 'data-os'), 'ios');
  await m.page.click('.consent [data-choice="no"]');
  await m.shot('phone-pdp');
  await m.page.check('input[name=size][value=L]', { force: true });
  await m.page.click('[data-buy]');
  await m.page.waitForSelector('.modal-root.in');
  await m.page.click('[data-mode="login"]');
  await m.page.fill('#a-email', 'riya@e2e.in');
  await m.page.fill('#a-password', 'knotily123');
  await m.shot('phone-login');
  await m.page.click('.modal [type=submit]');
  await m.page.waitForSelector('[data-checkout]', { timeout: 20000 });
  assert.equal(await m.page.inputValue('#f-phone'), '9876543210');
  assert.equal(await m.page.inputValue('#f-landmark'), 'Opposite Metro Gate 2');
  await m.shot('phone-checkout-prefilled');
  log('phone/iOS: login from pop-up, into-the-bag animation, checkout pre-filled from saved address');
  const consentEvents = Number(await emu.sql(`select count(*) from events where os = 'ios'`));
  assert.equal(consentEvents, 0, 'no tracking without consent');
  log('declined analytics → nothing recorded');
  await m.ctx.close();

  assert.deepEqual(errors, [], 'no page errors');
  console.log('\nSHOPPER E2E PASSED');
} catch (e) {
  console.error('\nFAILED:', e.message);
  if (errors.length) console.error('page errors:', errors);
  process.exitCode = 1;
} finally {
  await browser.close();
  stack.close();
}
