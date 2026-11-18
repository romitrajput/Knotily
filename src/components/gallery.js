// Product previews uploaded by the owner: photos and videos, plus a lightbox.
// Media tagged with a colour is shown first when that colour is selected.
import { esc } from '../lib/util.js';
import { track } from '../lib/analytics.js';

export function galleryHTML(p, colorName) {
  if (!p.media?.length) return '';
  return `
    <section class="section gallery" aria-labelledby="gal-title">
      <div class="section-head"><h2 id="gal-title" class="display-sm">Previews</h2><p>Photos and video of the real piece.</p></div>
      <div class="gal-strip" data-gallery>${itemsHTML(p, colorName)}</div>
      <dialog class="gal-lightbox" data-lightbox aria-label="Photo">
        <form method="dialog"><button class="icon-btn gal-lightbox-close" aria-label="Close"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg></button></form>
        <img alt="" data-lightbox-img />
      </dialog>
    </section>`;
}

function itemsHTML(p, colorName) {
  const sorted = [...p.media].sort((a, b) => Number(b.color === colorName) - Number(a.color === colorName));
  return sorted
    .map((m, i) => {
      const alt = m.alt || `${p.name}${m.color ? ` in ${m.color}` : ''}, preview ${i + 1}`;
      if (m.kind === 'video') {
        return `<figure class="gal-item gal-video"><video src="${esc(m.url)}" ${m.poster_url ? `poster="${esc(m.poster_url)}"` : ''} controls playsinline preload="metadata" data-media="${esc(m.id)}" aria-label="${esc(alt)}"></video></figure>`;
      }
      return `<figure class="gal-item"><button type="button" class="gal-open" data-full="${esc(m.url)}" data-alt="${esc(alt)}" data-media="${esc(m.id)}" aria-label="View larger: ${esc(alt)}"><img src="${esc(m.url)}" alt="${esc(alt)}" loading="lazy" decoding="async" /></button></figure>`;
    })
    .join('');
}

export function mountGallery(root, p) {
  const strip = root.querySelector('[data-gallery]');
  if (!strip) return { setColor() {} };
  const dlg = root.querySelector('[data-lightbox]');
  const img = root.querySelector('[data-lightbox-img]');
  strip.addEventListener('click', (e) => {
    const b = e.target.closest('.gal-open');
    if (!b) return;
    img.src = b.dataset.full;
    img.alt = b.dataset.alt;
    track('media_view', { product_id: p.id, media_id: b.dataset.media });
    if (dlg.showModal) dlg.showModal();
    else window.open(b.dataset.full, '_blank', 'noopener');
  });
  dlg?.addEventListener('click', (e) => e.target === dlg && dlg.close());
  strip.addEventListener('play', (e) => track('video_play', { product_id: p.id, media_id: e.target.dataset.media }), true);
  return {
    setColor(name) {
      strip.innerHTML = itemsHTML(p, name);
    },
  };
}

export function starsHTML(avg, { label = true } = {}) {
  const full = Math.round(avg * 2) / 2;
  const stars = [1, 2, 3, 4, 5].map((i) => `<span class="star ${full >= i ? 'on' : full >= i - 0.5 ? 'half' : ''}" aria-hidden="true">★</span>`).join('');
  return `<span class="stars" ${label ? `role="img" aria-label="${avg} out of 5 stars"` : 'aria-hidden="true"'}>${stars}</span>`;
}

export function reviewsHTML(p) {
  const list = p.reviews || [];
  if (!list.length) return '';
  const avg = p.rating?.avg ?? (list.reduce((s, r) => s + r.rating, 0) / list.length).toFixed(1);
  return `
    <section class="section reviews" id="reviews" aria-labelledby="rev-title">
      <div class="section-head">
        <h2 id="rev-title" class="display-sm">Reviews</h2>
        <p class="rev-avg">${starsHTML(Number(avg))} <strong>${esc(avg)}</strong> from ${list.length} review${list.length === 1 ? '' : 's'}</p>
      </div>
      <ul class="rev-list">
        ${list
          .map(
            (r) => `<li class="rev">
              <p class="rev-head">${starsHTML(r.rating)}${r.title ? ` <strong>${esc(r.title)}</strong>` : ''}</p>
              ${r.body ? `<p class="rev-body">${esc(r.body)}</p>` : ''}
              <p class="rev-by">${esc(r.author)}${r.date ? ` · ${new Date(r.date).toLocaleDateString('en-IN', { month: 'short', year: 'numeric' })}` : ''}</p>
            </li>`
          )
          .join('')}
      </ul>
    </section>`;
}
