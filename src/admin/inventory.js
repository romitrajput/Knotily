// Inventory: every colour × size in one table. Edit stock and alert levels in place.
import { get, put } from '../lib/api.js';
import { esc, num, flash, emptyRow } from './ui.js';

export async function render(host, { query }) {
  const { variants } = await get('/api/admin/inventory');
  let filter = ['low', 'out', 'waiting'].includes(query.filter) ? query.filter : 'all';
  let search = '';

  host.innerHTML = `
    <div class="adm-bar"><h1 class="adm-title">Inventory</h1>
      <div class="adm-bar-actions">
        <input type="search" class="adm-search" placeholder="Search product, colour, size, SKU" data-search aria-label="Search inventory" />
        <div class="adm-seg" role="group" aria-label="Show">${[['all', 'All'], ['low', 'Low'], ['out', 'Sold out'], ['waiting', 'People waiting']].map(([v, l]) => `<button type="button" data-filter="${v}" aria-pressed="${v === filter}">${l}</button>`).join('')}</div>
      </div></div>
    <p class="adm-hint">“Available” is stock minus pieces held in open checkouts (held for 15 minutes). Raising a sold-out size above zero emails everyone waiting for it.</p>
    <div class="adm-table-wrap"><table class="adm-table inv-table">
      <thead><tr><th scope="col">Product</th><th scope="col">Colour</th><th scope="col">Size</th><th scope="col" class="r">Stock</th><th scope="col" class="r">Held</th><th scope="col" class="r">Available</th><th scope="col" class="r">Alert at</th><th scope="col" class="r">Sold (30 days)</th><th scope="col" class="r">Waiting</th><th scope="col"><span class="sr-only">Save</span></th></tr></thead>
      <tbody data-rows></tbody></table></div>`;

  const body = host.querySelector('[data-rows]');
  const draw = () => {
    const q = search.toLowerCase();
    const rows = variants.filter((v) => {
      if (filter === 'low' && !(v.available <= v.low_stock_threshold)) return false;
      if (filter === 'out' && v.available > 0) return false;
      if (filter === 'waiting' && !v.waiting) return false;
      return !q || `${v.product} ${v.color} ${v.size} ${v.sku || ''}`.toLowerCase().includes(q);
    });
    body.innerHTML = rows.length
      ? rows.map((v) => {
          const state = v.available <= 0 ? 'out' : v.available <= v.low_stock_threshold ? 'low' : '';
          return `<tr data-id="${v.variant_id}" class="${state ? `row-${state}` : ''}">
            <th scope="row">${esc(v.product)}${v.status !== 'live' ? ` <span class="pill pill-${esc(v.status)}">${esc(v.status)}</span>` : ''}</th>
            <td><i class="sw" style="--sw:${esc(v.hex)}"></i>${esc(v.color)}</td><td>${esc(v.size)}</td>
            <td class="r"><input type="number" min="0" max="100000" inputmode="numeric" class="stock-in" value="${v.stock}" data-f="stock" aria-label="Stock for ${esc(v.product)} ${esc(v.color)} ${esc(v.size)}" /></td>
            <td class="r">${v.reserved ? num(v.reserved) : '0'}</td>
            <td class="r"><b class="${state === 'out' ? 'neg' : state === 'low' ? 'warn' : ''}">${state === 'out' ? 'Sold out' : num(v.available)}</b></td>
            <td class="r"><input type="number" min="0" max="10000" inputmode="numeric" class="stock-in" value="${v.low_stock_threshold}" data-f="low" aria-label="Alert level" /></td>
            <td class="r">${num(v.sold_30d)}</td>
            <td class="r">${v.waiting ? `<b>${num(v.waiting)}</b>` : '0'}</td>
            <td><button type="button" class="adm-btn adm-btn-sm" data-save hidden>Save</button></td></tr>`;
        }).join('')
      : emptyRow(10, 'Nothing matches.');
  };
  draw();

  host.querySelector('[data-search]').addEventListener('input', (e) => ((search = e.target.value), draw()));
  host.querySelectorAll('[data-filter]').forEach((b) => b.addEventListener('click', () => {
    filter = b.dataset.filter;
    host.querySelectorAll('[data-filter]').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
    history.replaceState({}, '', `/admin/inventory${filter === 'all' ? '' : `?filter=${filter}`}`);
    draw();
  }));
  body.addEventListener('input', (e) => e.target.closest('tr')?.querySelector('[data-save]')?.removeAttribute('hidden'));
  body.addEventListener('keydown', (e) => e.key === 'Enter' && e.target.matches('input') && e.target.closest('tr').querySelector('[data-save]').click());
  body.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-save]');
    if (!b) return;
    const tr = b.closest('tr');
    const v = variants.find((x) => x.variant_id === tr.dataset.id);
    b.disabled = true;
    try {
      const r = await put(`/api/admin/inventory/${v.variant_id}`, { stock: Number(tr.querySelector('[data-f=stock]').value), lowStockThreshold: Number(tr.querySelector('[data-f=low]').value) });
      v.stock = r.stock ?? Number(tr.querySelector('[data-f=stock]').value);
      v.low_stock_threshold = Number(tr.querySelector('[data-f=low]').value);
      v.available = v.stock - v.reserved;
      if (r.restockEmails) v.waiting = 0;
      flash(host, r.restockEmails ? `Saved. Emailed ${r.restockEmails} shopper${r.restockEmails === 1 ? '' : 's'} that ${v.product} (${v.color}, ${v.size}) is back.` : `Saved ${v.product} · ${v.color} · ${v.size}.`);
      draw();
    } catch (err) {
      b.disabled = false;
      flash(host, err.message, 'error');
    }
  });
}
