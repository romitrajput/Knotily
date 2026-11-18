// Checkout and payments.
//  1. POST /api/checkout      validate + encrypt shipping, reserve stock (15 min), create the Razorpay order
//  2. Razorpay Checkout runs in the browser (UPI, cards, net banking, wallets)
//  3. POST /api/payments/verify  check Razorpay's signature, then mark paid and take the stock
//  Backup: Razorpay's webhook (payment.captured / order.paid) marks the order paid if the
//  shopper closes the tab before step 3.
import { env, isProd } from '../env.js';
import { readJson, readRaw, bad, forbidden, ApiError } from '../http.js';
import { rpc } from '../lib/supabase.js';
import { encrypt } from '../lib/crypto.js';
import { parseUserAgent } from '../lib/device.js';
import * as razorpay from '../lib/razorpay.js';
import * as v from '../lib/validate.js';
import { requireUser } from '../session.js';
import { limit } from '../ratelimit.js';
import { afterPaid } from '../notify.js';

async function finalisePaid(result) {
  if (result.status === 'needs_refund') {
    // the shopper paid after their reservation expired and the stock was gone
    const o = await rpc('order_get', { order_id: result.order_id });
    if (o.provider_payment_id && env.paymentProvider === 'razorpay') await razorpay.refund(o.provider_payment_id).catch((e) => console.error('[refund]', e.message));
    throw new ApiError(409, 'SOLD_OUT_REFUNDED', 'Sorry, the last one sold while you were paying. Your payment has been refunded in full.');
  }
  await afterPaid(result).catch((e) => console.error('[afterPaid]', e.message));
  return { orderId: result.order_id, number: result.number, status: result.status };
}

