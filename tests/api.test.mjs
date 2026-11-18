// End-to-end API tests against a real Postgres (local) with the Supabase/Razorpay emulator.
// Run: npm run test:api   (needs PostgreSQL; see tests/README.md)
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { execFileSync } from 'node:child_process';
import { randomBytes, createHmac } from 'node:crypto';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startEmulator } from './emulator/supabase-emulator.mjs';

const PG = { host: process.env.PGHOST || '127.0.0.1', port: Number(process.env.PGPORT || 54329), user: process.env.PGUSER || 'postgres', db: process.env.PGDATABASE || 'knotily_test' };
const EMU_PORT = 54400, API_PORT = 54401;
const SERVICE = 'service-key-' + randomBytes(8).toString('hex');
const RZP_ID = 'rzp_test_emulator', RZP_SECRET = 'rzp_secret_' + randomBytes(6).toString('hex'), WEBHOOK = 'whsec_' + randomBytes(6).toString('hex');
const outbox = mkdtempSync(join(tmpdir(), 'knotily-outbox-'));
let emu, server;

Object.assign(process.env, {
  APP_ENV: 'testing', SITE_URL: 'http://localhost:5173', COOKIE_SECURE: 'false',
  SUPABASE_URL: `http://127.0.0.1:${EMU_PORT}`, SUPABASE_ANON_KEY: 'anon-key', SUPABASE_SERVICE_ROLE_KEY: SERVICE,
  DATA_ENCRYPTION_KEYS: JSON.stringify({ v1: randomBytes(32).toString('base64') }), DATA_ENCRYPTION_KEY_ID: 'v1',
  BLIND_INDEX_KEY: randomBytes(32).toString('base64'), SERVER_TOKEN_SECRET: randomBytes(32).toString('hex'),
  PAYMENT_PROVIDER: 'razorpay', RAZORPAY_KEY_ID: RZP_ID, RAZORPAY_KEY_SECRET: RZP_SECRET, RAZORPAY_WEBHOOK_SECRET: WEBHOOK,
  RAZORPAY_API_BASE: `http://127.0.0.1:${EMU_PORT}`, MAIL_OUTBOX_DIR: outbox, OWNER_ALERT_EMAIL: '', CRON_SECRET: 'cron-secret',
});

// ------------------------------------------------------------------ tiny browser
function browser() {
  const jar = {};
  async function call(method, path, body, { headers = {}, raw = false } = {}) {
    const res = await fetch(`http://127.0.0.1:${API_PORT}${path}`, {
      method,
      headers: { 'content-type': 'application/json', 'x-knotily': '1', origin: 'http://localhost:5173', cookie: Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('; '), ...headers },
      body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
    });
    for (const c of res.headers.getSetCookie()) {
      const [kv] = c.split(';');
      const i = kv.indexOf('=');
      const k = kv.slice(0, i), v = kv.slice(i + 1);
      if (/Max-Age=0/.test(c)) delete jar[k];
      else jar[k] = v;
    }
    const text = await res.text();
    return { status: res.status, body: raw ? text : text ? JSON.parse(text) : null, headers: res.headers };
  }
  return { call, jar };
}
const mails = (filter = () => true) => readdirSync(outbox).sort().map((f) => JSON.parse(readFileSync(join(outbox, f), 'utf8'))).filter(filter);

async function signUpAndVerify(b, email, password = 'knotily123', fullName = 'Riya Sharma') {
  const r = await b.call('POST', '/api/auth/signup', { email, password, confirmPassword: password, fullName, acceptTerms: true });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const link = emu.mail.filter((m) => m.to === email && m.type === 'signup').at(-1).link;
  const redirect = await fetch(link, { redirect: 'manual' });
  const hash = new URLSearchParams(redirect.headers.get('location').split('#')[1]);
  const s = await b.call('POST', '/api/auth/session', { access_token: hash.get('access_token'), refresh_token: hash.get('refresh_token') });
  assert.equal(s.status, 200);
  return s.body.user;
}
const variant = async (slug, color, size) => {
  const out = await emu.sql(`select v.id from product_variants v join products p on p.id = v.product_id join product_colors c on c.id = v.color_id where p.slug='${slug}' and c.name='${color}' and v.size='${size}'`);
  return out;
};
const stockOf = async (id) => Number(await emu.sql(`select stock from product_variants where id='${id}'`));

