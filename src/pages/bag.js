import { snapshot, subscribe, refresh } from '../store/cart.js';
import { loadSession, currentUser } from '../store/session.js';
import { lineItemsHTML, shippingMeterHTML, bindLineControls } from '../components/cartDrawer.js';
import { formatPrice, $ } from '../lib/util.js';
import { hydrate } from '../components/media.js';

function view(s) {
  if (!currentUser()) {
    return `<div class="empty empty-page"><p>Log in to see your bag. It’s saved to your account.</p><a class="btn" href="/account?next=/bag">Log in</a></div>`;
  }
  if (!s.items.length) {
    return `<div class="empty empty-page">
      <p>Your bag is empty. Start with something you can tie.</p>
      <a class="btn" href="/shop">Shop the drop</a></div>`;
  }
  return `
    <div class="bag-layout">
      <div>${shippingMeterHTML(s)}<ul class="lines lines-page">${lineItemsHTML(s)}</ul></div>
      <aside class="summary" aria-label="Order summary">
        <h2>Summary</h2>
        <dl class="sum">
          ${s.mrp > s.subtotal ? `<div><dt>You save</dt><dd>${formatPrice(s.mrp - s.subtotal)}</dd></div>` : ''}
          <div><dt>Subtotal</dt><dd>${formatPrice(s.subtotal)}</dd></div>
          <div><dt>Shipping</dt><dd>${s.shipping ? formatPrice(s.shipping) : 'Free'}</dd></div>
          <div class="sum-total"><dt>Total</dt><dd>${formatPrice(s.total)}</dd></div>
        </dl>
        ${s.hasProblems ? '<p class="line-problem">Fix the items marked in your bag to check out.</p>' : ''}
        <a class="btn btn-block btn-lg" href="/checkout" ${s.hasProblems ? 'aria-disabled="true"' : ''}>Check out</a>
        <a class="link-btn center" href="/shop">Keep shopping</a>
      </aside>
    </div>`;
}

export default async function bag() {
  await loadSession();
  const s = await refresh().catch(() => snapshot());
  return {
    name: 'bag',
    title: 'Your bag',
    html: `<section class="page-narrow"><h1 class="page-title">Your bag</h1><div data-bag>${view(s)}</div></section>`,
    mount(root) {
      const host = $('[data-bag]', root);
      bindLineControls(host);
      hydrate(host);
      host.addEventListener('click', (e) => {
        if (e.target.closest('[aria-disabled="true"]')) e.preventDefault();
      });
      return subscribe((next) => {
        host.innerHTML = view(next);
        hydrate(host);
      });
    },
  };
}
