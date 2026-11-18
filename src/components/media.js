// One place that decides how a product image is shown:
// the owner's photos (when uploaded) → a still studio-style render of the garment
// (made once in the browser, no animation) → a flat silhouette (no WebGL).
import { hasWebGL, hydrateThumbs } from '../gl/garments.js';
import { silhouetteSVG } from '../gl/garmentTypes.js';
import { getProductById } from '../services/catalog.js';
import { esc } from '../lib/util.js';

const BLANK = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';

// Owner photos for a colour: photos tagged with that colour first, then untagged ones.
export function photosFor(p, colorName) {
  const imgs = (p.media || []).filter((m) => m.kind === 'image');
  return [...imgs.filter((m) => m.color === colorName), ...imgs.filter((m) => !m.color)];
}

function still(p, c, side, alt) {
  if (!hasWebGL()) return silhouetteSVG(p.art, c.hex, esc(alt));
  return `<img data-thumb="${p.id}|${esc(c.name)}|${side}" src="${BLANK}" alt="${esc(alt)}" decoding="async" />`;
}

// side: 'front' | 'back'. photoIndex picks which owner photo (0 = main, 1 = hover).
export function garmentImg(p, color, { side = 'front', eager = false, photoIndex = side === 'back' ? 1 : 0 } = {}) {
  const c = color || p.colors[0];
  const alt = `${p.name} in ${c.name}${side === 'back' ? ', back' : ''}`;
  const photos = photosFor(p, c.name);
  if (photos.length) {
    const ph = photos[photoIndex];
    if (!ph) return '';
    return `<img src="${esc(ph.url)}" alt="${esc(ph.alt || alt)}" loading="${eager ? 'eager' : 'lazy'}" decoding="async" />`;
  }
  return still(p, c, side, alt);
}

// Every image for the product page gallery, for one colour.
export function galleryItems(p, c) {
  const photos = photosFor(p, c.name);
  const items = [];
  if (!photos.length || photos.length < 2) {
    items.push({ kind: 'still', side: 'front' }, { kind: 'still', side: 'back' });
  }
  for (const m of photos) items.push({ kind: 'image', url: m.url, alt: m.alt });
  for (const m of (p.media || []).filter((x) => x.kind === 'video' && (!x.color || x.color === c.name))) items.push({ kind: 'video', url: m.url, poster: m.poster_url, alt: m.alt });
  // with two or more owner photos, the stills move to the end as "flat" views
  if (photos.length >= 2) items.push({ kind: 'still', side: 'front' }, { kind: 'still', side: 'back' });
  return items;
}

export const stillHTML = (p, c, side) => still(p, c, side, `${p.name} in ${c.name}${side === 'back' ? ', back' : ', front'}`);

export const hydrate = (root) => hydrateThumbs(root, getProductById);