before(async () => {
  execFileSync('bash', ['tests/sql/reset-db.sh'], { stdio: 'ignore', env: { ...process.env, PGHOST: PG.host, PGPORT: String(PG.port), PGUSER: PG.user, PGDATABASE: PG.db } });
  emu = await startEmulator({ port: EMU_PORT, pg: PG, serviceKey: SERVICE, anonKey: 'anon-key', razorpaySecret: RZP_SECRET, razorpayKeyId: RZP_ID });
  const { handle } = await import('../server/router.js');
  server = http.createServer(handle);
  await new Promise((r) => server.listen(API_PORT, '127.0.0.1', r));
});
after(() => {
  server?.close();
  emu?.close();
  rmSync(outbox, { recursive: true, force: true });
});

// ------------------------------------------------------------------ tests
const shopper = browser();
let shopperUser;

test('catalogue lists live products with stock state', async () => {
  const r = await shopper.call('GET', '/api/catalog');
  assert.equal(r.status, 200);
  assert.equal(r.body.products.length, 16);
  const tee = r.body.products.find((p) => p.slug === 'after-hours-oversized-tee');
  assert.ok(tee.variants.some((v) => v.state === 'out'));
  assert.ok(r.body.categories.some((c) => c.slug === 'tees'));
  const one = await shopper.call('GET', '/api/catalog/bad-idea-oversized-tee');
  assert.equal(one.body.product.reviews.length, 2);
});

test('sign-up needs matching passwords and a confirmed email', async () => {
  const bad = await shopper.call('POST', '/api/auth/signup', { email: 'riya@test.in', password: 'knotily123', confirmPassword: 'knotily124', fullName: 'Riya', acceptTerms: true });
  assert.equal(bad.status, 400);
  assert.equal(bad.body.error.code, 'PASSWORD_MISMATCH');
  const ok = await shopper.call('POST', '/api/auth/signup', { email: 'riya@test.in', password: 'knotily123', confirmPassword: 'knotily123', fullName: 'Riya Sharma', acceptTerms: true });
  assert.equal(ok.status, 200);
  assert.equal(ok.body.verify, true);
  const early = await shopper.call('POST', '/api/auth/login', { email: 'riya@test.in', password: 'knotily123' });
  assert.equal(early.body.error.code, 'EMAIL_NOT_CONFIRMED');
  // the same email again gets the same answer (no account enumeration)
  const again = await shopper.call('POST', '/api/auth/signup', { email: 'riya@test.in', password: 'other1234', confirmPassword: 'other1234', fullName: 'X Y', acceptTerms: true });
  assert.equal(again.status, 200);
});

