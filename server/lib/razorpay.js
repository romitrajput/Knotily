// Razorpay over its REST API (no SDK). Test keys (rzp_test_…) in the Testing
// environment cost nothing and move no money; live keys (rzp_live_…) in Production.
import { createHmac } from 'node:crypto';
import { env } from '../env.js';
import { ApiError } from '../http.js';
import { safeEqual } from './crypto.js';

function authHeader() {
  return 'Basic ' + Buffer.from(`${env.razorpayKeyId}:${env.razorpayKeySecret}`).toString('base64');
}

async function call(path, { method = 'GET', body } = {}) {
  const res = await fetch(`${env.razorpayApiBase}${path}`, {
    method,
    headers: { authorization: authHeader(), 'content-type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    console.error('[razorpay]', path, res.status, data?.error?.code);
    throw new ApiError(502, 'PAYMENT_GATEWAY', 'The payment service is not responding. Please try again.');
  }
  return data;
}

export function createOrder({ amountPaise, receipt, notes }) {
  return call('/v1/orders', { method: 'POST', body: { amount: amountPaise, currency: 'INR', receipt, notes } });
}

export const fetchPayment = (paymentId) => call(`/v1/payments/${encodeURIComponent(paymentId)}`);

export function refund(paymentId, amountPaise) {
  return call(`/v1/payments/${encodeURIComponent(paymentId)}/refund`, { method: 'POST', body: amountPaise ? { amount: amountPaise } : {} });
}

// Signature Razorpay Checkout returns to the browser: HMAC_SHA256(order_id|payment_id, key_secret)
export function verifyCheckoutSignature({ orderId, paymentId, signature }) {
  if (!orderId || !paymentId || !signature) return false;
  const expect = createHmac('sha256', env.razorpayKeySecret).update(`${orderId}|${paymentId}`).digest('hex');
  return safeEqual(expect, signature);
}

// Webhook signature: HMAC_SHA256(raw request body, webhook secret)
export function verifyWebhookSignature(rawBody, signature) {
  if (!env.razorpayWebhookSecret || !signature) return false;
  const expect = createHmac('sha256', env.razorpayWebhookSecret).update(rawBody).digest('hex');
  return safeEqual(expect, signature);
}
