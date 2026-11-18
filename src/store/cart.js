// Bag store. The bag lives on the server (per account) so stock is checked in the
// database on every change; this module keeps the latest copy and notifies the UI.
// Prices always come from the server, so a stale page can never carry an old price.
import { get, put, del } from '../lib/api.js';
import { getProductById, loadCatalog, patchVariant } from '../services/catalog.js';
import { currentUser, onSession } from './session.js';
import { config } from '../config.js';

let raw = null; // last /api/cart answer
const listeners = new Set();
let held = 0;
let pending = false;

function emit() {
  if (held) {
    pending = true;
    return;
  }
  const s = snapshot();
  listeners.forEach((fn) => fn(s));
}

// Hold back UI updates (bag count, drawer) while an animation is still carrying the item to the bag.
export function holdUpdates() {
  held++;
}
export function releaseUpdates() {
  held = Math.max(0, held - 1);
  if (!held && pending) {
    pending = false;
    emit();
  }
}

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function store(r) {
  raw = r;
  (r?.items || []).forEach((i) => patchVariant(i.variant_id, { available: i.available, state: i.state }));
  emit();
  return snapshot();
}

export async function refresh() {
  if (!currentUser()) {
    raw = null;
    emit();
    return snapshot();
  }
  await loadCatalog().catch(() => {});
  return store(await get('/api/cart'));
}

// Throws ApiError OUT_OF_STOCK / INSUFFICIENT_STOCK / SIGN_IN_REQUIRED for the caller to handle.
export async function add(variantId, qty = 1) {
  return store(await put('/api/cart/items', { variantId, qty, mode: 'add' }));
}
export async function setQty(variantId, qty) {
  return store(await put('/api/cart/items', { variantId, qty, mode: 'set' }));
}
export async function remove(variantId) {
  return store(await del(`/api/cart/items/${variantId}`));
}
export function clearLocal() {
  raw = raw ? { ...raw, items: [], count: 0, subtotal_paise: 0, mrp_paise: 0, shipping_paise: 0, total_paise: 0 } : null;
  emit();
}

export function snapshot() {
  const items = (raw?.items || []).map((i) => {
    const product = getProductById(i.product.id) || {
      id: i.product.id, slug: i.product.slug, name: i.product.name, art: i.product.garment_type,
      colors: [{ id: i.color.id, name: i.color.name, hex: i.color.hex }], print: {}, artwork: {},
    };
    const colorObj = product.colors.find((c) => c.id === i.color.id || c.name === i.color.name) || { name: i.color.name, hex: i.color.hex };
    return {
      key: i.variant_id,
      variantId: i.variant_id,
      product,
      colorObj,
      size: i.size,
      qty: i.qty,
      unit: i.unit_price_paise / 100,
      unitMrp: i.unit_mrp_paise / 100,
      lineTotal: i.line_total_paise / 100,
      available: i.available,
      problem: i.problem || null,
    };
  });
  const subtotal = (raw?.subtotal_paise || 0) / 100;
  const shipping = (raw?.shipping_paise || 0) / 100;
  return {
    items,
    count: raw?.count || 0,
    subtotal,
    mrp: (raw?.mrp_paise || 0) / 100,
    shipping,
    total: (raw?.total_paise || 0) / 100,
    toFreeShipping: subtotal ? Math.max(0, config.freeShippingThreshold - subtotal) : config.freeShippingThreshold,
    hasProblems: items.some((i) => i.problem),
  };
}

onSession(() => refresh().catch(() => {}));
