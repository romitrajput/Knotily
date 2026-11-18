// Shop / collection page: filters (category, colour, size, availability, sale),
// sort, search results (?q=), all in the address bar so filtered views can be shared.
import { listProducts, listCategories, getCategory, loadCatalog } from '../services/catalog.js';
import { productCard } from '../components/productCard.js';
import { searchProducts } from '../components/search.js';
import { hydrate } from '../components/media.js';
import { icons } from '../components/icons.js';
import { track } from '../lib/analytics.js';
import { esc, $ } from '../lib/util.js';

const SORTS = [['featured', 'Featured'], ['new', 'Newest'], ['price-asc', 'Price: low to high'], ['price-desc', 'Price: high to low']];
const SIZE_ORDER = ['XXS', 'XS', 'S', 'M', 'L', 'XL', 'XXL', '3XL', 'One size'];

function readState(query) {
  const list = (k) => (query[k] ? String(query[k]).split(',').filter(Boolean) : []);
  return {
    q: query.q || '',
    colors: list('color'),
    sizes: list('size'),
    stock: query.stock === '1',
    sale: query.sale === '1',
    sort: SORTS.some(([v]) => v === query.sort) ? query.sort : 'featured',
  };
}

function apply(items, st) {
  let out = st.q ? searchProducts(st.q, items) : items;
  if (st.colors.length) out = out.filter((p) => p.colors.some((c) => st.colors.includes(c.name)));
  if (st.sizes.length) out = out.filter((p) => p.variants.some((v) => st.sizes.includes(v.size) && (!st.stock || v.state !== 'out')));
  if (st.stock) out = out.filter((p) => p.stock !== 'out');
  if (st.sale) out = out.filter((p) => p.discountPct > 0);
  return out;
}

