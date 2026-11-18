import { subscribe, snapshot, setQty, remove } from '../store/cart.js';
import { currentUser } from '../store/session.js';
import { toast } from './toast.js';
import { track } from '../lib/analytics.js';
import { garmentImg, hydrate } from './media.js';
import { formatPrice, esc, variantLabel, $ } from '../lib/util.js';
import { config } from '../config.js';

let root, panel, lastFocus;

export function lineItemsHTML(s, { compact = false } = {}) {
  return s.items
    .map(
      (i) => `
      <li class="line" data-key="${esc(i.key)}">
        <a class="line-art" href="/product/${i.product.slug}?color=${encodeURIComponent(i.colorObj.name)}" tabindex="-1" aria-hidden="true">
          ${garmentImg(i.product, i.colorObj)}
        </a>
        <div class="line-info">
          <a class="line-name" href="/product/${i.product.slug}?color=${encodeURIComponent(i.colorObj.name)}">${esc(i.product.name)}</a>
          <p class="line-meta">${esc(variantLabel(i.colorObj.name, i.size))}</p>
          ${problemHTML(i)}
          ${
            compact
              ? `<p class="line-meta">Qty ${i.qty}</p>`
              : `<div class="qty" role="group" aria-label="Quantity for ${esc(i.product.name)}">
                  <button type="button" data-dec aria-label="Remove one">−</button>
                  <output aria-live="polite">${i.qty}</output>
                  <button type="button" data-inc aria-label="Add one" ${i.qty >= 10 || i.qty >= i.available ? 'disabled' : ''}>+</button>
                </div>`
          }
        </div>
        <div class="line-end">
          <p class="line-price">${i.unitMrp > i.unit ? `<s>${formatPrice(i.unitMrp * i.qty)}</s> ` : ''}${formatPrice(i.lineTotal)}</p>
          ${compact ? '' : `<button type="button" class="link-btn" data-remove>Remove</button>`}
        </div>
      </li>`
    )
    .join('');
}

export function shippingMeterHTML(s) {
  const pct = Math.min(100, Math.round((s.subtotal / config.freeShippingThreshold) * 100));
  const msg =
    s.toFreeShipping > 0
      ? `Add ${formatPrice(s.toFreeShipping)} more for free shipping.`
      : 'Free shipping unlocked.';
  return `<div class="ship-meter"><p>${msg}</p><div class="meter" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${pct}" aria-label="Progress to free shipping"><span style="width:${pct}%"></span></div></div>`;
}

function problemHTML(i) {
  if (i.problem === 'out_of_stock') return `<p class="line-problem">Sold out since you added it. Remove it to check out.</p>`;
  if (i.problem === 'unavailable') return `<p class="line-problem">No longer available. Remove it to check out.</p>`;
  if (i.problem === 'insufficient_stock') return `<p class="line-problem">Only ${i.available} left. Lower the quantity to check out.</p>`;
  return '';
}

export function bindLineControls(container) {
  container.addEventListener('click', async (e) => {
    const line = e.target.closest('.line');
    if (!line) return;
    const key = line.dataset.key;
    const current = snapshot().items.find((i) => i.key === key);
    if (!current) return;
    const btn = e.target.closest('button');
    if (!btn || btn.disabled) return;
    try {
      line.classList.add('is-busy');
      if (btn.matches('[data-inc]')) await setQty(key, current.qty + 1);
      else if (btn.matches('[data-dec]')) {
        await setQty(key, current.qty - 1);
        if (current.qty - 1 <= 0) track('remove_from_cart', { product_id: current.product.id, variant_id: key });
      } else if (btn.matches('[data-remove]')) {
        await remove(key);
        track('remove_from_cart', { product_id: current.product.id, variant_id: key });
      }
    } catch (err) {
      toast(esc(err.code === 'INSUFFICIENT_STOCK' ? 'That’s all we have in this size right now.' : err.message));
    } finally {
      line.classList.remove('is-busy');
    }
  });
}