test('verification link signs the shopper in with httpOnly cookies', async () => {
  const link = emu.mail.find((m) => m.to === 'riya@test.in').link;
  const redirect = await fetch(link, { redirect: 'manual' });
  assert.match(redirect.headers.get('location'), /^http:\/\/localhost:5173\/account\/verified#access_token=/);
  const hash = new URLSearchParams(redirect.headers.get('location').split('#')[1]);
  const s = await shopper.call('POST', '/api/auth/session', { access_token: hash.get('access_token'), refresh_token: hash.get('refresh_token'), anonId: 'anon-riya-123' });
  assert.equal(s.status, 200);
  assert.equal(s.body.user.fullName, 'Riya Sharma');
  assert.ok(shopper.jar.kn_at && shopper.jar.kn_rt);
  shopperUser = s.body.user;
  const me = await shopper.call('GET', '/api/auth/me');
  assert.equal(me.body.user.email, 'riya@test.in');
});

test('personal data is encrypted in the database', async () => {
  const row = await emu.sql(`select enc_email || '|' || enc_full_name || '|' || email_bidx from profiles where id = '${shopperUser.id}'`);
  assert.ok(!row.includes('riya@test.in') && !row.includes('Riya'));
  assert.match(row, /^v1\./);
});

test('requests without our header or from other sites are blocked (CSRF)', async () => {
  const r = await shopper.call('PUT', '/api/cart/items', { variantId: randomBytes(16).toString('hex') }, { headers: { 'x-knotily': '' } });
  assert.equal(r.status, 403);
  const r2 = await shopper.call('PUT', '/api/cart/items', {}, { headers: { origin: 'https://evil.example' } });
  assert.equal(r2.status, 403);
});

test('signed-out shoppers must create an account before adding to the bag', async () => {
  const guest = browser();
  const r = await guest.call('PUT', '/api/cart/items', { variantId: await variant('bad-idea-oversized-tee', 'Red Light', 'M'), qty: 1 });
  assert.equal(r.status, 401);
  assert.equal(r.body.error.code, 'SIGN_IN_REQUIRED');
});

test('out of stock: refused in the bag, reminder can be set', async () => {
  const oos = await variant('after-hours-oversized-tee', 'Latex Black', 'M');
  const r = await shopper.call('PUT', '/api/cart/items', { variantId: oos, qty: 1, mode: 'add' });
  assert.equal(r.status, 409);
  assert.equal(r.body.error.code, 'OUT_OF_STOCK');
  const rem = await shopper.call('POST', '/api/reminders', { variantId: oos });
  assert.equal(rem.status, 200);
  const list = await shopper.call('GET', '/api/reminders');
  assert.equal(list.body.reminders.length, 1);
  const inStock = await shopper.call('POST', '/api/reminders', { variantId: await variant('bad-idea-oversized-tee', 'Red Light', 'M') });
  assert.equal(inStock.body.error.code, 'IN_STOCK');
});

let paidOrderId, buyVariant, stockBefore;
test('checkout reserves stock, Razorpay payment is verified, stock and bag update', async () => {
  buyVariant = await variant('bad-idea-oversized-tee', 'Red Light', 'M');
  stockBefore = await stockOf(buyVariant);
  const add = await shopper.call('PUT', '/api/cart/items', { variantId: buyVariant, qty: 2, mode: 'add' });
  assert.equal(add.status, 200);
  assert.equal(add.body.count, 2);
  const badPin = await shopper.call('POST', '/api/checkout', { shipping: { fullName: 'Riya Sharma', phone: '9876543210', line1: '12 Park Street', city: 'Kolkata', state: 'West Bengal', pin: '012' } });
  assert.equal(badPin.status, 400);
  const co = await shopper.call('POST', '/api/checkout', {
    shipping: { fullName: 'Riya Sharma', phone: '9876543210', line1: '12 Park Street', landmark: 'Near Metro', city: 'Kolkata', state: 'West Bengal', pin: '700016', age: 24, gender: 'female' },
    sessionId: 'sess-1',
  }, { headers: { 'user-agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) Mobile/15E148 Safari/604.1' } });
  assert.equal(co.status, 200, JSON.stringify(co.body));
  assert.equal(co.body.provider, 'razorpay');
  assert.equal(co.body.razorpay.amount, co.body.total_paise);
  assert.equal(Number(await emu.sql(`select reserved from product_variants where id='${buyVariant}'`)), 2);

  const pay = await (await fetch(`${emu.base}/__razorpay/pay`, { method: 'POST', body: JSON.stringify({ order_id: co.body.razorpay.orderId }) })).json();
  const forged = await shopper.call('POST', '/api/payments/verify', { orderId: co.body.order_id, ...pay, razorpay_signature: 'f'.repeat(64) });
  assert.equal(forged.body.error.code, 'BAD_SIGNATURE');
  const ok = await shopper.call('POST', '/api/payments/verify', { orderId: co.body.order_id, ...pay });
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  assert.equal(ok.body.status, 'paid');
  paidOrderId = ok.body.orderId;

  assert.equal(await stockOf(buyVariant), stockBefore - 2);
  const cart = await shopper.call('GET', '/api/cart');
  assert.equal(cart.body.count, 0);
  const order = await emu.sql(`select device_type || '/' || os || '/' || ship_state from orders where id='${paidOrderId}'`);
  assert.equal(order, 'phone/ios/West Bengal');
  const enc = await emu.sql(`select enc_shipping from orders where id='${paidOrderId}'`);
  assert.ok(!enc.includes('Park Street') && !enc.includes('9876543210'));
  const receipt = mails((m) => m.to === 'riya@test.in' && /confirmed/.test(m.subject));
  assert.equal(receipt.length, 1);
  assert.match(receipt[0].subject, /^\[TESTING\] Order KN/);
});

test('the next checkout is pre-filled from the saved (encrypted) details', async () => {
  const acc = await shopper.call('GET', '/api/account');
  assert.equal(acc.body.phone, '9876543210');
  assert.equal(acc.body.age, '24');
  assert.equal(acc.body.gender, 'female');
  assert.equal(acc.body.address.pin, '700016');
  assert.equal(acc.body.address.landmark, 'Near Metro');
});

test('webhook marks a paid order even if the browser never came back', async () => {
  const v2 = await variant('poison-oversized-tee', 'Poison', 'L');
  const co = await shopper.call('POST', '/api/checkout', { items: [{ variantId: v2, qty: 1 }], shipping: { fullName: 'Riya Sharma', phone: '9876543210', line1: '12 Park Street', city: 'Kolkata', state: 'West Bengal', pin: '700016' } });
  const pay = await (await fetch(`${emu.base}/__razorpay/pay`, { method: 'POST', body: JSON.stringify({ order_id: co.body.razorpay.orderId }) })).json();
  const body = JSON.stringify({ event: 'payment.captured', payload: { payment: { entity: { id: pay.razorpay_payment_id, order_id: pay.razorpay_order_id } } } });
  const forged = await browser().call('POST', '/api/payments/webhook', body, { headers: { 'x-razorpay-signature': 'nope', 'x-knotily': '' } });
  assert.equal(forged.status, 403);
  const real = await browser().call('POST', '/api/payments/webhook', body, { headers: { 'x-razorpay-signature': createHmac('sha256', WEBHOOK).update(body).digest('hex'), 'x-knotily': '', origin: '' } });
  assert.equal(real.status, 200);
  assert.equal(await emu.sql(`select status from orders where id='${co.body.order_id}'`), 'paid');
});

test('forgot password: reset link, confirmation must match, new password works', async () => {
  const guest = browser();
  const r = await guest.call('POST', '/api/auth/forgot', { email: 'riya@test.in' });
  assert.equal(r.status, 200);
  const unknown = await guest.call('POST', '/api/auth/forgot', { email: 'nobody@test.in' });
  assert.equal(unknown.status, 200); // same answer
  const link = emu.mail.filter((m) => m.to === 'riya@test.in' && m.type === 'recovery').at(-1).link;
  const redirect = await fetch(link, { redirect: 'manual' });
  assert.match(redirect.headers.get('location'), /\/account\/reset#.*type=recovery/);
  const hash = new URLSearchParams(redirect.headers.get('location').split('#')[1]);
  const mismatch = await guest.call('POST', '/api/auth/reset', { access_token: hash.get('access_token'), password: 'newpass123', confirmPassword: 'newpass124' });
  assert.equal(mismatch.body.error.code, 'PASSWORD_MISMATCH');
  const ok = await guest.call('POST', '/api/auth/reset', { access_token: hash.get('access_token'), refresh_token: hash.get('refresh_token'), password: 'newpass123', confirmPassword: 'newpass123' });
  assert.equal(ok.status, 200);
  const old = await browser().call('POST', '/api/auth/login', { email: 'riya@test.in', password: 'knotily123' });
  assert.equal(old.body.error.code, 'BAD_CREDENTIALS');
  const fresh = await shopper.call('POST', '/api/auth/login', { email: 'riya@test.in', password: 'newpass123' });
  assert.equal(fresh.status, 200);
});

test('repeated wrong passwords are rate-limited', async () => {
  const b = browser();
  let last;
  for (let i = 0; i < 11; i++) last = await b.call('POST', '/api/auth/login', { email: 'riya@test.in', password: 'wrong' + i });
  assert.equal(last.status, 429);
});

const owner = browser();
test('owner area is closed to shoppers and open to the owner', async () => {
  const denied = await shopper.call('GET', '/api/admin/products');
  assert.equal(denied.status, 403);
  await signUpAndVerify(owner, 'owner@knotily.in', 'ownerpass1', 'Store Owner');
  await emu.makeOwner('owner@knotily.in');
  const list = await owner.call('GET', '/api/admin/products');
  assert.equal(list.status, 200);
  assert.equal(list.body.products.length, 16);
  const set = await owner.call('PUT', '/api/admin/settings', { owner_alert_email: 'alerts@knotily.in', reminder_alert_threshold: 10 });
  assert.equal(set.status, 200);
});

test('more than 10 shoppers waiting → owner gets one email', async () => {
  const oos = await variant('after-hours-oversized-tee', 'Latex Black', 'L');
  // 10 other shoppers already waiting
  await emu.sql(`insert into auth.users (id, email) select gen_random_uuid(), 'wait' || g || '@t.in' from generate_series(1, 10) g;
    insert into profiles (id) select id from auth.users where email like 'wait%';
    insert into restock_reminders (user_id, variant_id, product_id) select u.id, '${oos}', (select product_id from product_variants where id='${oos}') from auth.users u where u.email like 'wait%';`);
  const before = mails((m) => m.to === 'alerts@knotily.in' && /waiting/.test(m.subject)).length;
  await shopper.call('POST', '/api/reminders', { variantId: oos }); // the 11th
  const after = mails((m) => m.to === 'alerts@knotily.in' && /waiting/.test(m.subject));
  assert.equal(after.length, before + 1);
  assert.match(after.at(-1).html, /11 shoppers are waiting/);
});

test('owner restock emails every waiting shopper', async () => {
  const oos = await variant('after-hours-oversized-tee', 'Latex Black', 'M');
  const p = await owner.call('GET', `/api/admin/products/${await emu.sql(`select id from products where slug='after-hours-oversized-tee'`)}`);
  const body = {
    product: { ...p.body, category_id: p.body.category_id, price_paise: p.body.price_paise },
    colors: p.body.colors.map((c) => ({ name: c.name, hex: c.hex, ink_hex: c.ink })),
    variants: p.body.variants.map((v) => ({ color: v.color, size: v.size, stock: v.color === 'Latex Black' && v.size === 'M' ? 12 : v.stock, low_stock_threshold: v.low_stock_threshold, sku: v.sku })),
    media: [], reviews: p.body.reviews,
  };
  const r = await owner.call('POST', '/api/admin/products', body);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.restockEmails, 1);
  const m = mails((x) => x.to === 'riya@test.in' && /back in stock/.test(x.subject));
  assert.equal(m.length, 1);
  assert.match(m[0].html, /size <b>M<\/b>/);
  assert.equal(await stockOf(oos), 12);
});

test('low stock after a sale alerts the owner', async () => {
  const v = await variant('bad-idea-oversized-tee', 'Red Light', 'S'); // seeded with 2 left
  await shopper.call('PUT', '/api/cart/items', { variantId: v, qty: 1, mode: 'add' });
  const co = await shopper.call('POST', '/api/checkout', { shipping: { fullName: 'Riya Sharma', phone: '9876543210', line1: '12 Park Street', city: 'Kolkata', state: 'West Bengal', pin: '700016' } });
  const pay = await (await fetch(`${emu.base}/__razorpay/pay`, { method: 'POST', body: JSON.stringify({ order_id: co.body.razorpay.orderId }) })).json();
  await shopper.call('POST', '/api/payments/verify', { orderId: co.body.order_id, ...pay });
  const alerts = await owner.call('GET', '/api/admin/alerts');
  assert.ok(alerts.body.alerts.some((a) => a.kind === 'low_stock' && /1 left/.test(a.message)));
  assert.ok(mails((m) => m.to === 'alerts@knotily.in' && /running low|Stock/.test(m.subject + m.html)).length >= 1);
});

test('owner downloads decrypted data only after re-entering the password', async () => {
  const blocked = await owner.call('GET', '/api/admin/export?dataset=orders', undefined, { raw: true });
  assert.equal(blocked.status, 401);
  const wrong = await owner.call('POST', '/api/admin/reauth', { password: 'nope' });
  assert.equal(wrong.status, 401);
  const pass = await owner.call('POST', '/api/admin/reauth', { password: 'ownerpass1' });
  const csv = await owner.call('GET', '/api/admin/export?dataset=orders', undefined, { raw: true, headers: { 'x-export-token': pass.body.exportToken } });
  assert.equal(csv.status, 200);
  assert.match(csv.headers.get('content-disposition'), /knotily-orders-/);
  assert.match(csv.body, /Riya Sharma/);
  assert.match(csv.body, /Near Metro/);
  assert.match(csv.body, /female/);
  const cust = await owner.call('GET', '/api/admin/export?dataset=customers', undefined, { raw: true, headers: { 'x-export-token': pass.body.exportToken } });
  assert.match(cust.body, /riya@test.in/);
  assert.equal(await emu.sql(`select count(*) from audit_log where action = 'export'`), '2');
  const stolen = await shopper.call('GET', '/api/admin/export?dataset=orders', undefined, { raw: true, headers: { 'x-export-token': pass.body.exportToken } });
  assert.equal(stolen.status, 403);
});

test('owner uploads go straight to storage through a signed URL', async () => {
  const bad = await owner.call('POST', '/api/admin/uploads', { kind: 'audio', contentType: 'application/x-msdownload', size: 100 });
  assert.equal(bad.status, 400);
  const r = await owner.call('POST', '/api/admin/uploads', { kind: 'design', contentType: 'image/png', size: 4, productSlug: 'poison-oversized-tee' });
  assert.equal(r.status, 200);
  const put = await fetch(r.body.uploadUrl, { method: 'PUT', headers: { 'content-type': 'image/png' }, body: 'PNG!' });
  assert.equal(put.status, 200);
  assert.equal(await (await fetch(r.body.publicUrl)).text(), 'PNG!');
});

test('analytics events need consent and feed the dashboard', async () => {
  const none = await shopper.call('POST', '/api/events', { consent: false, events: [{ name: 'page_view', session_id: 's' }] });
  assert.equal(none.body.inserted, 0);
  const pid = await emu.sql(`select id from products where slug='poison-oversized-tee'`);
  const ok = await shopper.call('POST', '/api/events', { consent: true, events: [
    { name: 'page_view', session_id: 'sess-9', anon_id: 'anon-riya-123', path: '/' },
    { name: 'product_view', session_id: 'sess-9', anon_id: 'anon-riya-123', product_id: pid },
    { name: 'not_allowed', session_id: 'sess-9' },
    { name: 'add_to_cart', session_id: 'sess-9', product_id: "'; drop table events; --" },
  ] }, { headers: { 'user-agent': 'Mozilla/5.0 (Linux; Android 14; Pixel 8) Chrome/124 Mobile Safari/537.36' } });
  assert.equal(ok.body.inserted, 3);
  const sum = await owner.call('GET', '/api/admin/summary');
  assert.ok(sum.body.kpis.orders >= 3);
  assert.ok(sum.body.devices.some((d) => d.device === 'phone' && d.os === 'android'));
});

test('owner ships an order and the shopper is emailed', async () => {
  const packed = await owner.call('PUT', `/api/admin/orders/${paidOrderId}/status`, { status: 'packed' });
  assert.equal(packed.status, 200);
  const shipped = await owner.call('PUT', `/api/admin/orders/${paidOrderId}/status`, { status: 'shipped' });
  assert.equal(shipped.status, 200);
  assert.equal(mails((m) => m.to === 'riya@test.in' && /shipped/.test(m.subject)).length, 1);
  const skip = await owner.call('PUT', `/api/admin/orders/${paidOrderId}/status`, { status: 'paid' });
  assert.equal(skip.status, 409);
});

test('wishlist: account-only, add/remove, only live products', async () => {
  const guest = await browser().call('PUT', `/api/wishlist/${await emu.sql(`select id from products where slug='poison-oversized-tee'`)}`);
  assert.equal(guest.status, 401);
  const pid = await emu.sql(`select id from products where slug='poison-oversized-tee'`);
  const added = await shopper.call('PUT', `/api/wishlist/${pid}`);
  assert.equal(added.status, 200);
  assert.deepEqual(added.body.productIds, [pid]);
  const again = await shopper.call('PUT', `/api/wishlist/${pid}`);
  assert.equal(again.body.productIds.length, 1);
  const list = await shopper.call('GET', '/api/wishlist');
  assert.deepEqual(list.body.productIds, [pid]);
  const bogus = await shopper.call('PUT', `/api/wishlist/${randomBytes(16).toString('hex').replace(/(.{8})(.{4})(.{4})(.{4})(.{12})/, '$1-$2-$3-$4-$5')}`);
  assert.equal(bogus.status, 404);
  const gone = await shopper.call('DELETE', `/api/wishlist/${pid}`);
  assert.deepEqual(gone.body.productIds, []);
});

test('banners: owner manages them, shoppers see only active ones', async () => {
  const denied = await shopper.call('POST', '/api/admin/banners', { placement: 'hero', image_url: 'https://x.test/a.jpg' });
  assert.equal(denied.status, 403);
  const noImage = await owner.call('POST', '/api/admin/banners', { placement: 'hero', title: 'Drop 05' });
  assert.equal(noImage.body.error.field, 'image_url');
  const badLink = await owner.call('POST', '/api/admin/banners', { placement: 'hero', image_url: 'https://cdn.test/h.jpg', link_url: 'javascript:alert(1)' });
  assert.equal(badLink.body.error.field, 'link_url');
  const hero = await owner.call('POST', '/api/admin/banners', { placement: 'hero', title: 'Drop 05', subtitle: 'No strings attached', image_url: 'https://cdn.test/h.jpg', link_url: '/shop/tees', sort: 1 });
  assert.equal(hero.status, 200, JSON.stringify(hero.body));
  await owner.call('POST', '/api/admin/banners', { placement: 'announcement', title: 'Free shipping over ₹1,999' });
  await owner.call('POST', '/api/admin/banners', { placement: 'strip', title: 'Later', image_url: 'https://cdn.test/s.jpg', starts_at: new Date(Date.now() + 864e5).toISOString() });
  await owner.call('POST', '/api/admin/banners', { placement: 'tile', title: 'Hidden', image_url: 'https://cdn.test/t.jpg', is_active: false });
  const all = await owner.call('GET', '/api/admin/banners');
  assert.equal(all.body.banners.length, 4);
  const cat = await browser().call('GET', '/api/catalog');
  assert.deepEqual(cat.body.banners.map((b) => b.placement).sort(), ['announcement', 'hero']);
  const del = await owner.call('DELETE', `/api/admin/banners/${hero.body.id}`);
  assert.equal(del.status, 200);
  assert.equal((await browser().call('GET', '/api/catalog')).body.banners.length, 1);
});

test('sign out clears the session', async () => {
  const r = await shopper.call('POST', '/api/auth/logout');
  assert.equal(r.status, 200);
  const me = await shopper.call('GET', '/api/auth/me');
  assert.equal(me.body.user, null);
});