export const routes = [
  ['POST', '/api/checkout', async (req, res) => {
    const s = await requireUser(req, res);
    await limit(req, 'checkout', 30, 3600, s.userId);
    const b = await readJson(req);
    const ship = v.shipping(b.shipping || {});
    const items = Array.isArray(b.items) && b.items.length
      ? b.items.slice(0, 20).map((i) => ({ variant_id: v.uuid(i.variantId, 'variant'), qty: v.int(i.qty ?? 1, { field: 'Quantity', min: 1, max: 10 }) }))
      : null;
    const uid = s.userId;
    const shippingRecord = { ...ship, email: s.email };

    // Save the details on the profile (encrypted) so the next checkout is pre-filled.
    await rpc('profile_update', {
      id: uid,
      enc_full_name: encrypt(ship.fullName, `profile:${uid}:name`),
      enc_phone: encrypt(ship.phone, `profile:${uid}:phone`),
      ...(ship.age !== null ? { enc_age: encrypt(String(ship.age), `profile:${uid}:age`) } : {}),
      ...(ship.gender ? { enc_gender: encrypt(ship.gender, `profile:${uid}:gender`) } : {}),
      ...(b.saveAddress !== false ? { enc_address: encrypt(shippingRecord, `address:${uid}`), ship_state: ship.state } : {}),
    });

    const dev = parseUserAgent(req.headers['user-agent'], b.hints || {});
    const order = await rpc('order_create', {
      user_id: uid,
      items,
      enc_shipping: encrypt(shippingRecord, `shipping:${uid}`),
      ship_state: ship.state,
      provider: env.paymentProvider,
      session_id: typeof b.sessionId === 'string' ? b.sessionId.slice(0, 64) : null,
      ...dev,
    });

    if (env.paymentProvider === 'mock') {
      return { ...order, provider: 'mock' };
    }
    try {
      const rzp = await razorpay.createOrder({ amountPaise: order.total_paise, receipt: order.number, notes: { order_id: order.order_id } });
      await rpc('order_set_provider', { order_id: order.order_id, provider_order_id: rzp.id });
      return {
        ...order,
        provider: 'razorpay',
        razorpay: { keyId: env.razorpayKeyId, orderId: rzp.id, amount: rzp.amount, currency: rzp.currency, prefill: { name: ship.fullName, email: s.email, contact: ship.phone } },
      };
    } catch (e) {
      await rpc('order_fail', { order_id: order.order_id }).catch(() => {});
      throw e;
    }
  }],

  ['POST', '/api/payments/verify', async (req, res) => {
    const s = await requireUser(req, res);
    const b = await readJson(req);
    const orderId = v.uuid(b.orderId, 'order');
    const o = await rpc('order_get', { order_id: orderId, user_id: s.userId });
    if (!o.provider_order_id || o.provider_order_id !== b.razorpay_order_id) throw bad('PAYMENT_MISMATCH', 'Payment does not match this order.');
    if (!razorpay.verifyCheckoutSignature({ orderId: b.razorpay_order_id, paymentId: b.razorpay_payment_id, signature: b.razorpay_signature })) {
      throw bad('BAD_SIGNATURE', 'We could not confirm this payment. If money left your account, it will be refunded automatically.');
    }
    // double-check with Razorpay that the money actually arrived for the right amount
    const pay = await razorpay.fetchPayment(b.razorpay_payment_id);
    if (pay.order_id !== o.provider_order_id || pay.amount !== o.total_paise || !['captured', 'authorized'].includes(pay.status)) {
      throw bad('PAYMENT_NOT_CAPTURED', 'Payment is not complete yet. If money left your account, it will be refunded automatically.');
    }
    const result = await rpc('order_mark_paid', { order_id: orderId, provider_payment_id: b.razorpay_payment_id });
    return finalisePaid(result);
  }],

  // The shopper closed Razorpay or the payment failed: release the reserved stock now.
  ['POST', '/api/payments/cancel', async (req, res) => {
    const s = await requireUser(req, res);
    const b = await readJson(req);
    const orderId = v.uuid(b.orderId, 'order');
    await rpc('order_get', { order_id: orderId, user_id: s.userId });
    return rpc('order_fail', { order_id: orderId });
  }],

  // Test mode without Razorpay keys (local development and automated tests only).
  ['POST', '/api/payments/mock-complete', async (req, res) => {
    if (isProd || env.paymentProvider !== 'mock') throw forbidden('NOT_AVAILABLE', 'Not available.');
    const s = await requireUser(req, res);
    const b = await readJson(req);
    const orderId = v.uuid(b.orderId, 'order');
    await rpc('order_get', { order_id: orderId, user_id: s.userId });
    if (b.outcome === 'failure') return rpc('order_fail', { order_id: orderId });
    const result = await rpc('order_mark_paid', { order_id: orderId, provider_payment_id: `mock_${Date.now()}` });
    return finalisePaid(result);
  }],

  // Razorpay → us. Authenticated by the webhook signature, not by cookies.
  ['POST', '/api/payments/webhook', async (req) => {
    const raw = await readRaw(req);
    if (!razorpay.verifyWebhookSignature(raw, req.headers['x-razorpay-signature'])) throw forbidden('BAD_SIGNATURE', 'Invalid signature.');
    const evt = JSON.parse(raw);
    if (evt.event === 'payment.captured' || evt.event === 'order.paid') {
      const pay = evt.payload?.payment?.entity;
      if (pay?.order_id) {
        const result = await rpc('order_mark_paid', { provider_order_id: pay.order_id, provider_payment_id: pay.id }).catch((e) => {
          if (e.code === 'NOT_FOUND') return null; // not one of ours
          throw e;
        });
        if (result) await finalisePaid(result).catch(() => {});
      }
    }
    return { ok: true };
  }, { csrf: false }],

  ['GET', '/api/cron/release-reservations', async (req) => {
    if (!env.cronSecret || req.headers.authorization !== `Bearer ${env.cronSecret}`) throw forbidden();
    return rpc('release_expired_reservations', {});
  }],
];
