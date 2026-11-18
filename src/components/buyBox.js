// Size picker + Buy now / Remind me, shared by the rack's try-on view and the product page.
//  - sizes show live stock for the chosen colour (sold-out sizes stay tappable)
//  - signed-out shoppers get the "create an account" pop-up first
//  - in stock: the bag is updated on the server (stock re-checked there), the fold-and-bag
//    animation plays, then the shopper goes straight to checkout
//  - sold out: "Out of stock" + Remind me (emailed when the owner restocks)
import { requireAccount } from './auth.js';
import { toast } from './toast.js';
import { add, holdUpdates, releaseUpdates } from '../store/cart.js';
import { currentUser, onSession } from '../store/session.js';
import { sizesFor, variantFor, patchVariant } from '../services/catalog.js';
import { get, post } from '../lib/api.js';
import { track } from '../lib/analytics.js';
import { navigate } from '../router.js';
import { esc, $ } from '../lib/util.js';

// variant ids this shopper is already waiting on
let reminders = null;
async function loadReminders() {
  if (!currentUser()) return (reminders = new Set());
  if (reminders) return reminders;
  try {
    const r = await get('/api/reminders');
    reminders = new Set(r.reminders.map((x) => x.variant_id));
  } catch {
    reminders = new Set();
  }
  return reminders;
}
onSession(() => (reminders = null));

export function buyBoxHTML({ single = false } = {}) {
  return `
    <fieldset class="sizes" ${single ? 'hidden' : ''}>
      <legend>Size</legend>
      <div class="size-row" data-sizes></div>
    </fieldset>
    <p class="field-error" data-size-error hidden>Choose a size first.</p>
    <p class="stock-msg" data-stock-msg aria-live="polite" hidden></p>
    <button class="btn btn-block btn-lg" type="submit" data-buy>Buy now</button>`;
}

