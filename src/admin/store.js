// Categories, alerts inbox, store settings, and the decrypted data download.
import { get, post, put, del, api } from '../lib/api.js';
import { esc, num, dateTime, flash, emptyRow } from './ui.js';

// ------------------------------------------------------------------ categories
export async function categories(outer) {
  const host = document.createElement('div');
  outer.replaceChildren(host);
  const { categories: list } = await get('/api/admin/categories');
  host.innerHTML = `
    <div class="adm-bar"><h1 class="adm-title">Categories</h1></div>
    <p class="adm-hint">Categories appear as filters in the shop and in the footer. A category with products can’t be deleted — move the products first or hide it.</p>
    <div class="adm-table-wrap"><table class="adm-table">
      <thead><tr><th scope="col">Name</th><th scope="col">Web address</th><th scope="col">Description</th><th scope="col" class="r">Order</th><th scope="col">Shown</th><th scope="col" class="r">Products</th><th scope="col"><span class="sr-only">Actions</span></th></tr></thead>
      <tbody>${[...list, { id: '', name: '', slug: '', description: '', sort: list.length, is_active: true, products: 0 }].map((c) => `<tr data-id="${c.id}">
        <td><input data-f="name" value="${esc(c.name)}" maxlength="60" placeholder="${c.id ? '' : 'New category'}" aria-label="Name" /></td>
        <td><input data-f="slug" value="${esc(c.slug)}" maxlength="60" placeholder="auto" aria-label="Web address" /></td>
        <td><input data-f="description" value="${esc(c.description || '')}" maxlength="300" aria-label="Description" /></td>
        <td class="r"><input data-f="sort" type="number" value="${c.sort}" class="stock-in" aria-label="Order" /></td>
        <td><input data-f="is_active" type="checkbox" ${c.is_active ? 'checked' : ''} aria-label="Shown in the shop" /></td>
        <td class="r">${c.id ? num(c.products) : ''}</td>
        <td class="nowrap"><button type="button" class="adm-btn adm-btn-sm" data-save>${c.id ? 'Save' : 'Add'}</button>${c.id && !c.products ? ` <button type="button" class="adm-link danger" data-del>Delete</button>` : ''}</td></tr>`).join('')}</tbody></table></div>`;

  host.addEventListener('click', async (e) => {
    const tr = e.target.closest('tr');
    if (!tr) return;
    const val = (f) => tr.querySelector(`[data-f=${f}]`);
    try {
      if (e.target.closest('[data-save]')) {
        await post('/api/admin/categories', { id: tr.dataset.id || null, name: val('name').value, slug: val('slug').value, description: val('description').value, sort: Number(val('sort').value), is_active: val('is_active').checked });
        await categories(outer);
        flash(outer.firstElementChild, 'Saved.');
      } else if (e.target.closest('[data-del]')) {
        if (!confirm(`Delete the category “${val('name').value}”?`)) return;
        await del(`/api/admin/categories/${tr.dataset.id}`);
        await categories(outer);
        flash(outer.firstElementChild, 'Deleted.');
      }
    } catch (err) {
      flash(host, err.message, 'error');
    }
  });
}

// ------------------------------------------------------------------ alerts
const KIND = { low_stock: 'Running low', out_of_stock: 'Sold out', reminder_threshold: 'Many shoppers waiting', order_paid: 'New order', restock_sent: 'Restock emails sent', account_deletion: 'Account deletion request' };

export async function alerts(outer) {
  const host = document.createElement('div');
  outer.replaceChildren(host);
  const { alerts: list } = await get('/api/admin/alerts');
  host.innerHTML = `
    <div class="adm-bar"><h1 class="adm-title">Alerts</h1>${list.some((a) => !a.read_at) ? '<button type="button" class="adm-btn adm-btn-line" data-read-all>Mark all as read</button>' : ''}</div>
    <p class="adm-hint">These are also emailed to the alert address in Settings.</p>
    <ul class="alert-list">${list.length ? list.map((a) => `<li class="${a.read_at ? '' : 'unread'} alert-${esc(a.kind)}">
      <p class="alert-kind">${esc(KIND[a.kind] || a.kind)} <time>${esc(dateTime(a.created_at))}</time></p>
      <p class="alert-msg">${esc(a.message)}</p>
      ${a.emailed_at ? '<p class="adm-muted small">Emailed</p>' : ''}</li>`).join('') : '<li class="adm-muted">No alerts yet.</li>'}</ul>`;
  host.querySelector('[data-read-all]')?.addEventListener('click', async () => {
    await post('/api/admin/alerts/read', {});
    document.dispatchEvent(new Event('knotily:alerts'));
    alerts(outer);
  });
}

