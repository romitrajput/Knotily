// Unit tests: encryption, signatures, validation, device detection.  Run: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, createHmac } from 'node:crypto';

process.env.DATA_ENCRYPTION_KEYS = JSON.stringify({ v1: randomBytes(32).toString('base64'), v2: randomBytes(32).toString('base64') });
process.env.DATA_ENCRYPTION_KEY_ID = 'v1';
process.env.BLIND_INDEX_KEY = randomBytes(32).toString('base64');
process.env.SERVER_TOKEN_SECRET = randomBytes(32).toString('hex');
process.env.RAZORPAY_KEY_SECRET = 'rzp_secret_test';
process.env.RAZORPAY_WEBHOOK_SECRET = 'whsec_test';

const crypto = await import('../server/lib/crypto.js');
const { env } = await import('../server/env.js');
const rzp = await import('../server/lib/razorpay.js');
const v = await import('../server/lib/validate.js');
const { parseUserAgent } = await import('../server/lib/device.js');
const { toCsv } = await import('../server/http.js');

test('encrypts and decrypts strings and objects', () => {
  const t = crypto.encrypt('Riya Sharma', 'profile:u1:name');
  assert.match(t, /^v1\.[\w-]+\.[\w-]+\.[\w-]+$/);
  assert.equal(crypto.decrypt(t, 'profile:u1:name'), 'Riya Sharma');
  const addr = { line1: '12 Park Street', pin: '700016' };
  assert.deepEqual(crypto.decrypt(crypto.encrypt(addr, 'address:u1'), 'address:u1'), addr);
});

test('ciphertext reveals nothing and differs every time', () => {
  const a = crypto.encrypt('9876543210', 'profile:u1:phone');
  const b = crypto.encrypt('9876543210', 'profile:u1:phone');
  assert.notEqual(a, b);
  assert.ok(!a.includes('9876543210'));
});

test('tampered or moved ciphertext is rejected', () => {
  const t = crypto.encrypt('secret', 'profile:u1:phone');
  const parts = t.split('.');
  const ct = Buffer.from(parts[3], 'base64url');
  ct[0] ^= 1;
  assert.throws(() => crypto.decrypt([...parts.slice(0, 3), ct.toString('base64url')].join('.'), 'profile:u1:phone'));
  // same ciphertext pasted onto another user's row
  assert.throws(() => crypto.decrypt(t, 'profile:u2:phone'));
});

test('key rotation: old data still decrypts after switching keys', () => {
  const old = crypto.encrypt('hello', 'ctx');
  env.encryptionKeyId = 'v2';
  crypto._resetKeyCache();
  const fresh = crypto.encrypt('hello', 'ctx');
  assert.equal(crypto.keyIdOf(fresh), 'v2');
  assert.equal(crypto.decrypt(old, 'ctx'), 'hello');
  env.encryptionKeyId = 'v1';
  crypto._resetKeyCache();
});

test('blind index is stable, case-insensitive and keyed', () => {
  assert.equal(crypto.blindIndex('A@B.in'), crypto.blindIndex(' a@b.in '));
  assert.notEqual(crypto.blindIndex('a@b.in'), crypto.blindIndex('c@b.in'));
  assert.equal(crypto.blindIndex('a@b.in').length, 64);
});

test('export tokens expire and cannot be forged', () => {
  const t = crypto.signToken({ sub: 'u1', scope: 'export' }, 60);
  assert.equal(crypto.verifyToken(t).sub, 'u1');
  assert.equal(crypto.verifyToken(t.slice(0, -2) + 'xx'), null);
  assert.equal(crypto.verifyToken(crypto.signToken({ sub: 'u1' }, -1)), null);
});

test('Razorpay checkout and webhook signatures', () => {
  const sig = createHmac('sha256', 'rzp_secret_test').update('order_1|pay_1').digest('hex');
  assert.ok(rzp.verifyCheckoutSignature({ orderId: 'order_1', paymentId: 'pay_1', signature: sig }));
  assert.ok(!rzp.verifyCheckoutSignature({ orderId: 'order_2', paymentId: 'pay_1', signature: sig }));
  const body = '{"event":"payment.captured"}';
  assert.ok(rzp.verifyWebhookSignature(body, createHmac('sha256', 'whsec_test').update(body).digest('hex')));
  assert.ok(!rzp.verifyWebhookSignature(body + ' ', createHmac('sha256', 'whsec_test').update(body).digest('hex')));
});

test('password rules and confirmation', () => {
  assert.throws(() => v.newPassword('short1', 'short1'), /8 characters/);
  assert.throws(() => v.newPassword('allletters', 'allletters'), /letter and one number/);
  assert.throws(() => v.newPassword('goodpass1', 'goodpass2'), /do not match/);
  assert.equal(v.newPassword('goodpass1', 'goodpass1'), 'goodpass1');
});

test('shipping validation', () => {
  const ok = v.shipping({ fullName: 'Riya S', phone: '+91 98765 43210', line1: '12 Park St', city: 'Kolkata', state: 'West Bengal', pin: '700016', age: '24', gender: 'female' });
  assert.equal(ok.phone, '9876543210');
  assert.equal(ok.age, 24);
  assert.throws(() => v.shipping({ ...ok, pin: '012345' }), /PIN/);
  assert.throws(() => v.shipping({ ...ok, state: 'Atlantis' }), /state/);
  assert.equal(v.shipping({ ...ok, age: '', gender: '' }).age, null);
});

test('device detection: phone, tablet, desktop and OS', () => {
  const iphone = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 Version/17.4 Mobile/15E148 Safari/604.1';
  const pixel = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/124.0 Mobile Safari/537.36';
  const tab = 'Mozilla/5.0 (Linux; Android 13; SM-X710) AppleWebKit/537.36 Chrome/124.0 Safari/537.36';
  const ipad = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/17.4 Safari/605.1.15';
  const win = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0 Safari/537.36 Edg/124.0';
  assert.deepEqual(parseUserAgent(iphone), { device_type: 'phone', os: 'ios', browser: 'safari' });
  assert.deepEqual(parseUserAgent(pixel), { device_type: 'phone', os: 'android', browser: 'chrome' });
  assert.equal(parseUserAgent(tab).device_type, 'tablet');
  assert.deepEqual(parseUserAgent(ipad, { maxTouchPoints: 5 }), { device_type: 'tablet', os: 'ipados', browser: 'safari' });
  assert.deepEqual(parseUserAgent(win), { device_type: 'desktop', os: 'windows', browser: 'edge' });
});

test('CSV export blocks spreadsheet formula injection', () => {
  const csv = toCsv([{ name: '=HYPERLINK("x")', note: 'a,b' }]);
  assert.match(csv, /'=HYPERLINK/);
  assert.match(csv, /"a,b"/);
});
