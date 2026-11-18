// Homepage content: announcement bar messages, hero slides, full-width banners and
// collection tiles. Each can be scheduled (start / end) and switched off.
import { get, post, del } from '../lib/api.js';
import { esc, flash, upload, dateTime } from './ui.js';

const PLACES = [
  ['hero', 'Hero slides', 'Big slides at the top of the home page. Landscape photo (about 2400 × 1100 px), plus an optional portrait version for phones (1080 × 1350).'],
  ['tile', 'Collection tiles', 'Square-ish cards under “Discover collections” (about 1000 × 1250 px). Without any, the shop shows one tile per category.'],
  ['strip', 'Full-width banners', 'Wide banners between product rows (about 2400 × 1000 px).'],
  ['announcement', 'Announcement bar', 'Short messages in the blue bar above the menu. Several rotate every 5 seconds.'],
];

const blank = (placement) => ({ id: null, placement, title: '', subtitle: '', cta_label: 'Shop now', link_url: '/shop', image_url: null, mobile_image_url: null, theme: 'dark', sort: 0, is_active: true, starts_at: null, ends_at: null });
const localInput = (iso) => (iso ? new Date(new Date(iso).getTime() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16) : '');

function state(b) {
  const now = Date.now();
  if (!b.is_active) return ['off', 'Off'];
  if (b.starts_at && new Date(b.starts_at) > now) return ['later', `Starts ${dateTime(b.starts_at)}`];
  if (b.ends_at && new Date(b.ends_at) <= now) return ['off', 'Ended'];
  return ['live', b.ends_at ? `Live until ${dateTime(b.ends_at)}` : 'Live'];
}