export default async function shop({ params, query }) {
  await loadCatalog();
  const category = params.category || 'all';
  const cat = category === 'all' ? null : getCategory(category);
  if (category !== 'all' && !cat) return (await import('./notFound.js')).default();
  const base = await listProducts({ category, sort: readState(query).sort });
  const cats = listCategories();

  const colorMap = new Map();
  base.forEach((p) => p.colors.forEach((c) => colorMap.set(c.name, c.hex)));
  const sizes = [...new Set(base.flatMap((p) => p.sizes))].sort((a, b) => SIZE_ORDER.indexOf(a) - SIZE_ORDER.indexOf(b));
  const hasSale = base.some((p) => p.discountPct);
  const title = cat ? cat.label : query.q ? `Results for “${query.q}”` : query.sort === 'new' ? 'New in' : query.sale === '1' ? 'On sale' : 'All pieces';

  return {
    name: 'shop',
    title,
    description: cat?.blurb || 'Shop Knot’ily oversized tees and streetwear.',
    html: `
    <div class="wrap shop">
      <nav class="crumbs" aria-label="Breadcrumb"><ol><li><a href="/">Home</a></li><li><a href="/shop">Shop</a></li>${cat ? `<li aria-current="page">${esc(cat.label)}</li>` : ''}</ol></nav>
      <header class="shop-head">
        <h1 class="page-title">${esc(title)}</h1>
        ${cat?.blurb ? `<p class="shop-blurb">${esc(cat.blurb)}</p>` : ''}
      </header>
      <div class="shop-bar">
        <button type="button" class="btn btn-line btn-sm" data-filters-open aria-controls="filters" aria-expanded="false">${icons.filter}<span>Filter</span><span class="fcount" data-fcount hidden></span></button>
        <p class="shop-count" data-count aria-live="polite"></p>
        <label class="sort-sel"><span class="sr-only">Sort by</span>
          <select data-sort>${SORTS.map(([v, l]) => `<option value="${v}">${l}</option>`).join('')}</select></label>
      </div>
      <div class="active-filters" data-active></div>
      <div class="shop-body">
        <aside class="filters" id="filters" data-filters aria-label="Filters">
          <div class="filters-head"><span>Filter</span><button type="button" class="icon" data-filters-close aria-label="Close filters">${icons.close}</button></div>
          <div class="filters-body">
            <details open><summary>Category</summary><ul class="f-links">
              <li><a href="/shop" ${!cat ? 'aria-current="page"' : ''}>All pieces</a></li>
              ${cats.map((c) => `<li><a href="/shop/${esc(c.id)}" ${cat?.id === c.id ? 'aria-current="page"' : ''}>${esc(c.label)}</a></li>`).join('')}</ul></details>
            ${colorMap.size ? `<details open><summary>Colour</summary><div class="f-colors">
              ${[...colorMap].map(([n, h]) => `<label class="f-color"><input type="checkbox" name="color" value="${esc(n)}" /><i style="--sw:${esc(h)}"></i><span>${esc(n)}</span></label>`).join('')}</div></details>` : ''}
            ${sizes.length ? `<details open><summary>Size</summary><div class="f-sizes">
              ${sizes.map((s) => `<label class="f-size"><input type="checkbox" name="size" value="${esc(s)}" /><span>${esc(s)}</span></label>`).join('')}</div></details>` : ''}
            <details open><summary>Availability</summary>
              <label class="f-toggle"><input type="checkbox" name="stock" /><span>In stock only</span></label>
              ${hasSale ? '<label class="f-toggle"><input type="checkbox" name="sale" /><span>On sale</span></label>' : ''}
            </details>
          </div>
          <div class="filters-foot"><button type="button" class="btn btn-line btn-sm" data-clear>Clear all</button><button type="button" class="btn btn-sm" data-filters-close>Show results</button></div>
        </aside>
        <div class="filters-scrim" data-filters-close></div>
        <div class="grid grid-shop" data-grid></div>
      </div>
    </div>`,

    mount(root) {
      const grid = $('[data-grid]', root);
      const count = $('[data-count]', root);
      const fcount = $('[data-fcount]', root);
      const active = $('[data-active]', root);
      const panel = $('[data-filters]', root);
      const openBtn = $('[data-filters-open]', root);
      const sortSel = $('[data-sort]', root);
      let st = readState(query);

      const syncInputs = () => {
        panel.querySelectorAll('input[name=color]').forEach((i) => (i.checked = st.colors.includes(i.value)));
        panel.querySelectorAll('input[name=size]').forEach((i) => (i.checked = st.sizes.includes(i.value)));
        const stock = panel.querySelector('input[name=stock]');
        if (stock) stock.checked = st.stock;
        const sale = panel.querySelector('input[name=sale]');
        if (sale) sale.checked = st.sale;
        sortSel.value = st.sort;
      };

      const writeUrl = () => {
        const q = new URLSearchParams();
        if (st.q) q.set('q', st.q);
        if (st.colors.length) q.set('color', st.colors.join(','));
        if (st.sizes.length) q.set('size', st.sizes.join(','));
        if (st.stock) q.set('stock', '1');
        if (st.sale) q.set('sale', '1');
        if (st.sort !== 'featured') q.set('sort', st.sort);
        const s = q.toString();
        history.replaceState(history.state, '', location.pathname + (s ? `?${s}` : ''));
      };

      const draw = async () => {
        const sorted = await listProducts({ category, sort: st.sort });
        const items = apply(sorted, st);
        count.textContent = `${items.length} piece${items.length === 1 ? '' : 's'}`;
        grid.innerHTML = items.length
          ? items.map((p, i) => productCard(p, { eager: i < 4 })).join('')
          : `<div class="empty"><p>Nothing matches these filters.</p><button type="button" class="btn btn-line" data-clear>Clear filters</button></div>`;
        const n = st.colors.length + st.sizes.length + (st.stock ? 1 : 0) + (st.sale ? 1 : 0);
        fcount.hidden = !n;
        fcount.textContent = n;
        const chips = [
          ...(st.q ? [['q', st.q, `“${st.q}”`]] : []),
          ...st.colors.map((c) => ['color', c, c]),
          ...st.sizes.map((s) => ['size', s, `Size ${s}`]),
          ...(st.stock ? [['stock', '1', 'In stock']] : []),
          ...(st.sale ? [['sale', '1', 'On sale']] : []),
        ];
        active.innerHTML = chips.length
          ? chips.map(([k, v, l]) => `<button type="button" class="chip" data-chip="${k}" data-val="${esc(v)}" aria-label="Remove filter ${esc(l)}">${esc(l)} ${icons.close}</button>`).join('') + '<button type="button" class="link-inline" data-clear>Clear all</button>'
          : '';
        hydrate(grid);
      };

      const setPanel = (open) => {
        panel.classList.toggle('open', open);
        root.querySelector('.filters-scrim').classList.toggle('open', open);
        document.body.classList.toggle('drawer-open', open && matchMedia('(max-width: 900px)').matches);
        openBtn.setAttribute('aria-expanded', String(open));
        if (open) panel.querySelector('summary')?.focus();
      };
      openBtn.addEventListener('click', () => setPanel(!panel.classList.contains('open')));
      root.addEventListener('click', (e) => {
        if (e.target.closest('[data-filters-close]')) setPanel(false);
        if (e.target.closest('[data-clear]')) {
          st = { ...st, q: '', colors: [], sizes: [], stock: false, sale: false };
          syncInputs(); writeUrl(); draw();
        }
        const chip = e.target.closest('[data-chip]');
        if (chip) {
          const k = chip.dataset.chip, val = chip.dataset.val;
          if (k === 'q') st.q = '';
          if (k === 'color') st.colors = st.colors.filter((x) => x !== val);
          if (k === 'size') st.sizes = st.sizes.filter((x) => x !== val);
          if (k === 'stock') st.stock = false;
          if (k === 'sale') st.sale = false;
          syncInputs(); writeUrl(); draw();
        }
      });
      panel.addEventListener('change', (e) => {
        const t = e.target;
        if (t.name === 'color') st.colors = [...panel.querySelectorAll('input[name=color]:checked')].map((i) => i.value);
        if (t.name === 'size') st.sizes = [...panel.querySelectorAll('input[name=size]:checked')].map((i) => i.value);
        if (t.name === 'stock') st.stock = t.checked;
        if (t.name === 'sale') st.sale = t.checked;
        track('filter', { [t.name]: t.type === 'checkbox' ? (t.checked ? t.value : `-${t.value}`) : t.value });
        writeUrl(); draw();
      });
      sortSel.addEventListener('change', () => {
        st.sort = sortSel.value;
        track('sort', { sort: st.sort });
        writeUrl(); draw();
      });
      document.addEventListener('keydown', function onKey(e) {
        if (!root.isConnected) return document.removeEventListener('keydown', onKey);
        if (e.key === 'Escape' && panel.classList.contains('open')) setPanel(false);
      });
      syncInputs();
      draw();
      return () => document.body.classList.remove('drawer-open');
    },
  };
}
