// Products: list + editor (details, price & discount, colours, sizes & stock, print artwork,
// live product-image preview, music, photo/video previews, reviews).
import { get, post, put } from '../lib/api.js';
import { thumbnail } from '../gl/garments.js';
import { navigate } from '../router.js';
import { inr, num, esc, flash, upload, posterFrom, slugify, emptyRow } from './ui.js';

const GARMENTS = [
  ['oversized', 'Oversized tee'], ['tee', 'Boxy tee'], ['tank', 'Tank'], ['halter', 'Halter'], ['longsleeve', 'Long sleeve'],
  ['hoodie', 'Hoodie'], ['jacket', 'Varsity jacket'], ['pants', 'Cargo pants'], ['skirt', 'Mini skirt'],
];
const STATUS = [['draft', 'Draft (hidden)'], ['live', 'Live'], ['archived', 'Archived']];
const DEFAULT_SIZES = ['S', 'M', 'L', 'XL', 'XXL'];

// ------------------------------------------------------------------ list
export async function renderList(host) {
  const { products } = await get('/api/admin/products');
  host.innerHTML = `
    <div class="adm-bar"><h1 class="adm-title">Products</h1><a class="adm-btn" href="/admin/products?edit=new">New product</a></div>
    <div class="adm-table-wrap"><table class="adm-table">
      <thead><tr><th scope="col">Product</th><th scope="col">Status</th><th scope="col">Category</th><th scope="col" class="r">Price</th><th scope="col" class="r">In stock</th><th scope="col" class="r">Low / out sizes</th><th scope="col" class="r">Waiting</th></tr></thead>
      <tbody>${products.length ? products.map((p) => `<tr>
        <th scope="row"><a class="adm-strong" href="/admin/products?edit=${p.id}">${esc(p.name)}</a>
          <span class="swatches-inline">${(p.colors || []).map((c) => `<i style="--sw:${esc(c.hex)}" title="${esc(c.name)}"></i>`).join('')}</span></th>
        <td><span class="pill pill-${esc(p.status)}">${esc(p.status)}</span></td>
        <td>${esc(p.category || '—')}</td>
        <td class="r">${p.discount_pct ? `<s>${inr(p.price_paise)}</s> ` : ''}${inr(Math.round((p.price_paise * (100 - p.discount_pct)) / 10000) * 100)}${p.discount_pct ? ` <small>−${p.discount_pct}%</small>` : ''}</td>
        <td class="r">${num(p.stock)}</td>
        <td class="r">${p.low_variants ? `<b class="neg">${p.low_variants}</b>` : '0'}</td>
        <td class="r">${p.waiting ? `<b>${p.waiting}</b>` : '0'}</td></tr>`).join('') : emptyRow(7, 'No products yet. Add your first one.')}</tbody>
    </table></div>`;
}

// ------------------------------------------------------------------ editor
function fromApi(p, categories) {
  const sizes = [...new Set(p.variants.map((v) => v.size))];
  const stock = {};
  const lows = {};
  p.variants.forEach((v) => {
    stock[`${v.color}|${v.size}`] = { stock: v.stock, reserved: v.reserved, waiting: v.waiting, sku: v.sku };
    lows[v.low_stock_threshold] = (lows[v.low_stock_threshold] || 0) + 1;
  });
  const low = Number(Object.entries(lows).sort((a, b) => b[1] - a[1])[0]?.[0] ?? 5);
  const spec = p.print_spec || {};
  return {
    id: p.id, name: p.name, slug: p.slug, slugTouched: true, category_id: p.category_id || categories[0]?.id || '',
    garment_type: p.garment_type, status: p.status, is_new: p.is_new, sort: p.sort || 0,
    price: p.price_paise / 100, discount_pct: p.discount_pct, description: p.description || '', details: (p.details || []).join('\n'),
    printFront: (spec.front || []).join('\n'), printBack: (spec.back || []).join('\n'), printSub: spec.sub || '', spec,
    print_front_url: p.print_front_url, print_back_url: p.print_back_url, audio_url: p.audio_url, audio_title: p.audio_title || '',
    colors: p.colors.map((c) => ({ name: c.name, hex: c.hex, ink_hex: c.ink || '' })),
    sizes: sizes.length ? sizes : DEFAULT_SIZES.slice(), stock, low,
    media: (p.media || []).map((m) => ({ ...m })), reviews: (p.reviews || []).map((r) => ({ ...r })),
  };
}

