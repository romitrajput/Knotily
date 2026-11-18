// Shopper-facing routes: catalogue, cart (with stock checks), restock reminders,
// account details, and analytics events.
import { env } from '../env.js';
import { readJson, bad } from '../http.js';
import { rpc } from '../lib/supabase.js';
import { encrypt, tryDecrypt } from '../lib/crypto.js';
import { parseUserAgent } from '../lib/device.js';
import * as v from '../lib/validate.js';
import { getSession, requireUser } from '../session.js';
import { limit } from '../ratelimit.js';
import { dispatchAlerts } from '../notify.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const idOrNull = (x) => (typeof x === 'string' && UUID.test(x) ? x : null);
const clip = (x, n) => (typeof x === 'string' ? x.slice(0, n) : null);

const EVENT_NAMES = new Set([
  'page_view', 'product_view', 'rack_turn', 'try_on_open', 'color_change', 'size_select', 'view_back', 'media_view', 'video_play',
  'audio_play', 'audio_mute', 'audio_unmute', 'add_to_cart', 'buy_now', 'remove_from_cart', 'signup_prompt', 'signup_start',
  'signup', 'login', 'logout', 'checkout_start', 'payment_open', 'payment_failed', 'purchase', 'reminder_set', 'out_of_stock_view',
  'search', 'filter', 'sort', 'lookbook_open', 'consent', 'scroll_depth', 'share',
  'wishlist_add', 'wishlist_remove', 'banner_click', 'quick_view',
]);

