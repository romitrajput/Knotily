// Wishlist: saved to the shopper's account (so it follows them across devices).
// Signed-out shoppers get the same "create an account" pop-up as Buy now.
import { get, put, del } from '../lib/api.js';
import { currentUser, onSession } from './session.js';
import { track } from '../lib/analytics.js';

let ids = new Set();
const listeners = new Set();
const emit = () => listeners.forEach((fn) => fn(ids));

export const isWished = (id) => ids.has(id);
export const wishCount = () => ids.size;
export const wishIds = () => [...ids];
export function onWishlist(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export async function loadWishlist() {
  if (!currentUser()) {
    ids = new Set();
    emit();
    return ids;
  }
  try {
    const r = await get('/api/wishlist');
    ids = new Set(r.productIds);
  } catch {
    /* keep what we have */
  }
  emit();
  return ids;
}

// Returns true/false for the new state, or null if the shopper backed out of signing up.
export async function toggleWish(product) {
  if (!currentUser()) {
    const { requireAccount } = await import('../components/auth.js');
    const user = await requireAccount({
      reason: 'Create a free account to save pieces to your wishlist. It follows you to any device.',
      intent: { action: 'wish', slug: product.slug, productId: product.id },
    });
    if (!user) return null;
    await loadWishlist();
    if (ids.has(product.id)) return true;
  }
  const on = !ids.has(product.id);
  const before = new Set(ids);
  if (on) ids.add(product.id);
  else ids.delete(product.id);
  emit();
  try {
    const r = on ? await put(`/api/wishlist/${product.id}`) : await del(`/api/wishlist/${product.id}`);
    ids = new Set(r.productIds);
    emit();
    track(on ? 'wishlist_add' : 'wishlist_remove', { product_id: product.id });
    return on;
  } catch (e) {
    ids = before;
    emit();
    throw e;
  }
}

export const heartSVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20.3s-7.6-4.6-9.2-9.4C1.7 7.5 3.9 4.5 7.2 4.5c2 0 3.6 1.1 4.8 2.8 1.2-1.7 2.8-2.8 4.8-2.8 3.3 0 5.5 3 4.4 6.4-1.6 4.8-9.2 9.4-9.2 9.4z" fill="var(--heart-fill, none)" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg>';

export function heartButton(p, cls = '') {
  const on = ids.has(p.id);
  return `<button type="button" class="wish ${cls}" data-wish="${p.id}" aria-pressed="${on}" aria-label="${on ? 'Remove from' : 'Save to'} wishlist: ${p.name.replace(/"/g, '&quot;')}">${heartSVG}</button>`;
}

// keep every heart on the page in sync
onWishlist(() => {
  document.querySelectorAll('[data-wish]').forEach((b) => {
    const on = ids.has(b.dataset.wish);
    b.setAttribute('aria-pressed', String(on));
    b.setAttribute('aria-label', b.getAttribute('aria-label').replace(/^(Save to|Remove from)/, on ? 'Remove from' : 'Save to'));
  });
});
onSession(() => loadWishlist());
