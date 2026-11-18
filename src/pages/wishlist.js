// Saved pieces (per account).
import { loadSession } from '../store/session.js';
import { loadWishlist, wishIds, onWishlist } from '../store/wishlist.js';
import { loadCatalog, getProductById } from '../services/catalog.js';
import { productCard } from '../components/productCard.js';
import { authPanel } from '../components/auth.js';
import { hydrate } from '../components/media.js';
import { navigate } from '../router.js';

const view = () => {
  const items = wishIds().map(getProductById).filter(Boolean);
  return items.length
    ? `<p class="shop-count">${items.length} saved piece${items.length === 1 ? '' : 's'}</p><div class="grid grid-shop">${items.map((p) => productCard(p)).join('')}</div>`
    : `<div class="empty empty-page"><p>Nothing saved yet. Tap the heart on any piece to keep it here.</p><a class="btn" href="/shop">Shop the drop</a></div>`;
};

export default async function wishlist() {
  const user = await loadSession();
  if (!user) {
    return {
      name: 'wishlist',
      title: 'Wishlist',
      html: `<section class="page-narrow auth-page"><h1 class="page-title">Wishlist</h1><p class="muted">Log in to see the pieces you've saved. Your wishlist follows you to any device.</p><div class="auth-card" data-auth-host></div></section>`,
      mount(root) {
        authPanel(root.querySelector('[data-auth-host]'), { mode: 'login', onSignedIn: () => navigate('/wishlist', { replace: true }) });
      },
    };
  }
  await Promise.all([loadCatalog(), loadWishlist()]);
  return {
    name: 'wishlist',
    title: 'Wishlist',
    html: `<div class="wrap"><h1 class="page-title">Wishlist</h1><div data-wl>${view()}</div></div>`,
    mount(root) {
      const host = root.querySelector('[data-wl]');
      hydrate(host);
      return onWishlist(() => {
        host.innerHTML = view();
        hydrate(host);
      });
    },
  };
}
