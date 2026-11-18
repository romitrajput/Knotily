import { get } from '../lib/api.js';
import { loadSession } from '../store/session.js';
import { garmentImg, hydrate } from '../components/media.js';
import { getProductById, loadCatalog } from '../services/catalog.js';
import { formatPrice, esc, variantLabel } from '../lib/util.js';
import { config } from '../config.js';

export const STATUS = {
  pending_payment: 'Waiting for payment', paid: 'Confirmed', packed: 'Packed', shipped: 'Shipped', delivered: 'Delivered',
  cancelled: 'Cancelled', refunded: 'Refunded', payment_failed: 'Payment failed', expired: 'Expired',
};

export default async function order({ params, query }) {
  const user = await loadSession();
  let o = null;
  if (user) {
    await loadCatalog().catch(() => {});
    o = await get(`/api/account/orders/${encodeURIComponent(params.id)}`).catch(() => null);
  }
  if (!o) {
    return {
      name: 'order',
      title: 'Order not found',
      html: `<section class="page-narrow"><h1 class="page-title">We can't find that order</h1>
        <p>${user ? 'It isn’t on this account.' : 'Log in with the account you ordered from to see it.'} Your confirmation email has the order number; write to ${esc(config.supportEmail)} if you need help.</p>
        <a class="btn" href="${user ? '/account' : '/account?next=' + encodeURIComponent(location.pathname)}">${user ? 'Your orders' : 'Log in'}</a></section>`,
    };
  }
  const fresh = query.new === '1' && o.status === 'paid';
  return {
    name: 'order',
    title: fresh ? 'Order placed' : `Order ${o.number}`,
    html: `
    <section class="page-narrow confirm">
      <h1 class="page-title">${fresh ? 'Order placed. It’s all tied up.' : `Order ${esc(o.number)}`}</h1>
      ${fresh ? `<p class="confirm-lede">Order <strong>${esc(o.number)}</strong> is confirmed and paid. A receipt is on its way to ${esc(user.email)}, and we’ll email again when it ships.</p>
      <p>Most orders dispatch in 2–3 working days.</p>` : `<p class="confirm-lede">Status: <strong class="status status-${esc(o.status)}">${esc(STATUS[o.status] || o.status)}</strong></p>`}

      <div class="confirm-card">
        <ul class="lines lines-compact">
          ${o.items
            .map((i) => {
              const p = getProductById(i.product_id);
              const c = p?.colors.find((x) => x.name === i.color_name) || p?.colors[0];
              return `<li class="line">
                <span class="line-art">${p ? garmentImg(p, c) : ''}</span>
                <div class="line-info"><p class="line-name">${esc(i.product_name)}</p><p class="line-meta">${esc(variantLabel(i.color_name, i.size))}, qty ${i.qty}</p></div>
                <div class="line-end"><p class="line-price">${formatPrice((i.unit_price_paise * i.qty) / 100)}</p></div></li>`;
            })
            .join('')}
        </ul>
        <dl class="sum">
          <div><dt>Shipping to</dt><dd>${esc(o.shipping.fullName || '')}, ${esc(o.shipping.city || '')} ${esc(o.shipping.pin || '')}</dd></div>
          <div><dt>Subtotal</dt><dd>${formatPrice(o.subtotal_paise / 100)}</dd></div>
          <div><dt>Shipping</dt><dd>${o.shipping_paise ? formatPrice(o.shipping_paise / 100) : 'Free'}</dd></div>
          <div class="sum-total"><dt>${o.status === 'paid' || o.paid_at ? 'Paid' : 'Total'}</dt><dd>${formatPrice(o.total_paise / 100)}</dd></div>
        </dl>
      </div>
      <p class="confirm-actions"><a class="btn" href="/shop">Keep shopping</a> <a class="text-link" href="/account">All your orders</a></p>
    </section>`,
    mount(root) {
      hydrate(root);
    },
  };
}