export function mountBuyBox(form, { product, color, source = 'pdp', beforeNavigate = async () => {} }) {
  let p = product;
  let c = color;
  let busy = false;
  const sizesEl = $('[data-sizes]', form);
  const msg = $('[data-stock-msg]', form);
  const err = $('[data-size-error]', form);
  const btn = $('[data-buy]', form);

  const selected = () => form.querySelector('input[name="size"]:checked')?.value || null;
  const current = () => (selected() ? variantFor(p, c.name, selected()) : null);

  function renderSizes() {
    const keep = selected();
    const list = sizesFor(p, c.name);
    const only = list.length === 1;
    form.querySelector('fieldset.sizes').hidden = only && list[0].size === 'One size';
    sizesEl.innerHTML = list
      .map(({ size, variant }) => {
        const out = !variant || variant.state === 'out';
        const checked = keep === size || (only && !keep);
        return `<label class="size ${out ? 'is-out' : ''}">
          <input type="radio" name="size" value="${esc(size)}" ${checked ? 'checked' : ''} aria-label="${esc(size)}${out ? ', out of stock' : variant.state === 'low' ? `, only ${variant.available} left` : ''}" />
          <span>${esc(size)}</span></label>`;
      })
      .join('');
    renderState();
  }

  async function renderState() {
    if (busy) return;
    const v = current();
    err.hidden = true;
    btn.classList.remove('btn-ghost', 'is-done');
    btn.disabled = false;
    if (!v) {
      const allOut = p.variants.filter((x) => x.colorId === c.id).every((x) => x.state === 'out');
      msg.hidden = !allOut;
      msg.className = 'stock-msg is-out';
      msg.textContent = allOut ? `${c.name} is out of stock in every size. Pick a size to get a reminder.` : '';
      btn.textContent = 'Buy now';
      btn.dataset.action = 'buy';
      return;
    }
    if (v.state === 'out') {
      msg.hidden = false;
      msg.className = 'stock-msg is-out';
      msg.innerHTML = `<strong>Out of stock</strong> in ${esc(c.name)}, size ${esc(v.size)}.`;
      btn.dataset.action = 'remind';
      const r = await loadReminders();
      if (current()?.id !== v.id) return;
      if (r.has(v.id)) {
        btn.textContent = 'Reminder set — we’ll email you';
        btn.classList.add('btn-ghost', 'is-done');
        btn.disabled = true;
      } else {
        btn.textContent = 'Remind me when it’s back';
        btn.classList.add('btn-ghost');
      }
      track('out_of_stock_view', { product_id: p.id, variant_id: v.id });
      return;
    }
    btn.dataset.action = 'buy';
    btn.textContent = 'Buy now';
    if (v.state === 'low') {
      msg.hidden = false;
      msg.className = 'stock-msg is-low';
      msg.textContent = `Only ${v.available} left in ${v.size}.`;
    } else {
      msg.hidden = true;
    }
  }

  form.addEventListener('change', (e) => {
    if (e.target.name !== 'size') return;
    const v = current();
    track('size_select', { product_id: p.id, variant_id: v?.id, size: e.target.value, color: c.name });
    renderState();
  });

  async function remind(v) {
    const user = await requireAccount({
      reason: 'Create a free account and we’ll email you the moment this size is back.',
      intent: { action: 'remind', slug: p.slug, color: c.name, size: v.size, variantId: v.id },
    });
    if (!user) return;
    btn.disabled = true;
    try {
      await post('/api/reminders', { variantId: v.id });
      (await loadReminders()).add(v.id);
      track('reminder_set', { product_id: p.id, variant_id: v.id });
      toast(`Done. We’ll email ${esc(user.email)} when ${esc(c.name)} in ${esc(v.size)} is back.`);
    } catch (e) {
      if (e.code === 'IN_STOCK') {
        patchVariant(v.id, { state: 'in', available: 1 });
        toast('Good news: it’s just come back in stock.');
      } else toast(esc(e.message));
    }
    renderSizes();
  }

  async function buy(v) {
    const user = await requireAccount({
      reason: 'Create a free account to buy. Your details are saved, so next time checkout takes seconds.',
      intent: { action: 'buy', slug: p.slug, color: c.name, size: v.size, variantId: v.id },
    });
    if (!user) return;
    busy = true;
    btn.disabled = true;
    btn.textContent = 'Checking stock…';
    track('buy_now', { product_id: p.id, variant_id: v.id, source });
    holdUpdates();
    try {
      await add(v.id, 1);
      track('add_to_cart', { product_id: p.id, variant_id: v.id, qty: 1, source });
    } catch (e) {
      releaseUpdates();
      busy = false;
      if (e.code === 'OUT_OF_STOCK') {
        patchVariant(v.id, { state: 'out', available: 0 });
        renderSizes();
        toast('That size just sold out. Want a reminder when it’s back?');
      } else if (e.code === 'INSUFFICIENT_STOCK') {
        renderState();
        toast('You already have the last ones of this size in your bag.', { action: { label: 'Check out', onClick: () => navigate('/checkout') } });
      } else {
        renderState();
        toast(esc(e.message));
      }
      return;
    }
    btn.textContent = 'Packing your bag…';
    try {
      await beforeNavigate({ variant: v, color: c });
    } finally {
      releaseUpdates();
      busy = false;
    }
    navigate('/checkout');
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (busy) return;
    const size = selected();
    if (!size) {
      err.hidden = false;
      form.querySelector('input[name="size"]')?.focus();
      return;
    }
    const v = current();
    if (!v) return;
    if (v.state === 'out') return remind(v);
    return buy(v);
  });

  renderSizes();
  return {
    setColor(col) {
      c = col;
      renderSizes();
    },
    setProduct(prod, col) {
      p = prod;
      c = col || prod.colors[0];
      sizesEl.innerHTML = '';
      renderSizes();
    },
    refresh: renderSizes,
    busy: () => busy,
  };
}
