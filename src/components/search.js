// Search overlay: instant results across product names, categories, colours and
// descriptions. Enter (or "See all") opens the shop filtered by the search.
import { loadCatalog, allProducts, listCategories } from '../services/catalog.js';
import { garmentImg, hydrate } from './media.js';
import { navigate } from '../router.js';
import { track } from '../lib/analytics.js';
import { icons } from './icons.js';
import { formatPrice, esc } from '../lib/util.js';

let root = null;
let lastFocus = null;

const norm = (s) => String(s || '').toLowerCase().normalize('NFKD').replace(/[^\w\s]/g, ' ');

export function searchProducts(q, list = allProducts()) {
  const words = norm(q).split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  return list
    .map((p) => {
      const name = norm(p.name);
      const hay = `${name} ${norm(p.categoryName)} ${norm(p.category)} ${p.colors.map((c) => norm(c.name)).join(' ')} ${norm(p.description)}`;
      if (!words.every((w) => hay.includes(w))) return null;
      const score = words.reduce((s, w) => s + (name.includes(w) ? 3 : 0) + (name.startsWith(w) ? 2 : 0), 0);
      return { p, score };
    })
    .filter(Boolean)
    .sort((a, b) => b.score - a.score)
    .map((x) => x.p);
}

function resultsHTML(q) {
  if (!q.trim()) {
    const cats = listCategories();
    return `<p class="srch-h">Popular</p><div class="srch-chips">
      <a href="/shop?sort=new">New in</a>${cats.map((c) => `<a href="/shop/${esc(c.id)}">${esc(c.label)}</a>`).join('')}</div>`;
  }
  const hits = searchProducts(q);
  if (!hits.length) return `<p class="srch-empty">No pieces match “${esc(q)}”. Try a colour, like <button type="button" class="link-inline" data-try="black">black</button>, or a style, like <button type="button" class="link-inline" data-try="hoodie">hoodie</button>.</p>`;
  return `<p class="srch-h">${hits.length} result${hits.length === 1 ? '' : 's'}</p>
    <ul class="srch-grid">${hits.slice(0, 8).map((p) => `<li><a href="/product/${esc(p.slug)}" class="srch-item">
      <span class="srch-img">${garmentImg(p, p.colors[0])}</span>
      <span class="srch-name">${esc(p.name)}</span><span class="srch-price">${formatPrice(p.price)}</span></a></li>`).join('')}</ul>
    ${hits.length > 8 ? `<a class="btn btn-line" href="/shop?q=${encodeURIComponent(q)}">See all ${hits.length}</a>` : ''}`;
}

export async function openSearch() {
  await loadCatalog().catch(() => {});
  if (root) return;
  lastFocus = document.activeElement;
  root = document.createElement('div');
  root.className = 'srch-root';
  root.innerHTML = `
    <div class="srch-scrim" data-close></div>
    <div class="srch" role="dialog" aria-modal="true" aria-label="Search">
      <form class="srch-bar" role="search" data-form>
        ${icons.search}
        <input type="search" name="q" placeholder="Search tees, hoodies, colours…" aria-label="Search the shop" autocomplete="off" enterkeyhint="search" />
        <button type="button" class="icon" data-close aria-label="Close search">${icons.close}</button>
      </form>
      <div class="srch-results" data-results aria-live="polite">${resultsHTML('')}</div>
    </div>`;
  document.body.appendChild(root);
  document.body.classList.add('drawer-open');
  requestAnimationFrame(() => root.classList.add('in'));
  const input = root.querySelector('input');
  const out = root.querySelector('[data-results]');
  input.focus();
  let t = 0;
  input.addEventListener('input', () => {
    out.innerHTML = resultsHTML(input.value);
    hydrate(out);
    clearTimeout(t);
    if (input.value.trim().length > 1) t = setTimeout(() => track('search', { q: input.value.trim().slice(0, 60), results: searchProducts(input.value).length }), 900);
  });
  root.querySelector('[data-form]').addEventListener('submit', (e) => {
    e.preventDefault();
    const q = input.value.trim();
    if (!q) return;
    closeSearch();
    navigate(`/shop?q=${encodeURIComponent(q)}`);
  });
  root.addEventListener('click', (e) => {
    if (e.target.closest('[data-close]')) return closeSearch();
    const tr = e.target.closest('[data-try]');
    if (tr) {
      input.value = tr.dataset.try;
      input.dispatchEvent(new Event('input'));
      return;
    }
    if (e.target.closest('a')) closeSearch(false);
  });
  root.addEventListener('keydown', (e) => e.key === 'Escape' && closeSearch());
}

export function closeSearch(restoreFocus = true) {
  if (!root) return;
  const r = root;
  root = null;
  r.classList.remove('in');
  document.body.classList.remove('drawer-open');
  setTimeout(() => r.remove(), 250);
  if (restoreFocus) lastFocus?.focus?.();
}
