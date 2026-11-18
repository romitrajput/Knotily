// Owner dashboard shell: /admin/:section. Only accounts with the owner role get in
// (the API enforces this on every call; this page just shows the right screen).
import { loadSession } from '../store/session.js';
import { authPanel } from '../components/auth.js';
import { get } from '../lib/api.js';
import { navigate } from '../router.js';
import { esc } from './ui.js';

const NAV = [
  ['', 'Overview'], ['products', 'Products'], ['inventory', 'Inventory'], ['orders', 'Orders'], ['homepage', 'Homepage'],
  ['categories', 'Categories'], ['alerts', 'Alerts'], ['settings', 'Settings'], ['export', 'Download data'],
];

async function unread() {
  try {
    const { alerts } = await get('/api/admin/alerts?unread=1');
    return alerts.length;
  } catch {
    return 0;
  }
}

export default async function admin({ params, query }) {
  const user = await loadSession();
  if (!user) {
    return {
      name: 'admin',
      title: 'Owner log in',
      html: `<section class="page-narrow auth-page"><div class="auth-card" data-auth-host></div></section>`,
      mount(root) {
        authPanel(root.querySelector('[data-auth-host]'), { mode: 'login', onSignedIn: () => navigate(location.pathname + location.search, { replace: true }) });
      },
    };
  }
  if (user.role !== 'owner') {
    return {
      name: 'admin',
      title: 'Owner area',
      html: `<section class="page-narrow"><h1 class="page-title">Owner area</h1><p>This part of the site is for the store owner. You’re logged in as ${esc(user.email)}.</p><a class="btn" href="/">Back to the shop</a></section>`,
    };
  }

  const section = NAV.some(([k]) => k === (params.section || '')) ? params.section || '' : null;
  if (section === null) return (await import('../pages/notFound.js')).default();
  const count = await unread();

  return {
    name: 'admin',
    title: `Owner · ${NAV.find(([k]) => k === section)[1]}`,
    html: `
      <div class="adm">
        <nav class="adm-nav" aria-label="Owner dashboard">
          <p class="adm-who">Owner<br><small>${esc(user.email)}</small></p>
          <ul>${NAV.map(([k, l]) => `<li><a href="/admin${k ? `/${k}` : ''}" ${k === section ? 'aria-current="page"' : ''}>${l}${k === 'alerts' && count ? ` <span class="badge" data-alert-count>${count}</span>` : ''}</a></li>`).join('')}</ul>
          <a class="adm-back" href="/">← View shop</a>
        </nav>
        <div class="adm-main" data-adm-main><p class="adm-muted">Loading…</p></div>
      </div>`,
    mount(root) {
      const main = root.querySelector('[data-adm-main]');
      let cleanup = null;
      const show = async () => {
        try {
          if (section === '') await (await import('./overview.js')).render(main, { query });
          else if (section === 'products') {
            const m = await import('./products.js');
            if (query.edit) cleanup = await m.renderEditor(main, { id: query.edit });
            else await m.renderList(main);
          } else if (section === 'inventory') await (await import('./inventory.js')).render(main, { query });
          else if (section === 'orders') await (await import('./orders.js')).render(main, { query });
          else if (section === 'homepage') await (await import('./banners.js')).render(main);
          else {
            const m = await import('./store.js');
            await { categories: m.categories, alerts: m.alerts, settings: m.settings, export: m.exportData }[section](main, { query });
          }
        } catch (e) {
          main.innerHTML = `<p class="adm-flash adm-flash-error" role="alert">${esc(e.message || 'Something went wrong.')}</p>`;
        }
      };
      show();
      const onAlerts = () => root.querySelector('[data-alert-count]')?.remove();
      document.addEventListener('knotily:alerts', onAlerts);
      return () => {
        document.removeEventListener('knotily:alerts', onAlerts);
        if (typeof cleanup === 'function') cleanup();
      };
    },
  };
}
