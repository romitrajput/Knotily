// Product page: gallery (photos / still views / videos for the chosen colour) on the left,
// sticky details on the right. Same buying logic as before: live stock per size, account
// check, Remind me when sold out, Buy now → checkout. Picking a colour gently tints the gallery.
import { getProduct, getRelated, getCategory } from '../services/catalog.js';
import { productRow } from '../components/productCard.js';
import { galleryItems, stillHTML, hydrate } from '../components/media.js';
import { buyBoxHTML, mountBuyBox } from '../components/buyBox.js';
import { reviewsHTML, starsHTML } from '../components/gallery.js';
import { playProductAudio, stopProductAudio } from '../components/productAudio.js';
import { flyToBag } from '../components/flyToBag.js';
import { toggleWish, isWished, onWishlist } from '../store/wishlist.js';
import { badgeFor } from '../components/productCard.js';
import { icons } from '../components/icons.js';
import { toast } from '../components/toast.js';
import { track } from '../lib/analytics.js';
import { formatPrice, esc, $, $$ } from '../lib/util.js';
import { config } from '../config.js';

export function priceHTML(p) {
  return `${p.compareAt ? `<s>${formatPrice(p.compareAt)}</s> ` : ''}<span class="${p.compareAt ? 'sale' : ''}">${formatPrice(p.price)}</span>${p.discountPct ? ` <span class="off">${p.discountPct}% off</span>` : ''}`;
}

function galleryHTML(p, c) {
  const items = galleryItems(p, c);
  return items
    .map((it, i) => {
      const label = `${p.name} in ${c.name}, view ${i + 1} of ${items.length}`;
      let inner;
      if (it.kind === 'still') inner = stillHTML(p, c, it.side);
      else if (it.kind === 'image') inner = `<img src="${esc(it.url)}" alt="${esc(it.alt || label)}" ${i < 2 ? '' : 'loading="lazy"'} decoding="async" />`;
      else inner = `<video src="${esc(it.url)}" ${it.poster ? `poster="${esc(it.poster)}"` : ''} controls playsinline preload="metadata" aria-label="${esc(it.alt || `${p.name} video`)}"></video>`;
      return `<figure class="pg-item ${it.kind === 'video' ? 'is-video' : ''}" data-i="${i}">
        ${it.kind === 'video' ? inner : `<button type="button" class="pg-zoom" aria-label="Zoom: ${esc(label)}">${inner}</button>`}</figure>`;
    })
    .join('');
}