function render(s) {
  const body = $('[data-cart-body]', root);
  const foot = $('[data-cart-foot]', root);
  $('[data-cart-title]', root).textContent = s.count ? `Your bag (${s.count})` : 'Your bag';
  if (!s.items.length) {
    body.innerHTML = currentUser()
      ? `<div class="empty"><p>Your bag is empty.</p><a class="btn" href="/shop" data-close>Shop ${config.currentDrop}</a></div>`
      : `<div class="empty"><p>Log in to see your bag. It’s saved to your account, so it follows you across devices.</p><a class="btn" href="/account" data-close>Log in</a></div>`;
    foot.hidden = true;
    return;
  }
  body.innerHTML = `${shippingMeterHTML(s)}<ul class="lines">${lineItemsHTML(s)}</ul>`;
  hydrate(body);
  foot.hidden = false;
  foot.innerHTML = `
    <dl class="sum">
      <div><dt>Subtotal</dt><dd>${formatPrice(s.subtotal)}</dd></div>
      <div><dt>Shipping</dt><dd>${s.shipping ? formatPrice(s.shipping) : 'Free'}</dd></div>
    </dl>
    ${s.hasProblems ? '<p class="line-problem">Fix the items marked above to check out.</p>' : ''}
    <a class="btn btn-block" href="/checkout" data-close ${s.hasProblems ? 'aria-disabled="true"' : ''}><span>Check out</span><span class="btn-price">${formatPrice(s.total)}</span></a>
    <a class="link-btn center" href="/bag" data-close>View full bag</a>`;
}

export function mountCartDrawer(el) {
  root = el;
  el.innerHTML = `
    <div class="drawer-scrim" data-close-scrim hidden></div>
    <aside class="drawer" role="dialog" aria-modal="true" aria-labelledby="cart-title" aria-hidden="true" inert>
      <div class="drawer-head">
        <h2 id="cart-title" data-cart-title>Your bag</h2>
        <button type="button" class="icon-btn" data-close aria-label="Close bag">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>
        </button>
      </div>
      <div class="drawer-body" data-cart-body></div>
      <div class="drawer-foot" data-cart-foot></div>
    </aside>`;
  panel = $('.drawer', el);

  el.addEventListener('click', (e) => {
    if (e.target.closest('[aria-disabled="true"]')) return e.preventDefault();
    if (e.target.closest('[data-close]') || e.target.matches('[data-close-scrim]')) closeCart();
  });
  document.addEventListener('keydown', (e) => {
    if (!isOpen()) return;
    if (e.key === 'Escape') closeCart();
    if (e.key === 'Tab') trapFocus(e);
  });
  bindLineControls($('[data-cart-body]', el));
  render(snapshot());
  subscribe(render);
}

const isOpen = () => root?.classList.contains('open');

export function openCart() {
  if (!root || isOpen()) return;
  import('../store/cart.js').then((m) => m.refresh().catch(() => {}));
  lastFocus = document.activeElement;
  $('[data-close-scrim]', root).hidden = false;
  panel.removeAttribute('inert');
  panel.setAttribute('aria-hidden', 'false');
  requestAnimationFrame(() => root.classList.add('open'));
  document.body.classList.add('drawer-open');
  setTimeout(() => $('[data-close]', panel)?.focus(), 60);
}

export function closeCart() {
  if (!isOpen()) return;
  root.classList.remove('open');
  panel.setAttribute('inert', '');
  panel.setAttribute('aria-hidden', 'true');
  document.body.classList.remove('drawer-open');
  setTimeout(() => ($('[data-close-scrim]', root).hidden = true), 300);
  lastFocus?.focus?.();
}

function trapFocus(e) {
  const f = panel.querySelectorAll('a[href], button:not([disabled]), input, select');
  if (!f.length) return;
  const first = f[0];
  const last = f[f.length - 1];
  if (e.shiftKey && document.activeElement === first) (e.preventDefault(), last.focus());
  else if (!e.shiftKey && document.activeElement === last) (e.preventDefault(), first.focus());
}
