import { route, startRouter, onNavigate } from './router.js';
import { mountHeader, setActiveNav, renderNav } from './components/header.js';
import { mountFooter, renderFooterCategories } from './components/footer.js';
import { mountCartDrawer } from './components/cartDrawer.js';
import { showConsentBanner } from './components/consentBanner.js';
import { detectDevice } from './lib/device.js';
import { startAnalytics, track } from './lib/analytics.js';
import { get } from './lib/api.js';
import { config, applyRuntimeConfig } from './config.js';
import { loadSession } from './store/session.js';
import { loadCatalog, listCategories, getProductById } from './services/catalog.js';
import { toggleWish } from './store/wishlist.js';
import { toast } from './components/toast.js';

detectDevice();
startAnalytics();

// Routes — every page is a lazily loaded chunk.
route('/', () => import('./pages/home.js'));
route('/shop', () => import('./pages/shop.js'));
route('/shop/:category', () => import('./pages/shop.js'));
route('/product/:slug', () => import('./pages/product.js'));
route('/bag', () => import('./pages/bag.js'));
route('/checkout', () => import('./pages/checkout.js'));
route('/order/:id', () => import('./pages/order.js'));
route('/account', () => import('./pages/account.js'));
route('/wishlist', () => import('./pages/wishlist.js'));
route('/account/verified', () => import('./pages/accountLink.js'), 'verified');
route('/account/reset', () => import('./pages/accountLink.js'), 'reset');
route('/privacy', () => import('./pages/legal.js'), 'privacy');
route('/terms', () => import('./pages/legal.js'), 'terms');
route('/story', () => import('./pages/story.js'));
route('/admin', () => import('./admin/admin.js'));
route('/admin/:section', () => import('./admin/admin.js'));
route('/__404', () => import('./pages/notFound.js'));

mountHeader(document.getElementById('site-header'));
mountFooter(document.getElementById('site-footer'));
mountCartDrawer(document.getElementById('cart-drawer'));

function envBanner() {
  if (config.env === 'production') return;
  const b = document.createElement('div');
  b.className = 'env-banner';
  b.setAttribute('role', 'note');
  b.innerHTML = config.env === 'testing' ? 'Testing environment<span class="hide-sm"> — test payments only, no real orders</span>' : 'Development environment';
  document.body.prepend(b);
  document.documentElement.classList.add('has-env-banner');
}

// wishlist hearts anywhere on the page
document.addEventListener('click', async (e) => {
  const b = e.target.closest('[data-wish]');
  if (!b) return;
  e.preventDefault();
  e.stopPropagation();
  const p = getProductById(b.dataset.wish);
  if (!p) return;
  try {
    const on = await toggleWish(p);
    if (on !== null) toast(on ? 'Saved to your wishlist.' : 'Removed from your wishlist.');
  } catch (err) {
    toast(err.message);
  }
});

onNavigate((path, page) => {
  setActiveNav(path);
  document.documentElement.dataset.page = page?.name || '';
  dispatchEvent(new Event('knotily:navigate'));
  track('page_view', { title: document.title });
});

// Start-up: config, session and catalogue load in parallel; pages wait for what they need.
const runtime = get('/api/config').then(applyRuntimeConfig).catch(() => {});
loadSession();
loadCatalog()
  .then(() => {
    renderFooterCategories(listCategories());
    renderNav();
  })
  .catch(() => {});

runtime.finally(() => {
  envBanner();
  startRouter(document.getElementById('main'));
  setTimeout(() => showConsentBanner(), 1200);
});
