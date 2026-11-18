// Tiny History-API router.
// A page module exports `default async (ctx) => ({ html, title, description, mount(root) })`.
// `mount` may return a cleanup function, called before the next page renders
// (used to dispose the WebGL hero, observers and listeners).
import { setMeta } from './lib/util.js';

const routes = [];
let cleanup = null;
let outlet = null;
let navId = 0;
const afterHooks = [];

export function route(pattern, loader, exportName) {
  const keys = [];
  const rx = new RegExp(
    '^' +
      pattern
        .replace(/\/$/, '')
        .replace(/:(\w+)/g, (_, k) => (keys.push(k), '([^/]+)')) +
      '/?$'
  );
  routes.push({ pattern, rx, keys, loader, exportName });
}

export function onNavigate(fn) {
  afterHooks.push(fn);
}

export function navigate(to, { replace = false, keepScroll = false } = {}) {
  const url = new URL(to, location.origin);
  if (url.origin !== location.origin) return (location.href = to);
  // same address: only re-render when asked to replace (e.g. after logging in on that page)
  if (url.pathname + url.search === location.pathname + location.search && !url.hash && !replace) return;
  history[replace ? 'replaceState' : 'pushState']({}, '', url.pathname + url.search + url.hash);
  render({ keepScroll });
}

function match(pathname) {
  for (const r of routes) {
    const m = pathname.match(r.rx);
    if (m) {
      const params = {};
      r.keys.forEach((k, i) => (params[k] = decodeURIComponent(m[i + 1])));
      return { r, params };
    }
  }
  return null;
}

async function render({ keepScroll = false } = {}) {
  const id = ++navId;
  const path = location.pathname.replace(/\/+$/, '') || '/';
  const found = match(path) || match('/__404');
  const query = Object.fromEntries(new URLSearchParams(location.search));

  let page;
  try {
    const mod = await found.r.loader();
    page = await (mod[found.r.exportName || 'default'] || mod.default)({ params: found.params, query, path });
  } catch (e) {
    console.error('[knotily] page failed', e);
    page = {
      name: 'error',
      title: 'Something went wrong',
      html: `<section class="page-narrow"><h1 class="page-title">We couldn’t load this page</h1>
        <p>${e?.code === 'NETWORK' ? 'Check your internet connection.' : 'Something went wrong on our side.'} Please try again.</p>
        <a class="btn" href="${location.pathname + location.search}" data-external>Try again</a></section>`,
    };
  }
  if (id !== navId) return; // a newer navigation won

  if (typeof cleanup === 'function') cleanup();
  cleanup = null;

  outlet.innerHTML = page.html;
  outlet.dataset.page = page.name || '';
  setMeta({ title: page.title, description: page.description });
  if (page.mount) cleanup = page.mount(outlet) || null;

  if (keepScroll) {
    /* filter/sort change: stay where the shopper is */
  } else if (location.hash) {
    document.getElementById(location.hash.slice(1))?.scrollIntoView();
  } else {
    window.scrollTo({ top: 0, behavior: 'instant' });
  }
  // Move focus for screen readers without scrolling.
  outlet.focus({ preventScroll: true });
  afterHooks.forEach((fn) => fn(path, page));
}

export function startRouter(el) {
  outlet = el;
  document.addEventListener('click', (e) => {
    const a = e.target.closest('a[href]');
    if (!a || e.defaultPrevented || e.button !== 0) return;
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    if (a.target === '_blank' || a.hasAttribute('download') || a.dataset.external != null) return;
    const href = a.getAttribute('href');
    if (!href.startsWith('/')) return;
    e.preventDefault();
    navigate(href);
  });
  window.addEventListener('popstate', () => render());
  return render();
}