export default async function product({ params, query }) {
  const p = await getProduct(params.slug);
  if (!p) return (await import('./notFound.js')).default();
  const related = await getRelated(p, 8);
  const cat = getCategory(p.category);
  let color = p.colors.find((c) => c.name === query.color) || p.colors[0];
  const badge = badgeFor(p);

  return {
    name: 'product',
    title: p.name,
    description: p.description,
    html: `
    <div class="wrap pdp-wrap">
      <nav class="crumbs" aria-label="Breadcrumb"><ol><li><a href="/">Home</a></li>${cat ? `<li><a href="/shop/${esc(cat.id)}">${esc(cat.label)}</a></li>` : '<li><a href="/shop">Shop</a></li>'}<li aria-current="page">${esc(p.name)}</li></ol></nav>
      <section class="pdp">
        <div class="pdp-gallery" data-gal-wrap style="--tint:${esc(color.hex)}">
          <div class="pg" data-gallery>${galleryHTML(p, color)}</div>
          <div class="pg-dots" data-dots aria-hidden="true"></div>
        </div>

        <div class="pdp-info">
          ${badge ? `<span class="badge ${badge.cls} badge-inline">${badge.text}</span>` : ''}
          <h1 class="pdp-name">${esc(p.name)}</h1>
          <p class="pdp-price">${priceHTML(p)}</p>
          <p class="pdp-tax">Inclusive of all taxes</p>
          ${p.rating ? `<a class="pdp-rating" href="#reviews">${starsHTML(Number(p.rating.avg))}<span>${esc(p.rating.avg)} · ${p.rating.count} review${p.rating.count === 1 ? '' : 's'}</span></a>` : ''}

          <form class="pdp-form" data-pdp-form novalidate>
            ${p.colors.length > 1 || p.colors[0]?.name ? `<fieldset class="colors">
              <legend>Colour: <strong data-color-name>${esc(color.name)}</strong></legend>
              <div class="color-row" role="radiogroup" aria-label="Colour">
                ${p.colors.map((c) => `<button type="button" class="swatch" role="radio" aria-checked="${c.name === color.name}" aria-label="${esc(c.name)}" title="${esc(c.name)}" data-color="${esc(c.name)}" style="--sw:${esc(c.hex)}"></button>`).join('')}
              </div></fieldset>` : ''}
            ${buyBoxHTML()}
            <button type="button" class="btn btn-line btn-block wish-btn" data-wish-btn aria-pressed="${isWished(p.id)}">${icons.heart}<span>${isWished(p.id) ? 'Saved to wishlist' : 'Add to wishlist'}</span></button>
          </form>

          <ul class="pdp-promises">
            <li>${icons.truck}<span>${p.price >= config.freeShippingThreshold ? 'Free shipping' : `Free shipping over ${formatPrice(config.freeShippingThreshold)}`} · dispatched in 2–3 working days</span></li>
            <li>${icons.refresh}<span>7-day returns on unworn pieces</span></li>
            <li>${icons.lock}<span>Secure payment: UPI, cards, net banking</span></li>
          </ul>

          <div class="accordion">
            ${p.description ? `<details open><summary>Description</summary><p>${esc(p.description)}</p></details>` : ''}
            ${p.details.length ? `<details><summary>Details and care</summary><ul>${p.details.map((d) => `<li>${esc(d)}</li>`).join('')}</ul></details>` : ''}
            <details><summary>Size guide</summary>
              <table class="size-table"><caption class="sr-only">Garment measurements in centimetres</caption>
                <thead><tr><th scope="col">Size</th><th scope="col">Chest</th><th scope="col">Length</th></tr></thead>
                <tbody>
                  <tr><th scope="row">XS</th><td>104</td><td>68</td></tr><tr><th scope="row">S</th><td>110</td><td>70</td></tr>
                  <tr><th scope="row">M</th><td>116</td><td>72</td></tr><tr><th scope="row">L</th><td>122</td><td>74</td></tr>
                  <tr><th scope="row">XL</th><td>128</td><td>76</td></tr><tr><th scope="row">XXL</th><td>134</td><td>78</td></tr>
                </tbody></table>
              <p>Garment measurements in centimetres. Oversized pieces are cut big on purpose: size down for a closer fit.</p></details>
            <details><summary>Shipping and returns</summary><p>Dispatched in 2–3 working days across India. Return unworn pieces with tags within 7 days of delivery for a refund to your original payment method.</p></details>
          </div>
        </div>
      </section>

      ${reviewsHTML(p)}
      ${productRow('You may also like', related, cat ? `/shop/${cat.id}` : '/shop')}
    </div>
    <dialog class="zoom" data-zoom aria-label="Zoomed image"><form method="dialog"><button class="icon zoom-close" aria-label="Close">${icons.close}</button></form><div class="zoom-body" data-zoom-body></div></dialog>`,

    mount(root) {
      const form = $('[data-pdp-form]', root);
      const gal = $('[data-gallery]', root);
      const galWrap = $('[data-gal-wrap]', root);
      const dots = $('[data-dots]', root);
      const colorName = $('[data-color-name]', root);
      const wishBtn = $('[data-wish-btn]', root);

      const drawDots = () => {
        const n = gal.children.length;
        dots.innerHTML = n > 1 ? Array.from({ length: n }, (_, i) => `<i ${i === 0 ? 'class="on"' : ''}></i>`).join('') : '';
      };
      gal.addEventListener('scroll', () => {
        const i = Math.round(gal.scrollLeft / gal.clientWidth);
        [...dots.children].forEach((d, k) => d.classList.toggle('on', k === i));
      }, { passive: true });

      const box = mountBuyBox(form, {
        product: p,
        color,
        source: 'pdp',
        beforeNavigate: () => flyToBag(gal.querySelector('.pg-item')),
      });

      root.querySelector('.color-row')?.addEventListener('click', (e) => {
        const b = e.target.closest('[data-color]');
        if (!b || box.busy()) return;
        const c = p.colors.find((x) => x.name === b.dataset.color);
        if (!c || c.name === color.name) return;
        color = c;
        $$('.swatch', root).forEach((s) => s.setAttribute('aria-checked', String(s === b)));
        colorName.textContent = c.name;
        galWrap.style.setProperty('--tint', c.hex);
        gal.innerHTML = galleryHTML(p, c);
        gal.scrollLeft = 0;
        drawDots();
        hydrate(gal);
        box.setColor(c);
        track('color_change', { product_id: p.id, color: c.name });
        const url = new URL(location.href);
        url.searchParams.set('color', c.name);
        history.replaceState(history.state, '', url.pathname + url.search);
      });

      const syncWish = () => {
        const on = isWished(p.id);
        wishBtn.setAttribute('aria-pressed', String(on));
        wishBtn.querySelector('span').textContent = on ? 'Saved to wishlist' : 'Add to wishlist';
      };
      wishBtn.addEventListener('click', async () => {
        try {
          const on = await toggleWish(p);
          if (on !== null) {
            syncWish();
            toast(on ? 'Saved to your wishlist.' : 'Removed from your wishlist.', on ? { action: { label: 'View', onClick: () => import('../router.js').then((m) => m.navigate('/wishlist')) } } : {});
          }
        } catch (err) {
          toast(esc(err.message));
        }
      });

      // zoom
      const zoom = $('[data-zoom]', root);
      gal.addEventListener('click', (e) => {
        const z = e.target.closest('.pg-zoom');
        if (!z || !zoom.showModal) return;
        const img = z.querySelector('img, svg');
        $('[data-zoom-body]', root).innerHTML = img ? img.outerHTML : '';
        zoom.showModal();
        track('media_view', { product_id: p.id, color: color.name });
      });
      zoom.addEventListener('click', (e) => e.target === zoom && zoom.close());
      gal.addEventListener('play', () => track('video_play', { product_id: p.id }), true);

      const offWish = onWishlist(syncWish);
      drawDots();
      hydrate(root);
      track('product_view', { product_id: p.id, color: color.name, price: p.price });
      playProductAudio(p);
      return () => {
        offWish();
        stopProductAudio();
      };
    },
  };
}
