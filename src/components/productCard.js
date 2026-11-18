// Product tile: image (second view on hover), badge, wishlist heart, name, price, colours.
import { garmentImg } from './media.js';
import { heartButton } from '../store/wishlist.js';
import { formatPrice, esc } from '../lib/util.js';

export function badgeFor(p) {
  if (p.stock === 'out') return { text: 'Sold out', cls: 'badge-out' };
  if (p.discountPct) return { text: `${p.discountPct}% off`, cls: 'badge-sale' };
  if (p.stock === 'low') return { text: 'Few left', cls: 'badge-low' };
  if (p.isNew) return { text: 'New', cls: '' };
  return null;
}

export function productCard(p, { eager = false } = {}) {
  const c = p.colors[0];
  const badge = badgeFor(p);
  const back = garmentImg(p, c, { side: 'back' });
  return `
    <article class="card ${p.stock === 'out' ? 'is-out' : ''}">
      <div class="card-media">
        <a class="card-link" href="/product/${esc(p.slug)}" aria-label="${esc(p.name)}, ${formatPrice(p.price)}">
          <span class="card-img card-front">${garmentImg(p, c, { eager })}</span>
          ${back ? `<span class="card-img card-back" aria-hidden="true">${back}</span>` : ''}
        </a>
        ${badge ? `<span class="badge ${badge.cls}">${badge.text}</span>` : ''}
        ${heartButton(p, 'card-wish')}
      </div>
      <a class="card-info" href="/product/${esc(p.slug)}" tabindex="-1">
        <h3 class="card-name">${esc(p.name)}</h3>
        <p class="card-price">${p.compareAt ? `<s>${formatPrice(p.compareAt)}</s> ` : ''}<span class="${p.compareAt ? 'sale' : ''}">${formatPrice(p.price)}</span></p>
      </a>
      ${p.colors.length > 1 ? `<ul class="swatches" aria-label="${p.colors.length} colours: ${p.colors.map((x) => esc(x.name)).join(', ')}">
        ${p.colors.slice(0, 5).map((x) => `<li style="--sw:${esc(x.hex)}" title="${esc(x.name)}"></li>`).join('')}${p.colors.length > 5 ? `<li class="more">+${p.colors.length - 5}</li>` : ''}</ul>` : ''}
    </article>`;
}

// Horizontal row (scrolls on phones, 4-up on desktop) with a heading and "View all".
export function productRow(title, products, href, { id = '' } = {}) {
  if (!products.length) return '';
  return `
    <section class="row-sec" ${id ? `id="${id}"` : ''} aria-label="${esc(title)}">
      <div class="row-head"><h2 class="sec-title">${esc(title)}</h2>${href ? `<a class="view-all" href="${esc(href)}">View all</a>` : ''}</div>
      <div class="row-scroll">${products.map((p) => productCard(p)).join('')}</div>
    </section>`;
}