// ------------------------------------------------------------------ settings
export async function settings(outer) {
  const host = document.createElement('div');
  outer.replaceChildren(host);
  const s = await get('/api/admin/settings');
  const ship = s.shipping || { free_over_paise: 199900, fee_paise: 9900 };
  host.innerHTML = `
    <div class="adm-bar"><h1 class="adm-title">Settings</h1></div>
    <form class="adm-card settings" data-settings novalidate>
      <h2>Alerts</h2>
      <div class="adm-field"><label for="s-email">Send owner alerts to</label><input id="s-email" name="owner_alert_email" value="${esc(s.owner_alert_email || '')}" placeholder="you@knotily.in, partner@knotily.in" />
        <p class="adm-hint">Low stock, sold out, many shoppers waiting, new orders. Separate several addresses with commas. Empty = the owner account’s email.</p></div>
      <div class="adm-row3">
        <div class="adm-field"><label for="s-rem">Alert when more than … shoppers wait for one design</label><input id="s-rem" name="reminder_alert_threshold" type="number" min="1" value="${esc(s.reminder_alert_threshold ?? 10)}" /></div>
        <div class="adm-field"><label for="s-low">Default “running low” level for new sizes</label><input id="s-low" name="low_stock_default" type="number" min="0" value="${esc(s.low_stock_default ?? 5)}" /></div>
        <div class="adm-field"><span class="label">New orders</span><label class="adm-check"><input type="checkbox" name="notify_owner_on_order" ${s.notify_owner_on_order !== false ? 'checked' : ''} /> Email me every new order</label></div>
      </div>
      <h2>Shipping and checkout</h2>
      <div class="adm-row3">
        <div class="adm-field"><label for="s-free">Free shipping over (₹)</label><input id="s-free" name="free_over" type="number" min="0" value="${ship.free_over_paise / 100}" /></div>
        <div class="adm-field"><label for="s-fee">Shipping fee below that (₹)</label><input id="s-fee" name="fee" type="number" min="0" value="${ship.fee_paise / 100}" /></div>
        <div class="adm-field"><label for="s-hold">Hold stock during payment (minutes)</label><input id="s-hold" name="reservation_minutes" type="number" min="5" max="60" value="${esc(s.reservation_minutes ?? 15)}" /></div>
      </div>
      <h2>Product music</h2>
      <div class="adm-field"><label for="s-vol">Volume when a product is opened: <output data-vol>${Math.round((s.audio_volume ?? 0.2) * 100)}%</output></label>
        <input id="s-vol" name="audio_volume" type="range" min="0" max="100" step="5" value="${Math.round((s.audio_volume ?? 0.2) * 100)}" /></div>
      <div class="save-row"><button type="submit" class="adm-btn">Save settings</button></div>
    </form>`;
  const form = host.querySelector('[data-settings]');
  form.audio_volume.addEventListener('input', (e) => (host.querySelector('[data-vol]').textContent = `${e.target.value}%`));
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = form.elements;
    try {
      await put('/api/admin/settings', {
        owner_alert_email: f.owner_alert_email.value,
        reminder_alert_threshold: Number(f.reminder_alert_threshold.value),
        low_stock_default: Number(f.low_stock_default.value),
        notify_owner_on_order: f.notify_owner_on_order.checked,
        shipping: { free_over_paise: Math.round(Number(f.free_over.value) * 100), fee_paise: Math.round(Number(f.fee.value) * 100) },
        reservation_minutes: Number(f.reservation_minutes.value),
        audio_volume: Number(f.audio_volume.value) / 100,
      });
      flash(host, 'Settings saved. The shop picks them up within a minute.');
    } catch (err) {
      flash(host, err.message, 'error');
    }
  });
}

