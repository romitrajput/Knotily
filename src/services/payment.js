// Runs the payment for an order the server has already created (POST /api/checkout).
//  razorpay: opens Razorpay Checkout (UPI, cards, net banking, wallets), then asks the
//            server to verify the signature and the amount with Razorpay before the order
//            is marked paid. With rzp_test_ keys no real money moves (Testing environment).
//  mock:     local development without keys: a "test payment" sheet, no money moves.
import { post } from '../lib/api.js';
import { config } from '../config.js';
import { track } from '../lib/analytics.js';
import { esc } from '../lib/util.js';

const RZP_SRC = 'https://checkout.razorpay.com/v1/checkout.js';

function loadScript(src) {
  return new Promise((res, rej) => {
    if (window.Razorpay) return res();
    const existing = document.querySelector(`script[src="${src}"]`);
    if (existing) return existing.addEventListener('load', res), existing.addEventListener('error', rej);
    const s = Object.assign(document.createElement('script'), { src, async: true, onload: res, onerror: rej });
    document.head.appendChild(s);
  });
}

// Resolves { status: 'paid', orderId } or { status: 'cancelled' | 'failed', message }
export async function payOrder(order) {
  track('payment_open', { provider: order.provider, amount: order.total_paise / 100 });
  const result = order.provider === 'razorpay' ? await razorpay(order) : await mock(order);
  if (result.status !== 'paid') {
    await post('/api/payments/cancel', { orderId: order.order_id }).catch(() => {});
    track('payment_failed', { status: result.status });
  } else {
    track('purchase', { order_id: result.orderId, value: order.total_paise / 100, items: order.items?.length });
  }
  return result;
}

async function verify(order, resp) {
  try {
    const r = await post('/api/payments/verify', { orderId: order.order_id, ...resp });
    return { status: 'paid', orderId: r.orderId, number: r.number };
  } catch (e) {
    return { status: 'failed', message: e.message, code: e.code };
  }
}

async function razorpay(order) {
  try {
    await loadScript(RZP_SRC);
  } catch {
    return { status: 'failed', message: 'The payment window could not load. Check your connection or switch off any ad blocker, then try again.' };
  }
  const o = order.razorpay;
  return new Promise((resolve) => {
    let settled = false;
    const done = (r) => {
      if (!settled) (settled = true), resolve(r);
    };
    const rzp = new window.Razorpay({
      key: o.keyId || config.razorpayKeyId,
      order_id: o.orderId,
      amount: o.amount,
      currency: o.currency || 'INR',
      name: 'Knot’ily',
      description: `Order ${order.number}`,
      prefill: o.prefill,
      notes: { order: order.number },
      theme: { color: '#14219E' },
      retry: { enabled: true, max_count: 3 },
      handler: async (resp) => done(await verify(order, resp)),
      modal: {
        confirm_close: true,
        ondismiss: () => done({ status: 'cancelled', message: 'Payment window closed. Nothing was charged and your bag is saved.' }),
      },
    });
    rzp.on('payment.failed', (r) => track('payment_failed', { reason: r?.error?.reason || 'unknown' }));
    rzp.open();
  });
}

// Local-only stand-in for Razorpay (PAYMENT_PROVIDER=mock). The server refuses this in production.
function mock(order) {
  return new Promise((resolve) => {
    const wrap = document.createElement('div');
    wrap.className = 'modal-root in';
    wrap.innerHTML = `
      <div class="modal-scrim"></div>
      <div class="modal mock-pay" role="dialog" aria-modal="true" aria-labelledby="mp-title">
        <p class="eyebrow">Test payment · no money moves</p>
        <h2 id="mp-title" class="auth-title">Pay ₹${esc((order.total_paise / 100).toLocaleString('en-IN'))}</h2>
        <p class="auth-reason">Order ${esc(order.number)}. This stands in for Razorpay on your computer. Choose what happens:</p>
        <button type="button" class="btn btn-block btn-lg" data-outcome="success">Payment succeeds</button>
        <button type="button" class="btn btn-ghost btn-block" data-outcome="failure">Payment fails</button>
        <button type="button" class="link-btn center" data-outcome="cancel">Close without paying</button>
      </div>`;
    document.body.appendChild(wrap);
    wrap.querySelector('[data-outcome="success"]').focus();
    wrap.addEventListener('click', async (e) => {
      const b = e.target.closest('[data-outcome]');
      if (!b) return;
      wrap.querySelectorAll('button').forEach((x) => (x.disabled = true));
      const outcome = b.dataset.outcome;
      let r;
      if (outcome === 'cancel') r = { status: 'cancelled', message: 'Payment window closed. Nothing was charged and your bag is saved.' };
      else if (outcome === 'failure') {
        await post('/api/payments/mock-complete', { orderId: order.order_id, outcome: 'failure' }).catch(() => {});
        r = { status: 'failed', message: 'The test payment failed. Nothing was charged.' };
      } else {
        try {
          const x = await post('/api/payments/mock-complete', { orderId: order.order_id, outcome: 'success' });
          r = { status: 'paid', orderId: x.orderId, number: x.number };
        } catch (err) {
          r = { status: 'failed', message: err.message };
        }
      }
      wrap.remove();
      resolve(r);
    });
  });
}