function blank(categories) {
  return {
    id: null, name: '', slug: '', slugTouched: false, category_id: categories[0]?.id || '', garment_type: 'oversized', status: 'draft', is_new: true, sort: 0,
    price: 1590, discount_pct: 0, description: '', details: '260 GSM heavyweight cotton\nOversized fit with dropped shoulders\nMachine wash cold, inside out',
    printFront: '', printBack: '', printSub: '', spec: {}, print_front_url: null, print_back_url: null, audio_url: null, audio_title: '',
    colors: [{ name: 'Black', hex: '#141214', ink_hex: '' }], sizes: DEFAULT_SIZES.slice(), stock: {}, low: 5, media: [], reviews: [],
  };
}

const lines = (t) => String(t || '').split('\n').map((s) => s.trim()).filter(Boolean);

// shape the still renderer understands
function previewProduct(st) {
  return {
    id: 'preview', name: st.name || 'Preview', art: st.garment_type,
    colors: st.colors.filter((c) => /^#[0-9a-f]{6}$/i.test(c.hex)).map((c) => ({ name: c.name || 'Colour', hex: c.hex, ...(c.ink_hex ? { ink: c.ink_hex } : {}) })),
    print: { ...st.spec, front: lines(st.printFront), back: lines(st.printBack), sub: st.printSub || undefined },
    artwork: { front: st.print_front_url, back: st.print_back_url },
  };
}

function toApi(st) {
  const spec = { ...st.spec, front: lines(st.printFront), back: lines(st.printBack) };
  if (st.printSub) spec.sub = st.printSub;
  else delete spec.sub;
  const variants = [];
  st.colors.forEach((c) => st.sizes.forEach((s) => {
    const cell = st.stock[`${c.name}|${s}`] || {};
    variants.push({ color: c.name, size: s, stock: Number(cell.stock) || 0, low_stock_threshold: Number(st.low) || 0, sku: cell.sku || null });
  }));
  return {
    product: {
      id: st.id, name: st.name.trim(), slug: st.slug, category_id: st.category_id || null, description: st.description, details: lines(st.details),
      price_paise: Math.round(Number(st.price) * 100), discount_pct: Number(st.discount_pct) || 0, garment_type: st.garment_type, print_spec: spec,
      print_front_url: st.print_front_url, print_back_url: st.print_back_url, audio_url: st.audio_url, audio_title: st.audio_title, status: st.status, is_new: st.is_new, sort: st.sort,
    },
    colors: st.colors.map((c) => ({ name: c.name.trim(), hex: c.hex, ink_hex: c.ink_hex || null })),
    variants,
    media: st.media.map((m) => ({ kind: m.kind, url: m.url, poster_url: m.poster_url || null, alt: m.alt || '', color: m.color || null })),
    reviews: st.reviews.map((r) => ({ id: r.id || null, author: r.author, rating: Number(r.rating), title: r.title, body: r.body, is_published: r.is_published !== false })),
  };
}

const opt = (list, cur) => list.map(([v, l]) => `<option value="${esc(v)}" ${v === cur ? 'selected' : ''}>${esc(l)}</option>`).join('');

function colorsHTML(st) {
  return st.colors.map((c, i) => `<div class="color-row" data-i="${i}">
    <input type="color" value="${esc(c.hex)}" data-f="hex" aria-label="Fabric colour for ${esc(c.name)}" />
    <input type="text" value="${esc(c.name)}" data-f="name" maxlength="40" placeholder="Colour name" aria-label="Colour name" />
    <label class="ink">Print <input type="color" value="${esc(c.ink_hex || '#ffffff')}" data-f="ink_hex" aria-label="Print colour on ${esc(c.name)}" />
      <input type="checkbox" data-f="ink_on" ${c.ink_hex ? 'checked' : ''} aria-label="Use a custom print colour" /></label>
    <button type="button" class="adm-icon" data-act="color-del" aria-label="Remove ${esc(c.name)}" ${st.colors.length < 2 ? 'disabled' : ''}>✕</button>
  </div>`).join('');
}

function stockHTML(st) {
  return `<table class="adm-table stock-matrix"><thead><tr><th scope="col">Colour</th>${st.sizes.map((s) => `<th scope="col" class="r">${esc(s)}</th>`).join('')}<th scope="col" class="r">Total</th></tr></thead>
    <tbody>${st.colors.map((c) => {
      let total = 0;
      const cells = st.sizes.map((s) => {
        const cell = st.stock[`${c.name}|${s}`] || {};
        const n = Number(cell.stock) || 0;
        total += n;
        const flag = n - (cell.reserved || 0) <= 0 ? 'is-out' : n - (cell.reserved || 0) <= st.low ? 'is-low' : '';
        const note = [cell.reserved ? `${cell.reserved} held in checkouts` : '', cell.waiting ? `${cell.waiting} waiting for restock` : ''].filter(Boolean).join(', ');
        return `<td class="r"><input type="number" min="0" max="100000" inputmode="numeric" class="stock-in ${flag}" value="${n}" data-stock="${esc(c.name)}|${esc(s)}" aria-label="${esc(c.name)} ${esc(s)} stock" ${note ? `title="${esc(note)}"` : ''} />${cell.waiting ? `<small class="waiting">${cell.waiting} waiting</small>` : ''}</td>`;
      }).join('');
      return `<tr><th scope="row"><i class="sw" style="--sw:${esc(c.hex)}"></i>${esc(c.name)}</th>${cells}<td class="r"><b>${total}</b></td></tr>`;
    }).join('')}</tbody></table>`;
}

function mediaHTML(st) {
  if (!st.media.length) return '<p class="adm-muted">No previews yet. Add photos (model shots, close-ups) and short videos.</p>';
  return `<ul class="media-grid">${st.media.map((m, i) => `<li data-i="${i}">
    <div class="media-thumb">${m.kind === 'video' ? `<video src="${esc(m.url)}" ${m.poster_url ? `poster="${esc(m.poster_url)}"` : ''} muted playsinline preload="metadata"></video><span class="media-kind">Video</span>` : `<img src="${esc(m.url)}" alt="" loading="lazy" />`}</div>
    <input type="text" value="${esc(m.alt || '')}" data-mf="alt" maxlength="200" placeholder="Describe it (for screen readers)" aria-label="Description" />
    <select data-mf="color" aria-label="Colour shown"><option value="">All colours</option>${st.colors.map((c) => `<option ${c.name === m.color ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select>
    <div class="media-actions">
      <button type="button" class="adm-icon" data-act="media-up" aria-label="Move earlier" ${i === 0 ? 'disabled' : ''}>←</button>
      <button type="button" class="adm-icon" data-act="media-down" aria-label="Move later" ${i === st.media.length - 1 ? 'disabled' : ''}>→</button>
      <button type="button" class="adm-icon" data-act="media-del" aria-label="Remove">✕</button>
    </div></li>`).join('')}</ul>`;
}

function reviewsHTML(st) {
  return st.reviews.map((r, i) => `<div class="review-row" data-i="${i}">
    <input type="text" value="${esc(r.author || '')}" data-rf="author" maxlength="60" placeholder="Name" aria-label="Reviewer name" />
    <select data-rf="rating" aria-label="Rating">${[5, 4, 3, 2, 1].map((n) => `<option value="${n}" ${Number(r.rating) === n ? 'selected' : ''}>${'★'.repeat(n)}</option>`).join('')}</select>
    <input type="text" value="${esc(r.title || '')}" data-rf="title" maxlength="120" placeholder="Title" aria-label="Review title" />
    <textarea data-rf="body" maxlength="2000" rows="2" placeholder="Review" aria-label="Review text">${esc(r.body || '')}</textarea>
    <label class="adm-check"><input type="checkbox" data-rf="is_published" ${r.is_published !== false ? 'checked' : ''} /> Show</label>
    <button type="button" class="adm-icon" data-act="review-del" aria-label="Delete review">✕</button>
  </div>`).join('') || '<p class="adm-muted">No reviews yet.</p>';
}

function fileSlot(label, url, act, accept, hint) {
  return `<div class="file-slot">
    <p class="file-label">${label}</p>
    ${url ? `<div class="file-current">${accept.startsWith('image') ? `<img src="${esc(url)}" alt="" />` : ''}<button type="button" class="adm-link" data-act="${act}-clear">Remove</button></div>` : ''}
    <label class="adm-btn adm-btn-line file-pick">${url ? 'Replace' : 'Upload'}<input type="file" accept="${accept}" data-upload="${act}" hidden /></label>
    <p class="adm-hint">${hint}</p>
    <div class="progress" data-progress="${act}" hidden><span></span></div>
  </div>`;
}

export async function renderEditor(host, { id }) {
  const { categories } = await get('/api/admin/categories');
  const st = id === 'new' ? blank(categories) : fromApi(await get(`/api/admin/products/${id}`), categories);
  const discounted = () => Math.round((Number(st.price) * (100 - (Number(st.discount_pct) || 0))) / 100);

  host.innerHTML = `
    <div class="adm-bar"><h1 class="adm-title">${st.id ? esc(st.name) : 'New product'}</h1>
      <div class="adm-bar-actions">${st.id && st.status === 'live' ? `<a class="adm-link" href="/product/${esc(st.slug)}" target="_blank" rel="noopener">View in shop ↗</a>` : ''}<a class="adm-link" href="/admin/products">← All products</a></div></div>
    <form class="editor" data-editor novalidate>
      <div class="editor-main">
        <section class="adm-card"><h2>Basics</h2>
          <div class="adm-field"><label for="e-name">Name</label><input id="e-name" data-k="name" value="${esc(st.name)}" maxlength="90" required /></div>
          <div class="adm-field"><label for="e-slug">Web address</label><div class="prefixed"><span>/product/</span><input id="e-slug" data-k="slug" value="${esc(st.slug)}" maxlength="80" pattern="[a-z0-9-]+" /></div></div>
          <div class="adm-row3">
            <div class="adm-field"><label for="e-cat">Category</label><select id="e-cat" data-k="category_id"><option value="">None</option>${opt(categories.map((c) => [c.id, c.name]), st.category_id)}</select></div>
            <div class="adm-field"><label for="e-type">Garment shape</label><select id="e-type" data-k="garment_type">${opt(GARMENTS, st.garment_type)}</select></div>
            <div class="adm-field"><label for="e-status">Status</label><select id="e-status" data-k="status">${opt(STATUS, st.status)}</select></div>
          </div>
          <label class="adm-check"><input type="checkbox" data-k="is_new" ${st.is_new ? 'checked' : ''} /> Show a “New” tag</label>
        </section>

        <section class="adm-card"><h2>Price</h2>
          <div class="adm-row3">
            <div class="adm-field"><label for="e-price">Price (MRP, ₹)</label><input id="e-price" type="number" min="1" step="1" inputmode="numeric" data-k="price" value="${esc(st.price)}" /></div>
            <div class="adm-field"><label for="e-disc">Discount (%)</label><input id="e-disc" type="number" min="0" max="90" step="1" inputmode="numeric" data-k="discount_pct" value="${esc(st.discount_pct)}" /></div>
            <div class="adm-field"><span class="label">Customers pay</span><p class="adm-big" data-pays>₹${discounted().toLocaleString('en-IN')}</p></div>
          </div>
        </section>

        <section class="adm-card"><h2>Colours</h2>
          <p class="adm-hint">Fabric colour, name shown to shoppers, and optionally the colour of the printed text.</p>
          <div data-colors>${colorsHTML(st)}</div>
          <button type="button" class="adm-btn adm-btn-line" data-act="color-add">Add colour</button>
        </section>

        <section class="adm-card"><h2>Sizes and stock</h2>
          <div class="adm-row3">
            <div class="adm-field adm-span2"><label for="e-sizes">Sizes (comma separated)</label><input id="e-sizes" data-sizes value="${esc(st.sizes.join(', '))}" /></div>
            <div class="adm-field"><label for="e-low">Alert me at (pieces left)</label><input id="e-low" type="number" min="0" max="1000" data-k="low" value="${esc(st.low)}" /></div>
          </div>
          <div class="adm-table-wrap" data-stock>${stockHTML(st)}</div>
          <p class="adm-hint">Stock is per colour and size. When a sold-out size goes above zero and you save, everyone waiting for it gets an email.</p>
        </section>

        <section class="adm-card"><h2>Design</h2>
          <div class="adm-row2">
            ${fileSlot('Front artwork', st.print_front_url, 'art-front', 'image/png,image/webp', 'Transparent PNG, 3:4 (e.g. 3000×4000 px). Replaces the front text.')}
            ${fileSlot('Back artwork', st.print_back_url, 'art-back', 'image/png,image/webp', 'Transparent PNG, 3:4. Replaces the back text.')}
          </div>
          <details class="adm-details" ${!st.print_front_url || !st.print_back_url ? 'open' : ''}><summary>Or print text instead</summary>
            <div class="adm-row2">
              <div class="adm-field"><label for="e-pf">Front text (one line per row)</label><textarea id="e-pf" data-k="printFront" rows="2">${esc(st.printFront)}</textarea></div>
              <div class="adm-field"><label for="e-pb">Back text (one line per row)</label><textarea id="e-pb" data-k="printBack" rows="2">${esc(st.printBack)}</textarea></div>
            </div>
            <div class="adm-field"><label for="e-ps">Small line under the back text</label><input id="e-ps" data-k="printSub" value="${esc(st.printSub)}" maxlength="40" /></div>
          </details>
        </section>

        <section class="adm-card"><h2>Description</h2>
          <div class="adm-field"><label for="e-desc">Description</label><textarea id="e-desc" data-k="description" rows="3" maxlength="4000">${esc(st.description)}</textarea></div>
          <div class="adm-field"><label for="e-det">Details (one per line)</label><textarea id="e-det" data-k="details" rows="4">${esc(st.details)}</textarea></div>
        </section>

        <section class="adm-card"><h2>Music</h2>
          <p class="adm-hint">Plays quietly (volume set in Settings) when a shopper opens this product. They can mute it.</p>
          <div class="adm-row2">
            ${fileSlot('Track', st.audio_url, 'audio', 'audio/mpeg,audio/mp4,audio/aac,audio/ogg,audio/wav', 'MP3 or M4A, up to 20 MB. Use music you have the rights to.')}
            <div class="adm-field"><label for="e-at">Track title (shown in the player)</label><input id="e-at" data-k="audio_title" value="${esc(st.audio_title)}" maxlength="120" />
              ${st.audio_url ? `<audio controls preload="none" src="${esc(st.audio_url)}" class="adm-audio"></audio>` : ''}</div>
          </div>
        </section>

        <section class="adm-card"><h2>Previews</h2>
          <div data-media>${mediaHTML(st)}</div>
          <label class="adm-btn adm-btn-line file-pick">Add photos or videos<input type="file" accept="image/jpeg,image/png,image/webp,video/mp4,video/webm,video/quicktime" multiple data-upload="media" hidden /></label>
          <p class="adm-hint">Photos up to 10 MB, videos up to 100 MB (MP4 works everywhere). Tag a colour to show it first when that colour is picked.</p>
          <div class="progress" data-progress="media" hidden><span></span></div>
        </section>

        <section class="adm-card"><h2>Reviews</h2>
          <div data-reviews>${reviewsHTML(st)}</div>
          <button type="button" class="adm-btn adm-btn-line" data-act="review-add">Add review</button>
        </section>
      </div>

      <aside class="editor-side">
        <div class="adm-card preview-card"><h2>Product images</h2>
          <div class="still-preview" data-preview><figure><img alt="Front preview" data-pv="front" /><figcaption>Front</figcaption></figure><figure><img alt="Back preview" data-pv="back" /><figcaption>Back</figcaption></figure></div>
          <div class="still-colors" data-pv-colors role="radiogroup" aria-label="Preview colour"></div>
          <p class="adm-hint">The shop shows these until you upload photos in Previews. They update as you edit.</p></div>
      </aside>

      <div class="save-bar"><p class="save-state" data-save-state></p><button type="submit" class="adm-btn">Save</button></div>
    </form>`;

  const form = host.querySelector('[data-editor]');
  const saveState = form.querySelector('[data-save-state]');
  let dirty = false;
  const setDirty = () => {
    dirty = true;
    saveState.textContent = 'Unsaved changes';
  };

  // still product images (front + back) for one colour
  let pvColor = null;
  let pvN = 0;
  let pTimer = 0;
  const pvColors = form.querySelector('[data-pv-colors]');
  const refreshPreview = () => {
    clearTimeout(pTimer);
    pTimer = setTimeout(async () => {
      const prod = previewProduct(st);
      if (!prod.colors.length) return;
      const col = prod.colors.find((c) => c.name === pvColor) || prod.colors[0];
      pvColor = col.name;
      pvColors.innerHTML = prod.colors.map((c) => `<button type="button" role="radio" aria-checked="${c.name === col.name}" title="${esc(c.name)}" aria-label="${esc(c.name)}" data-pvc="${esc(c.name)}" style="--sw:${esc(c.hex)}"></button>`).join('');
      prod.id = `preview-${++pvN}`; // fresh render every time
      const n = pvN;
      for (const side of ['front', 'back']) {
        try {
          const url = await thumbnail(prod, col, side);
          if (n === pvN) form.querySelector(`[data-pv="${side}"]`).src = url;
        } catch {
          /* no WebGL: the shop falls back to a flat silhouette */
        }
      }
    }, 350);
  };
  pvColors.addEventListener('click', (e) => {
    const b = e.target.closest('[data-pvc]');
    if (b) (pvColor = b.dataset.pvc), refreshPreview();
  });
  refreshPreview();

  const rerender = (sel, html) => (form.querySelector(sel).innerHTML = html);

  form.addEventListener('input', (e) => {
    const t = e.target;
    if (t.dataset.k) {
      st[t.dataset.k] = t.type === 'checkbox' ? t.checked : t.value;
      if (t.dataset.k === 'name' && !st.slugTouched) form.querySelector('#e-slug').value = st.slug = slugify(st.name);
      if (t.dataset.k === 'slug') st.slugTouched = true;
      if (t.dataset.k === 'price' || t.dataset.k === 'discount_pct') form.querySelector('[data-pays]').textContent = `₹${discounted().toLocaleString('en-IN')}`;
      if (['garment_type', 'printFront', 'printBack', 'printSub'].includes(t.dataset.k)) refreshPreview();
      if (t.dataset.k === 'low') rerender('[data-stock]', stockHTML(st));
    } else if (t.dataset.f) {
      const c = st.colors[Number(t.closest('[data-i]').dataset.i)];
      if (t.dataset.f === 'name') {
        const old = c.name;
        c.name = t.value;
        for (const s of st.sizes) if (st.stock[`${old}|${s}`]) (st.stock[`${c.name}|${s}`] = st.stock[`${old}|${s}`]), delete st.stock[`${old}|${s}`];
        st.media.forEach((m) => m.color === old && (m.color = c.name));
      } else if (t.dataset.f === 'hex') c.hex = t.value;
      else if (t.dataset.f === 'ink_hex' || t.dataset.f === 'ink_on') {
        const row = t.closest('.color-row');
        c.ink_hex = row.querySelector('[data-f=ink_on]').checked ? row.querySelector('[data-f=ink_hex]').value : '';
      }
      if (e.type === 'input' && t.dataset.f !== 'name') refreshPreview();
    } else if (t.dataset.stock) {
      st.stock[t.dataset.stock] = { ...(st.stock[t.dataset.stock] || {}), stock: Math.max(0, Number(t.value) || 0) };
    } else if (t.dataset.sizes !== undefined) {
      st.sizes = [...new Set(t.value.split(',').map((s) => s.trim().toUpperCase()).filter(Boolean))].slice(0, 15);
      rerender('[data-stock]', stockHTML(st));
    } else if (t.dataset.mf) {
      st.media[Number(t.closest('[data-i]').dataset.i)][t.dataset.mf] = t.value;
    } else if (t.dataset.rf) {
      st.reviews[Number(t.closest('[data-i]').dataset.i)][t.dataset.rf] = t.type === 'checkbox' ? t.checked : t.value;
    }
    setDirty();
  });
  form.addEventListener('change', (e) => {
    if (e.target.dataset.f === 'name') {
      rerender('[data-stock]', stockHTML(st));
      rerender('[data-media]', mediaHTML(st));
      refreshPreview();
    }
    if (e.target.dataset.f === 'ink_on') refreshPreview();
  });

  form.addEventListener('click', (e) => {
    const b = e.target.closest('[data-act]');
    if (!b) return;
    const act = b.dataset.act;
    const i = Number(b.closest('[data-i]')?.dataset.i);
    if (act === 'color-add') st.colors.push({ name: `Colour ${st.colors.length + 1}`, hex: '#ee6522', ink_hex: '' });
    if (act === 'color-del') st.colors.splice(i, 1);
    if (act.startsWith('color')) {
      rerender('[data-colors]', colorsHTML(st));
      rerender('[data-stock]', stockHTML(st));
      refreshPreview();
    }
    if (act === 'media-up' || act === 'media-down') {
      const j = act === 'media-up' ? i - 1 : i + 1;
      [st.media[i], st.media[j]] = [st.media[j], st.media[i]];
    }
    if (act === 'media-del') st.media.splice(i, 1);
    if (act.startsWith('media')) rerender('[data-media]', mediaHTML(st));
    if (act === 'review-add') st.reviews.unshift({ author: '', rating: 5, title: '', body: '', is_published: true });
    if (act === 'review-del') st.reviews.splice(i, 1);
    if (act.startsWith('review')) rerender('[data-reviews]', reviewsHTML(st));
    if (act === 'art-front-clear') (st.print_front_url = null), renderEditorFiles();
    if (act === 'art-back-clear') (st.print_back_url = null), renderEditorFiles();
    if (act === 'audio-clear') (st.audio_url = null), renderEditorFiles();
    setDirty();
  });

  // file slots re-render in place (keeps the rest of the form as typed)
  function renderEditorFiles() {
    const slots = form.querySelectorAll('.file-slot');
    const specs = [
      ['Front artwork', st.print_front_url, 'art-front', 'image/png,image/webp', 'Transparent PNG, 3:4 (e.g. 3000×4000 px). Replaces the front text.'],
      ['Back artwork', st.print_back_url, 'art-back', 'image/png,image/webp', 'Transparent PNG, 3:4. Replaces the back text.'],
      ['Track', st.audio_url, 'audio', 'audio/mpeg,audio/mp4,audio/aac,audio/ogg,audio/wav', 'MP3 or M4A, up to 20 MB. Use music you have the rights to.'],
    ];
    slots.forEach((el, k) => (el.outerHTML = fileSlot(...specs[k])));
    const player = form.querySelector('.adm-audio');
    if (player && !st.audio_url) player.remove();
    if (st.audio_url) {
      if (player) player.src = st.audio_url;
      else form.querySelector('#e-at').insertAdjacentHTML('afterend', `<audio controls preload="none" src="${esc(st.audio_url)}" class="adm-audio"></audio>`);
    }
    refreshPreview();
  }

  form.addEventListener('change', async (e) => {
    const inp = e.target.closest('[data-upload]');
    if (!inp || !inp.files.length) return;
    const kind = inp.dataset.upload;
    const bar = form.querySelector(`[data-progress="${kind}"]`);
    const fill = bar.querySelector('span');
    const progress = (f) => (fill.style.width = `${Math.round(f * 100)}%`);
    bar.hidden = false;
    const slug = st.slug || slugify(st.name) || 'unsorted';
    try {
      if (kind === 'media') {
        const files = [...inp.files];
        for (let k = 0; k < files.length; k++) {
          const f = files[k];
          const isVideo = f.type.startsWith('video/');
          const url = await upload(f, isVideo ? 'video' : 'image', slug, (x) => progress((k + x) / files.length));
          let poster = null;
          if (isVideo) {
            const pf = await posterFrom(f);
            if (pf) poster = await upload(pf, 'image', slug).catch(() => null);
          }
          st.media.push({ kind: isVideo ? 'video' : 'image', url, poster_url: poster, alt: '', color: null });
        }
        rerender('[data-media]', mediaHTML(st));
      } else {
        const url = await upload(inp.files[0], kind === 'audio' ? 'audio' : 'design', slug, progress);
        if (kind === 'art-front') st.print_front_url = url;
        if (kind === 'art-back') st.print_back_url = url;
        if (kind === 'audio') {
          st.audio_url = url;
          if (!st.audio_title) st.audio_title = inp.files[0].name.replace(/\.[^.]+$/, '').slice(0, 120);
        }
        renderEditorFiles();
        if (kind === 'audio') form.querySelector('#e-at').value = st.audio_title;
      }
      setDirty();
      flash(host, 'Uploaded. Save to publish the change.');
    } catch (err) {
      flash(host, err.message, 'error');
    } finally {
      bar.hidden = true;
      fill.style.width = '0';
    }
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    form.querySelectorAll('[aria-invalid]').forEach((x) => x.removeAttribute('aria-invalid'));
    if (!st.slug) st.slug = slugify(st.name);
    const names = st.colors.map((c) => c.name.trim());
    if (new Set(names).size !== names.length || names.some((n) => !n)) return flash(host, 'Each colour needs its own name.', 'error');
    const btn = form.querySelector('[type=submit]');
    btn.disabled = true;
    saveState.textContent = 'Saving…';
    try {
      const r = await post('/api/admin/products', toApi(st));
      dirty = false;
      saveState.textContent = `Saved ${new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}`;
      flash(host, r.restockEmails ? `Saved. ${r.restockEmails} shopper${r.restockEmails === 1 ? '' : 's'} emailed that it’s back in stock.` : 'Saved.');
      if (!st.id) return navigate(`/admin/products?edit=${r.id}`, { replace: true });
      const fresh = fromApi(await get(`/api/admin/products/${r.id}`), categories);
      Object.assign(st, { stock: fresh.stock, reviews: fresh.reviews });
      rerender('[data-stock]', stockHTML(st));
    } catch (err) {
      saveState.textContent = 'Not saved';
      flash(host, err.message, 'error');
      const map = { name: '#e-name', slug: '#e-slug', discount_pct: '#e-disc' };
      const el = map[err.field] && form.querySelector(map[err.field]);
      if (el) el.setAttribute('aria-invalid', 'true'), el.focus();
    } finally {
      btn.disabled = false;
    }
  });

  const beforeUnload = (e) => dirty && (e.preventDefault(), (e.returnValue = ''));
  addEventListener('beforeunload', beforeUnload);
  return () => {
    removeEventListener('beforeunload', beforeUnload);
  };
}

export async function setStatus(id, status) {
  return put(`/api/admin/products/${id}/status`, { status });
}