// ------------------------------------------------------------------ export (decrypted)
const DATASETS = [
  ['orders', 'Orders', 'Every order with items, totals, device, and the customer’s decrypted name, email, phone, address, age and gender.'],
  ['customers', 'Customers', 'Every account with decrypted contact details, saved address, number of orders and total spent.'],
  ['events', 'Shopper activity', 'Every recorded action (page, product, colour, size, bag, checkout, payment) with visit and visitor ids, device, OS and source — the full journey data.'],
  ['inventory', 'Inventory', 'Every colour and size with stock, held, available, sold in 30 days and people waiting.'],
];
let exportToken = null;
let exportUntil = 0;

export async function exportData(outer) {
  const host = document.createElement('div');
  outer.replaceChildren(host);
  const unlocked = () => exportToken && Date.now() < exportUntil;
  // dates in the owner's own time zone (toISOString alone would give the UTC date)
  const localDate = (t) => new Date(t - new Date(t).getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  const today = localDate(Date.now());
  const ago = localDate(Date.now() - 90 * 864e5);
  host.innerHTML = `
    <div class="adm-bar"><h1 class="adm-title">Download data</h1></div>
    <div class="adm-card">
      <p>Personal details are stored encrypted. Downloads here are decrypted so you can analyse them in Excel or Google Sheets. Each download is logged.</p>
      <p class="adm-warn">Keep these files safe: they contain customers’ personal data. Don’t email them or leave them in shared folders, and delete them when you’re done.</p>
      <form class="unlock" data-unlock ${unlocked() ? 'hidden' : ''}>
        <div class="adm-field"><label for="x-pw">Confirm your password to unlock downloads for 10 minutes</label>
          <div class="unlock-row"><input id="x-pw" name="password" type="password" autocomplete="current-password" required /><button type="submit" class="adm-btn">Unlock</button></div></div>
      </form>
      <div data-downloads ${unlocked() ? '' : 'hidden'}>
        <div class="adm-row3"><div class="adm-field"><label for="x-from">From</label><input id="x-from" type="date" value="${ago}" max="${today}" /></div>
          <div class="adm-field"><label for="x-to">To</label><input id="x-to" type="date" value="${today}" max="${today}" /></div></div>
        <ul class="dl-list">${DATASETS.map(([k, t, d]) => `<li><div><b>${t}</b><p class="adm-muted">${d}</p></div><button type="button" class="adm-btn adm-btn-line" data-dl="${k}">Download CSV</button></li>`).join('')}</ul>
      </div>
    </div>`;

  host.querySelector('[data-unlock]').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      const r = await post('/api/admin/reauth', { password: e.target.password.value });
      exportToken = r.exportToken;
      exportUntil = Date.now() + (r.expiresIn - 15) * 1000;
      e.target.password.value = '';
      exportData(outer);
    } catch (err) {
      flash(host, err.message, 'error');
    }
  });
  host.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-dl]');
    if (!b) return;
    if (!unlocked()) return exportData(outer);
    const from = host.querySelector('#x-from').value;
    const to = host.querySelector('#x-to').value;
    b.disabled = true;
    try {
      // whole days in local time, sent as exact instants
      const qs = new URLSearchParams({ dataset: b.dataset.dl, ...(from ? { from: new Date(`${from}T00:00:00`).toISOString() } : {}), ...(to ? { to: new Date(`${to}T23:59:59.999`).toISOString() } : {}) });
      const res = await fetch(`/api/admin/export?${qs}`, { headers: { 'x-knotily': '1', 'x-export-token': exportToken }, credentials: 'same-origin' });
      if (!res.ok) throw new Error((await res.json().catch(() => null))?.error?.message || 'Download failed.');
      const blob = await res.blob();
      const name = /filename="([^"]+)"/.exec(res.headers.get('content-disposition') || '')?.[1] || `knotily-${b.dataset.dl}.csv`;
      const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: name });
      document.body.appendChild(a);
      a.click();
      setTimeout(() => (URL.revokeObjectURL(a.href), a.remove()), 1000);
    } catch (err) {
      flash(host, err.message, 'error');
    } finally {
      b.disabled = false;
    }
  });
}

export { api };