export const routes = [
  ['GET', '/api/config', async () => ({
    env: env.appEnv,
    paymentProvider: env.paymentProvider,
    razorpayKeyId: env.paymentProvider === 'razorpay' ? env.razorpayKeyId : null,
  })],

  ['GET', '/api/catalog', async (req, res) => {
    res.setHeader('cache-control', 'public, max-age=0, s-maxage=30, stale-while-revalidate=120');
    const [catalog, banners] = await Promise.all([rpc('catalog', {}), rpc('banners_public', {})]);
    return { ...catalog, banners };
  }],

  ['GET', '/api/catalog/:slug', async (req, res, { params }) => {
    res.setHeader('cache-control', 'public, max-age=0, s-maxage=30, stale-while-revalidate=120');
    if (!/^[a-z0-9-]{1,80}$/.test(params.slug)) throw bad('INVALID', 'Unknown product.');
    return rpc('catalog', { slug: params.slug });
  }],

  // ---------------------------------------------------------------- cart
  ['GET', '/api/cart', async (req, res) => {
    const s = await requireUser(req, res);
    return rpc('cart_get', { user_id: s.userId });
  }],

  // body: { variantId, qty, mode: 'add' | 'set' }. Stock is checked in the database.
  ['PUT', '/api/cart/items', async (req, res) => {
    const s = await requireUser(req, res);
    const b = await readJson(req);
    return rpc('cart_set', {
      user_id: s.userId,
      variant_id: v.uuid(b.variantId, 'variant'),
      qty: v.int(b.qty ?? 1, { field: 'Quantity', min: 0, max: 10 }),
      mode: b.mode === 'add' ? 'add' : 'set',
    });
  }],

  ['DELETE', '/api/cart/items/:variantId', async (req, res, { params }) => {
    const s = await requireUser(req, res);
    return rpc('cart_set', { user_id: s.userId, variant_id: v.uuid(params.variantId, 'variant'), qty: 0 });
  }],

  // ---------------------------------------------------------------- reminders
  ['POST', '/api/reminders', async (req, res) => {
    const s = await requireUser(req, res);
    await limit(req, 'reminder', 40, 3600, s.userId);
    const b = await readJson(req);
    const r = await rpc('reminder_set', { user_id: s.userId, variant_id: v.uuid(b.variantId, 'variant') });
    if (r.alert) await dispatchAlerts([r.alert]).catch((e) => console.error('[alerts]', e.message));
    return { ok: true };
  }],

  // ------------------------------------------------------------ wishlist
  ['GET', '/api/wishlist', async (req, res) => {
    const s = await requireUser(req, res);
    return rpc('wishlist_list', { user_id: s.userId });
  }],
  ['PUT', '/api/wishlist/:productId', async (req, res, { params }) => {
    const s = await requireUser(req, res);
    return rpc('wishlist_set', { user_id: s.userId, product_id: v.uuid(params.productId, 'product'), on: true });
  }],
  ['DELETE', '/api/wishlist/:productId', async (req, res, { params }) => {
    const s = await requireUser(req, res);
    return rpc('wishlist_set', { user_id: s.userId, product_id: v.uuid(params.productId, 'product'), on: false });
  }],

  ['GET', '/api/reminders', async (req, res) => {
    const s = await requireUser(req, res);
    return { reminders: await rpc('reminders_list', { user_id: s.userId }) };
  }],

  ['DELETE', '/api/reminders/:variantId', async (req, res, { params }) => {
    const s = await requireUser(req, res);
    return rpc('reminder_cancel', { user_id: s.userId, variant_id: v.uuid(params.variantId, 'variant') });
  }],

  // ---------------------------------------------------------------- account
  ['GET', '/api/account', async (req, res) => {
    const s = await requireUser(req, res);
    const p = await rpc('profile_get', { id: s.userId });
    const id = s.userId;
    return {
      email: s.email || tryDecrypt(p.enc_email, `profile:${id}:email`),
      fullName: tryDecrypt(p.enc_full_name, `profile:${id}:name`) || '',
      phone: tryDecrypt(p.enc_phone, `profile:${id}:phone`) || '',
      age: tryDecrypt(p.enc_age, `profile:${id}:age`) || '',
      gender: tryDecrypt(p.enc_gender, `profile:${id}:gender`) || '',
      address: p.address ? tryDecrypt(p.address.enc_payload, `address:${id}`) : null,
      consentAnalytics: !!p.consent_analytics,
      deletionRequested: !!p.deletion_requested_at,
      role: p.role,
    };
  }],

  ['PUT', '/api/account', async (req, res) => {
    const s = await requireUser(req, res);
    const b = await readJson(req);
    const id = s.userId;
    const patch = { id };
    if (b.fullName !== undefined) patch.enc_full_name = encrypt(v.str(b.fullName, { field: 'Full name', min: 2, max: 80, required: true }), `profile:${id}:name`);
    if (b.phone !== undefined) patch.enc_phone = b.phone ? encrypt(v.str(b.phone, { field: 'Phone', max: 20 }).replace(/\D/g, '').slice(-10), `profile:${id}:phone`) : null;
    if (b.consentAnalytics !== undefined) patch.consent_analytics = b.consentAnalytics === true;
    await rpc('profile_update', patch);
    return { ok: true };
  }],

  ['GET', '/api/account/orders', async (req, res) => {
    const s = await requireUser(req, res);
    return { orders: await rpc('account_orders', { user_id: s.userId }) };
  }],

  ['GET', '/api/account/orders/:id', async (req, res, { params }) => {
    const s = await requireUser(req, res);
    const o = await rpc('order_get', { order_id: v.uuid(params.id, 'order'), user_id: s.userId });
    const ship = tryDecrypt(o.enc_shipping, `shipping:${s.userId}`) || {};
    delete o.enc_shipping;
    return { ...o, shipping: { fullName: ship.fullName, city: ship.city, state: ship.state, pin: ship.pin } };
  }],

  // DPDP: shoppers can ask for their account and personal data to be erased.
  ['POST', '/api/account/delete-request', async (req, res) => {
    const s = await requireUser(req, res);
    await rpc('profile_update', { id: s.userId, request_deletion: true });
    return { ok: true };
  }],

  // ---------------------------------------------------------------- analytics
  // The browser only sends events after the shopper accepts analytics cookies.
  ['POST', '/api/events', async (req, res) => {
    await limit(req, 'events', 240, 60);
    const b = await readJson(req);
    if (b.consent !== true) return { inserted: 0 };
    const s = await getSession(req, res);
    const dev = parseUserAgent(req.headers['user-agent'], b.hints || {});
    const country = String(req.headers['x-vercel-ip-country'] || '').slice(0, 2) || null;
    const events = (Array.isArray(b.events) ? b.events : []).slice(0, 50)
      .filter((e) => e && EVENT_NAMES.has(e.name) && typeof e.session_id === 'string')
      .map((e) => ({
        ts: typeof e.ts === 'string' ? e.ts : undefined,
        session_id: clip(e.session_id, 64), anon_id: clip(e.anon_id, 64), user_id: s?.userId || null,
        name: e.name, path: clip(e.path, 300), product_id: idOrNull(e.product_id), variant_id: idOrNull(e.variant_id),
        props: e.props && typeof e.props === 'object' && JSON.stringify(e.props).length < 2000 ? e.props : {},
        device_type: ['phone', 'tablet', 'desktop'].includes(e.device_type) ? e.device_type : dev.device_type,
        os: clip(e.os, 24) || dev.os, browser: dev.browser,
        referrer: clip(e.referrer, 300), utm_source: clip(e.utm_source, 80), utm_medium: clip(e.utm_medium, 80), utm_campaign: clip(e.utm_campaign, 120), country,
      }));
    if (!events.length) return { inserted: 0 };
    return rpc('events_insert', { events });
  }],
];
