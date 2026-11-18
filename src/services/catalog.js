// Catalogue service: the only place pages get product data from.
// Loads /api/catalog once per visit (the API is cached at the edge for 30 s) and maps
// the database shape onto the shape the pages and the 3D garment engine use.
import { get } from '../lib/api.js';
import { applyStoreSettings } from '../config.js';

let PRODUCTS = [];
let CATEGORIES = [];
let BANNERS = [];
let byId = new Map();
let bySlug = new Map();
let loading = null;
let loadedAt = 0;

const SIZE_ORDER = ['One size', 'XXS', 'XS', 'S', 'M', 'L', 'XL', 'XXL', '3XL', '4XL'];
const sizeRank = (s) => {
  const i = SIZE_ORDER.indexOf(s);
  return i === -1 ? 100 + (parseFloat(s) || 0) : i;
};

// API product -> page product
export function adapt(api) {
  const trims = api.print_spec?.trims || {};
  const colors = (api.colors || []).map((c) => ({ id: c.id, name: c.name, hex: c.hex, ...(c.ink ? { ink: c.ink } : {}), ...(trims[c.name] || {}) }));
  const variants = (api.variants || []).map((v) => ({ id: v.id, colorId: v.color_id, size: v.size, sku: v.sku, available: v.available, state: v.state }));
  const sizes = [...new Set(variants.map((v) => v.size))].sort((a, b) => sizeRank(a) - sizeRank(b));
  const colorById = new Map(colors.map((c) => [c.id, c]));
  const media = (api.media || []).map((m) => ({ ...m, color: m.color_id ? colorById.get(m.color_id)?.name || null : null }));
  const anyLow = variants.some((v) => v.state === 'low');
  const allOut = variants.length > 0 && variants.every((v) => v.state === 'out');
  const { trims: _t, ...print } = api.print_spec || {};
  return {
    id: api.id,
    slug: api.slug,
    name: api.name,
    category: api.category?.slug || 'other',
    categoryName: api.category?.name || '',
    art: api.garment_type,
    price: api.price_paise / 100,
    compareAt: api.discount_pct > 0 ? api.mrp_paise / 100 : null,
    discountPct: api.discount_pct || 0,
    isNew: !!api.is_new,
    stock: allOut ? 'out' : anyLow ? 'low' : 'in',
    colors,
    sizes,
    variants,
    print,
    artwork: { front: api.print_front_url || null, back: api.print_back_url || null },
    audio: api.audio_url ? { url: api.audio_url, title: api.audio_title || '' } : null,
    media,
    description: api.description || '',
    details: api.details || [],
    rating: api.rating?.count ? api.rating : null,
    reviews: api.reviews || null,
  };
}

function index(list) {
  PRODUCTS = list;
  byId = new Map(list.map((p) => [p.id, p]));
  bySlug = new Map(list.map((p) => [p.slug, p]));
}

export function loadCatalog({ force = false } = {}) {
  if (force || !loading || Date.now() - loadedAt > 5 * 60 * 1000) {
    loading = get('/api/catalog')
      .then((data) => {
        CATEGORIES = (data.categories || []).map((c) => ({ id: c.slug, uuid: c.id, label: c.name, blurb: c.description || '' }));
        index((data.products || []).map(adapt));
        BANNERS = data.banners || [];
        applyStoreSettings(data.settings || {});
        loadedAt = Date.now();
        return PRODUCTS;
      })
      .catch((e) => {
        loading = null;
        throw e;
      });
  }
  return loading;
}

export async function listProducts({ category, sort = 'featured' } = {}) {
  await loadCatalog();
  let items = PRODUCTS.slice();
  if (category && category !== 'all') items = items.filter((p) => p.category === category);
  switch (sort) {
    case 'new':
      items.sort((a, b) => Number(b.isNew) - Number(a.isNew));
      break;
    case 'price-asc':
      items.sort((a, b) => a.price - b.price);
      break;
    case 'price-desc':
      items.sort((a, b) => b.price - a.price);
      break;
    default:
      break;
  }
  return items;
}

// Product page: always fetch fresh stock and the reviews.
export async function getProduct(slug) {
  await loadCatalog().catch(() => {});
  try {
    const { product } = await get(`/api/catalog/${encodeURIComponent(slug)}`);
    const p = adapt(product);
    byId.set(p.id, p);
    bySlug.set(p.slug, p);
    const i = PRODUCTS.findIndex((x) => x.id === p.id);
    if (i >= 0) PRODUCTS[i] = p;
    return p;
  } catch (e) {
    if (e.status === 404 || e.code === 'NOT_FOUND' || e.code === 'INVALID') return null;
    throw e;
  }
}

export const allProducts = () => PRODUCTS;
export const getProductById = (id) => byId.get(id) || null;
export const getProductBySlug = (slug) => bySlug.get(slug) || null;

export async function getRelated(product, n = 4) {
  await loadCatalog();
  const same = PRODUCTS.filter((p) => p.id !== product.id && p.category === product.category);
  const other = PRODUCTS.filter((p) => p.id !== product.id && p.category !== product.category);
  return [...same, ...other].slice(0, n);
}

export const listCategories = () => CATEGORIES;
// Owner-managed homepage content: 'announcement' | 'hero' | 'strip' | 'tile'
export const getBanners = (placement) => BANNERS.filter((b) => b.placement === placement);
export const getCategory = (slug) => CATEGORIES.find((c) => c.id === slug) || null;

// Variant helpers
export const variantFor = (p, colorName, size) => {
  const c = p.colors.find((x) => x.name === colorName);
  return c ? p.variants.find((v) => v.colorId === c.id && v.size === size) || null : null;
};
export const sizesFor = (p, colorName) => {
  const c = p.colors.find((x) => x.name === colorName) || p.colors[0];
  return p.sizes.map((size) => ({ size, variant: p.variants.find((v) => v.colorId === c?.id && v.size === size) || null }));
};

// Updates one variant's availability after the server tells us something newer.
export function patchVariant(variantId, { available, state }) {
  for (const p of PRODUCTS) {
    const v = p.variants.find((x) => x.id === variantId);
    if (v) {
      if (available !== undefined) v.available = available;
      if (state) v.state = state;
    }
  }
}