function formHTML(b) {
  const ann = b.placement === 'announcement';
  return `
    <form class="adm-card banner-form" data-form novalidate>
      <h2>${b.id ? 'Edit' : 'New'} ${esc(PLACES.find(([k]) => k === b.placement)[1].toLowerCase().replace(/s$/, ''))}</h2>
      <div class="adm-row3">
        <div class="adm-field"><label for="b-place">Where</label><select id="b-place" name="placement">${PLACES.map(([k, l]) => `<option value="${k}" ${k === b.placement ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
        <div class="adm-field"><label for="b-sort">Order (lower first)</label><input id="b-sort" name="sort" type="number" value="${b.sort}" /></div>
        <div class="adm-field"><span class="label">Show</span><label class="adm-check"><input type="checkbox" name="is_active" ${b.is_active ? 'checked' : ''} /> Switched on</label></div>
      </div>
      <div class="adm-field"><label for="b-title">${ann ? 'Message' : 'Title'}</label><input id="b-title" name="title" value="${esc(b.title)}" maxlength="120" ${ann ? 'required' : ''} /></div>
      ${ann ? '' : `
        <div class="adm-field"><label for="b-sub">Subtitle (optional)</label><input id="b-sub" name="subtitle" value="${esc(b.subtitle)}" maxlength="200" /></div>
        <div class="adm-row3">
          <div class="adm-field"><label for="b-cta">Button text</label><input id="b-cta" name="cta_label" value="${esc(b.cta_label)}" maxlength="30" /></div>
          <div class="adm-field adm-span2"><label for="b-link">Button link</label><input id="b-link" name="link_url" value="${esc(b.link_url)}" placeholder="/shop/tees or /product/after-hours-oversized-tee" /></div>
        </div>
        <div class="adm-row2">
          <div class="file-slot"><p class="file-label">Image</p>${b.image_url ? `<img class="banner-prev" src="${esc(b.image_url)}" alt="" />` : ''}
            <label class="adm-btn adm-btn-line file-pick">${b.image_url ? 'Replace' : 'Upload'}<input type="file" accept="image/jpeg,image/png,image/webp" data-up="image_url" hidden /></label></div>
          <div class="file-slot"><p class="file-label">Phone image (optional)</p>${b.mobile_image_url ? `<img class="banner-prev" src="${esc(b.mobile_image_url)}" alt="" /> <button type="button" class="adm-link" data-clear-mobile>Remove</button>` : ''}
            <label class="adm-btn adm-btn-line file-pick">${b.mobile_image_url ? 'Replace' : 'Upload'}<input type="file" accept="image/jpeg,image/png,image/webp" data-up="mobile_image_url" hidden /></label></div>
        </div>
        <div class="progress" data-progress hidden><span></span></div>
        <div class="adm-field"><span class="label">Text colour</span>
          <label class="adm-check"><input type="radio" name="theme" value="dark" ${b.theme !== 'light' ? 'checked' : ''} /> White text (for darker photos)</label>
          <label class="adm-check"><input type="radio" name="theme" value="light" ${b.theme === 'light' ? 'checked' : ''} /> Black text (for light photos)</label></div>`}
      ${ann ? `<div class="adm-field"><label for="b-link">Link (optional)</label><input id="b-link" name="link_url" value="${esc(b.link_url)}" /></div>` : ''}
      <div class="adm-row2">
        <div class="adm-field"><label for="b-start">Start showing (optional)</label><input id="b-start" name="starts_at" type="datetime-local" value="${localInput(b.starts_at)}" /></div>
        <div class="adm-field"><label for="b-end">Stop showing (optional)</label><input id="b-end" name="ends_at" type="datetime-local" value="${localInput(b.ends_at)}" /></div>
      </div>
      <div class="save-row">${b.id ? '<button type="button" class="adm-link danger" data-delete>Delete</button>' : ''}<button type="button" class="adm-btn adm-btn-line" data-cancel>Cancel</button><button type="submit" class="adm-btn">Save</button></div>
    </form>`;
}

export async function render(outer) {
  const host = document.createElement('div');
  outer.replaceChildren(host);
  const { banners } = await get('/api/admin/banners');
  let editing = null;

  const draw = () => {
    host.innerHTML = `
      <div class="adm-bar"><h1 class="adm-title">Homepage</h1><a class="adm-link" href="/" target="_blank" rel="noopener">View the home page ↗</a></div>
      <p class="adm-hint">Changes show in the shop within about a minute.</p>
      ${editing ? formHTML(editing) : ''}
      ${PLACES.map(([k, label, hint]) => {
        const list = banners.filter((b) => b.placement === k);
        return `<section class="adm-card">
          <div class="adm-bar"><h2>${label}</h2><button type="button" class="adm-btn adm-btn-sm adm-btn-line" data-new="${k}">Add</button></div>
          <p class="adm-hint">${hint}</p>
          ${list.length ? `<ul class="banner-list">${list.map((b) => {
            const [cls, txt] = state(b);
            return `<li>${b.image_url ? `<img src="${esc(b.image_url)}" alt="" loading="lazy" />` : '<span class="banner-noimg">Aa</span>'}
              <div><b>${esc(b.title || '(no title)')}</b><small>${esc(b.link_url)}</small></div>
              <span class="pill pill-${cls === 'live' ? 'live' : cls === 'later' ? 'draft' : 'archived'}">${esc(txt)}</span>
              <button type="button" class="adm-link" data-edit="${b.id}">Edit</button></li>`;
          }).join('')}</ul>` : '<p class="adm-muted">None yet.</p>'}
        </section>`;
      }).join('')}`;
    if (editing) host.querySelector('[data-form]').scrollIntoView({ block: 'start' });
  };

  host.addEventListener('click', async (e) => {
    const nb = e.target.closest('[data-new]');
    if (nb) return (editing = blank(nb.dataset.new)), draw();
    const eb = e.target.closest('[data-edit]');
    if (eb) return (editing = { ...banners.find((b) => b.id === eb.dataset.edit) }), draw();
    if (e.target.closest('[data-cancel]')) return (editing = null), draw();
    if (e.target.closest('[data-clear-mobile]')) return (editing.mobile_image_url = null), draw();
    if (e.target.closest('[data-delete]')) {
      if (!confirm('Delete this banner?')) return;
      try {
        await del(`/api/admin/banners/${editing.id}`);
        banners.splice(banners.findIndex((b) => b.id === editing.id), 1);
        editing = null;
        draw();
        flash(host, 'Deleted.');
      } catch (err) {
        flash(host, err.message, 'error');
      }
    }
  });

  // keep typed values when the form re-draws (after an upload or a placement change)
  const readForm = () => {
    const f = host.querySelector('[data-form]');
    if (!f) return;
    const v = (n) => f.elements[n]?.value;
    Object.assign(editing, {
      placement: v('placement'), title: v('title') ?? editing.title, subtitle: v('subtitle') ?? editing.subtitle,
      cta_label: v('cta_label') ?? editing.cta_label, link_url: v('link_url') ?? editing.link_url, sort: Number(v('sort') || 0),
      is_active: f.elements.is_active.checked, theme: f.querySelector('[name=theme]:checked')?.value || editing.theme,
      starts_at: v('starts_at') ? new Date(v('starts_at')).toISOString() : null, ends_at: v('ends_at') ? new Date(v('ends_at')).toISOString() : null,
    });
  };

  host.addEventListener('change', async (e) => {
    if (e.target.name === 'placement') return readForm(), draw();
    const inp = e.target.closest('[data-up]');
    if (!inp?.files.length) return;
    readForm();
    const bar = host.querySelector('[data-progress]');
    bar.hidden = false;
    try {
      editing[inp.dataset.up] = await upload(inp.files[0], 'image', 'banners', (x) => (bar.firstElementChild.style.width = `${Math.round(x * 100)}%`));
      draw();
    } catch (err) {
      bar.hidden = true;
      flash(host, err.message, 'error');
    }
  });

  host.addEventListener('submit', async (e) => {
    e.preventDefault();
    readForm();
    try {
      const saved = await post('/api/admin/banners', editing);
      const i = banners.findIndex((b) => b.id === saved.id);
      if (i >= 0) banners[i] = saved;
      else banners.push(saved);
      banners.sort((a, b) => a.sort - b.sort);
      editing = null;
      draw();
      flash(host, 'Saved. It shows on the home page within a minute.');
    } catch (err) {
      flash(host, err.message, 'error');
      const map = { image_url: 'input[data-up=image_url]', link_url: '#b-link', title: '#b-title', ends_at: '#b-end' };
      host.querySelector(map[err.field])?.closest('.adm-field, .file-slot')?.scrollIntoView({ block: 'center' });
    }
  });

  draw();
}
