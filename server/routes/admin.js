// Owner dashboard API. Every route requires a signed-in account with role "owner".
import { env } from '../env.js';
import { readJson, bad, unauthorized, toCsv } from '../http.js';
import { rpc, auth, signedUpload } from '../lib/supabase.js';
import { tryDecrypt, signToken, verifyToken } from '../lib/crypto.js';
import * as v from '../lib/validate.js';
import { requireOwner } from '../session.js';
import { limit } from '../ratelimit.js';
import { notifyRestock, notifyShipped } from '../notify.js';
import { randomBytes } from 'node:crypto';

const UPLOAD_RULES = {
  image: { types: ['image/jpeg', 'image/png', 'image/webp', 'image/gif'], max: 10 * 1024 * 1024 },
  design: { types: ['image/png', 'image/webp'], max: 15 * 1024 * 1024 },
  video: { types: ['video/mp4', 'video/webm', 'video/quicktime'], max: 100 * 1024 * 1024 },
  audio: { types: ['audio/mpeg', 'audio/mp4', 'audio/aac', 'audio/ogg', 'audio/wav'], max: 20 * 1024 * 1024 },
};

const GARMENTS = ['oversized', 'tee', 'tank', 'halter', 'longsleeve', 'hoodie', 'jacket', 'pants', 'skirt'];
const HEX = /^#[0-9a-fA-F]{6}$/;
const okUrl = (u) => !u || (typeof u === 'string' && u.length < 600 && (u.startsWith(`${env.supabaseUrl}/storage/v1/object/public/`) || u.startsWith('https://')));

function cleanProduct(b, actorId) {
  const p = b.product || {};
  const product = {
    id: p.id || null,
    name: v.str(p.name, { field: 'Name', min: 2, max: 90, required: true }),
    slug: v.str(p.slug, { field: 'Web address', min: 2, max: 80, required: true }).toLowerCase(),
    category_id: p.category_id ? v.uuid(p.category_id, 'category') : null,
    description: v.str(p.description, { field: 'Description', max: 4000 }),
    details: (Array.isArray(p.details) ? p.details : []).slice(0, 20).map((d) => v.str(d, { field: 'Detail', max: 200 })).filter(Boolean),
    price_paise: v.int(p.price_paise, { field: 'Price', min: 100, max: 10000000 }),
    discount_pct: Number(p.discount_pct) || 0,
    garment_type: GARMENTS.includes(p.garment_type) ? p.garment_type : 'oversized',
    print_spec: p.print_spec && typeof p.print_spec === 'object' ? p.print_spec : {},
    print_front_url: p.print_front_url || null,
    print_back_url: p.print_back_url || null,
    audio_url: p.audio_url || null,
    audio_title: v.str(p.audio_title, { field: 'Track title', max: 120 }) || null,
    status: ['draft', 'live', 'archived'].includes(p.status) ? p.status : 'draft',
    is_new: p.is_new !== false,
    sort: Number.isInteger(p.sort) ? p.sort : 0,
  };
  if (!/^[a-z0-9-]+$/.test(product.slug)) throw bad('INVALID', 'Web address can use lowercase letters, numbers and dashes.', { field: 'slug' });
  if (product.discount_pct < 0 || product.discount_pct > 90) throw bad('INVALID', 'Discount must be between 0 and 90%.', { field: 'discount_pct' });
  for (const k of ['print_front_url', 'print_back_url', 'audio_url']) if (!okUrl(product[k])) throw bad('INVALID', 'Upload files through the dashboard.', { field: k });

  const colors = (b.colors || []).slice(0, 20).map((c) => {
    const name = v.str(c.name, { field: 'Colour name', min: 1, max: 40, required: true });
    if (!HEX.test(c.hex || '')) throw bad('INVALID', `Pick a colour for ${name}.`, { field: 'hex' });
    if (c.ink_hex && !HEX.test(c.ink_hex)) throw bad('INVALID', `Print colour for ${name} is not valid.`, { field: 'ink_hex' });
    return { name, hex: c.hex, ink_hex: c.ink_hex || null };
  });
  if (!colors.length) throw bad('INVALID', 'Add at least one colour.', { field: 'colors' });
  const names = new Set(colors.map((c) => c.name));
  const variants = (b.variants || []).slice(0, 300).map((x) => {
    if (!names.has(x.color)) throw bad('INVALID', `Unknown colour "${x.color}".`);
    return {
      color: x.color,
      size: v.str(x.size, { field: 'Size', min: 1, max: 12, required: true }).toUpperCase(),
      stock: v.int(x.stock ?? 0, { field: 'Stock', min: 0, max: 100000 }),
      low_stock_threshold: v.int(x.low_stock_threshold ?? 5, { field: 'Low-stock alert level', min: 0, max: 10000 }),
      sku: x.sku ? v.str(x.sku, { field: 'SKU', max: 40 }) : null,
    };
  });
  if (!variants.length) throw bad('INVALID', 'Add at least one size.', { field: 'sizes' });
  const media = (b.media || []).slice(0, 30).map((m) => {
    if (!['image', 'video'].includes(m.kind) || !okUrl(m.url) || !m.url) throw bad('INVALID', 'Media must be uploaded through the dashboard.');
    return { kind: m.kind, url: m.url, poster_url: okUrl(m.poster_url) ? m.poster_url || null : null, alt: v.str(m.alt, { field: 'Alt text', max: 200 }), color: names.has(m.color) ? m.color : null };
  });
  const reviews = (b.reviews || []).slice(0, 200).map((r) => ({
    id: r.id || null,
    author: v.str(r.author, { field: 'Reviewer name', min: 1, max: 60, required: true }),
    rating: v.int(r.rating, { field: 'Rating', min: 1, max: 5 }),
    title: v.str(r.title, { field: 'Review title', max: 120 }),
    body: v.str(r.body, { field: 'Review', max: 2000 }),
    is_published: r.is_published !== false,
  }));
  return { product, colors, variants, media, reviews, actor_id: actorId };
}

function decryptShipping(o) {
  const ship = o.user_id ? tryDecrypt(o.enc_shipping, `shipping:${o.user_id}`) : null;
  delete o.enc_shipping;
  return { ...o, shipping: ship };
}

export const routes = [
  ['GET', '/api/admin/summary', async (req, res, { query }) => {
    await requireOwner(req, res);
    return rpc('analytics_summary', { from: query.from || undefined, to: query.to || undefined });
  }],

  // ------------------------------------------------------------ products
  ['GET', '/api/admin/products', async (req, res) => {
    await requireOwner(req, res);
    return { products: await rpc('admin_products_list', {}) };
  }],
  ['GET', '/api/admin/products/:id', async (req, res, { params }) => {
    await requireOwner(req, res);
    return rpc('admin_product_get', { id: v.uuid(params.id) });
  }],
  ['POST', '/api/admin/products', async (req, res) => {
    const o = await requireOwner(req, res);
    const body = cleanProduct(await readJson(req), o.userId);
    const r = await rpc('admin_product_save', body);
    const sent = await notifyRestock(r.notify).catch((e) => (console.error('[restock]', e.message), { sent: 0 }));
    return { id: r.product_id, restockEmails: sent.sent || 0 };
  }],
  ['PUT', '/api/admin/products/:id/status', async (req, res, { params }) => {
    const o = await requireOwner(req, res);
    const b = await readJson(req);
    return rpc('admin_product_status', { id: v.uuid(params.id), status: b.status, actor_id: o.userId });
  }],

  // Signed upload URL: the browser sends the file straight to storage.
  ['POST', '/api/admin/uploads', async (req, res) => {
    const o = await requireOwner(req, res);
    await limit(req, 'upload', 300, 3600, o.userId);
    const b = await readJson(req);
    const rule = UPLOAD_RULES[b.kind];
    if (!rule) throw bad('INVALID', 'Unknown upload type.');
    if (!rule.types.includes(b.contentType)) throw bad('INVALID', `That file type is not allowed here. Use ${rule.types.map((t) => t.split('/')[1]).join(', ')}.`);
    if (!(b.size > 0 && b.size <= rule.max)) throw bad('INVALID', `Files can be up to ${Math.round(rule.max / 1048576)} MB.`);
    const folder = String(b.productSlug || 'unsorted').toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 60) || 'unsorted';
    const ext = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif', 'video/mp4': 'mp4', 'video/webm': 'webm', 'video/quicktime': 'mov', 'audio/mpeg': 'mp3', 'audio/mp4': 'm4a', 'audio/aac': 'aac', 'audio/ogg': 'ogg', 'audio/wav': 'wav' }[b.contentType];
    const path = `products/${folder}/${b.kind}/${Date.now()}-${randomBytes(6).toString('hex')}.${ext}`;
    return signedUpload(path);
  }],

  // ------------------------------------------------------------ homepage banners
  ['GET', '/api/admin/banners', async (req, res) => {
    await requireOwner(req, res);
    return rpc('admin_banners_list', {});
  }],
  ['POST', '/api/admin/banners', async (req, res) => {
    const o = await requireOwner(req, res);
    const b = await readJson(req);
    const placement = ['announcement', 'hero', 'strip', 'tile'].includes(b.placement) ? b.placement : null;
    if (!placement) throw bad('INVALID', 'Choose where the banner goes.', { field: 'placement' });
    const link = v.str(b.link_url, { field: 'Link', max: 300 }) || '/shop';
    if (!/^\/(?!\/)[^\s]*$/.test(link) && !/^https:\/\/[^\s]+$/.test(link)) throw bad('INVALID', 'Links must start with / (a page on this site) or https://', { field: 'link_url' });
    if (!okUrl(b.image_url) || !okUrl(b.mobile_image_url)) throw bad('INVALID', 'Upload images through the dashboard.', { field: 'image_url' });
    if (placement !== 'announcement' && !b.image_url) throw bad('INVALID', 'Add an image for this banner.', { field: 'image_url' });
    const when = (x, field) => {
      if (!x) return null;
      const d = new Date(x);
      if (Number.isNaN(d.getTime())) throw bad('INVALID', 'Enter a valid date.', { field });
      return d.toISOString();
    };
    const starts = when(b.starts_at, 'starts_at');
    const ends = when(b.ends_at, 'ends_at');
    if (starts && ends && ends <= starts) throw bad('INVALID', 'The end must be after the start.', { field: 'ends_at' });
    return rpc('admin_banner_save', {
      id: b.id ? v.uuid(b.id, 'banner') : null, placement,
      title: v.str(b.title, { field: placement === 'announcement' ? 'Message' : 'Title', max: 120, required: placement === 'announcement' }),
      subtitle: v.str(b.subtitle, { field: 'Subtitle', max: 200 }), cta_label: v.str(b.cta_label, { field: 'Button text', max: 30 }),
      link_url: link, image_url: b.image_url || null, mobile_image_url: b.mobile_image_url || null,
      theme: b.theme === 'light' ? 'light' : 'dark', sort: v.int(b.sort ?? 0, { field: 'Order', min: -1000, max: 1000 }),
      is_active: b.is_active !== false, starts_at: starts, ends_at: ends, actor_id: o.userId,
    });
  }],
  ['DELETE', '/api/admin/banners/:id', async (req, res, { params }) => {
    const o = await requireOwner(req, res);
    return rpc('admin_banner_delete', { id: v.uuid(params.id, 'banner'), actor_id: o.userId });
  }],

  // ------------------------------------------------------------ categories
  ['GET', '/api/admin/categories', async (req, res) => {
    await requireOwner(req, res);
    return { categories: await rpc('admin_categories_list', {}) };
  }],
  ['POST', '/api/admin/categories', async (req, res) => {
    await requireOwner(req, res);
    const b = await readJson(req);
    const name = v.str(b.name, { field: 'Name', min: 2, max: 60, required: true });
    const slug = (v.str(b.slug, { field: 'Web address', max: 60 }) || name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    return rpc('admin_category_save', { id: b.id || null, name, slug, description: v.str(b.description, { field: 'Description', max: 300 }), sort: Number(b.sort) || 0, is_active: b.is_active !== false });
  }],
  ['DELETE', '/api/admin/categories/:id', async (req, res, { params }) => {
    await requireOwner(req, res);
    return rpc('admin_category_delete', { id: v.uuid(params.id) });
  }],

  // ------------------------------------------------------------ inventory
  ['GET', '/api/admin/inventory', async (req, res) => {
    await requireOwner(req, res);
    return { variants: await rpc('admin_inventory_list', {}) };
  }],
  ['PUT', '/api/admin/inventory/:variantId', async (req, res, { params }) => {
    const o = await requireOwner(req, res);
    const b = await readJson(req);
    const r = await rpc('admin_inventory_set', {
      variant_id: v.uuid(params.variantId, 'variant'),
      stock: v.int(b.stock, { field: 'Stock', min: 0, max: 100000 }),
      low_stock_threshold: b.lowStockThreshold === undefined ? null : v.int(b.lowStockThreshold, { field: 'Alert level', min: 0, max: 10000 }),
      actor_id: o.userId,
    });
    const sent = await notifyRestock(r.notify).catch(() => ({ sent: 0 }));
    return { ...r, notify: undefined, restockEmails: sent.sent || 0 };
  }],

  // ------------------------------------------------------------ orders
  ['GET', '/api/admin/orders', async (req, res, { query }) => {
    await requireOwner(req, res);
    const list = await rpc('admin_orders_list', { ...(query.status ? { status: query.status } : {}), limit: Number(query.limit) || 100, offset: Number(query.offset) || 0 });
    return { orders: list.map(decryptShipping) };
  }],
  ['GET', '/api/admin/orders/:id/journey', async (req, res, { params }) => {
    await requireOwner(req, res);
    return rpc('order_journey', { order_id: v.uuid(params.id, 'order') });
  }],
  ['PUT', '/api/admin/orders/:id/status', async (req, res, { params }) => {
    const o = await requireOwner(req, res);
    const b = await readJson(req);
    const id = v.uuid(params.id, 'order');
    const r = await rpc('admin_order_status_set', { order_id: id, status: String(b.status || ''), actor_id: o.userId });
    if (b.status === 'shipped') {
      const order = await rpc('order_get', { order_id: id });
      await notifyShipped(order).catch(() => {});
    }
    return r;
  }],

  // ------------------------------------------------------------ alerts & settings
  ['GET', '/api/admin/alerts', async (req, res, { query }) => {
    await requireOwner(req, res);
    return { alerts: await rpc('admin_alerts_list', { unread_only: query.unread === '1' }) };
  }],
  ['POST', '/api/admin/alerts/read', async (req, res) => {
    await requireOwner(req, res);
    const b = await readJson(req);
    return rpc('admin_alerts_read', b.id ? { id: v.uuid(b.id) } : {});
  }],
  ['GET', '/api/admin/settings', async (req, res) => {
    await requireOwner(req, res);
    return rpc('settings_get', {});
  }],
  ['PUT', '/api/admin/settings', async (req, res) => {
    const o = await requireOwner(req, res);
    const b = await readJson(req);
    const values = {};
    if (b.low_stock_default !== undefined) values.low_stock_default = v.int(b.low_stock_default, { field: 'Low-stock level', min: 0, max: 1000 });
    if (b.reminder_alert_threshold !== undefined) values.reminder_alert_threshold = v.int(b.reminder_alert_threshold, { field: 'Reminder alert level', min: 1, max: 10000 });
    if (b.owner_alert_email !== undefined) {
      const list = String(b.owner_alert_email).split(',').map((s) => s.trim()).filter(Boolean);
      list.forEach((e) => v.email(e));
      values.owner_alert_email = list.join(', ');
    }
    if (b.notify_owner_on_order !== undefined) values.notify_owner_on_order = b.notify_owner_on_order === true;
    if (b.audio_volume !== undefined) {
      const vol = Number(b.audio_volume);
      if (!(vol >= 0 && vol <= 1)) throw bad('INVALID', 'Volume must be between 0 and 100%.');
      values.audio_volume = vol;
    }
    if (b.shipping !== undefined) {
      values.shipping = {
        free_over_paise: v.int(b.shipping.free_over_paise, { field: 'Free shipping over', min: 0, max: 10000000 }),
        fee_paise: v.int(b.shipping.fee_paise, { field: 'Shipping fee', min: 0, max: 1000000 }),
      };
    }
    if (b.reservation_minutes !== undefined) values.reservation_minutes = v.int(b.reservation_minutes, { field: 'Hold time', min: 5, max: 60 });
    return rpc('settings_set', { values, actor_id: o.userId });
  }],

  // ------------------------------------------------------------ decrypted data export
  // Step 1: the owner re-enters their password; we hand back a 10-minute export pass.
  ['POST', '/api/admin/reauth', async (req, res) => {
    const o = await requireOwner(req, res);
    await limit(req, 'reauth', 10, 900, o.userId);
    const b = await readJson(req);
    const email = tryDecrypt(o.profile.enc_email, `profile:${o.userId}:email`) || o.email;
    const r = await auth.signIn(email, String(b.password || ''));
    if (!r.ok) throw unauthorized('BAD_PASSWORD', 'That password is not right.');
    return { exportToken: signToken({ sub: o.userId, scope: 'export' }, 600), expiresIn: 600 };
  }],

  // Step 2: download a CSV with personal fields decrypted. Every download is audit-logged.
  ['GET', '/api/admin/export', async (req, res, { query }) => {
    const o = await requireOwner(req, res);
    const pass = verifyToken(req.headers['x-export-token']);
    if (!pass || pass.sub !== o.userId || pass.scope !== 'export') throw unauthorized('REAUTH_REQUIRED', 'Confirm your password to download data.');
    await limit(req, 'export', 30, 3600, o.userId);
    const dataset = String(query.dataset || '');
    if (!['orders', 'customers', 'events', 'inventory'].includes(dataset)) throw bad('INVALID', 'Unknown dataset.');
    const rows = await rpc('export_rows', { dataset, from: query.from || undefined, to: query.to || undefined });
    const out = rows.map((r) => {
      if (dataset === 'orders') {
        const ship = r.user_id ? tryDecrypt(r.enc_shipping, `shipping:${r.user_id}`) || {} : {};
        const { enc_shipping, enc_age, enc_gender, ...rest } = r;
        return {
          ...rest,
          customer_name: ship.fullName, customer_email: ship.email, phone: ship.phone,
          address_line1: ship.line1, address_line2: ship.line2, landmark: ship.landmark, city: ship.city, state: ship.state, pin: ship.pin,
          age: r.user_id ? tryDecrypt(enc_age, `profile:${r.user_id}:age`) : null,
          gender: r.user_id ? tryDecrypt(enc_gender, `profile:${r.user_id}:gender`) : null,
        };
      }
      if (dataset === 'customers') {
        const id = r.user_id;
        const addr = tryDecrypt(r.enc_address, `address:${id}`) || {};
        const { enc_email, enc_full_name, enc_phone, enc_age, enc_gender, enc_address, ...rest } = r;
        return {
          ...rest,
          email: tryDecrypt(enc_email, `profile:${id}:email`), name: tryDecrypt(enc_full_name, `profile:${id}:name`),
          phone: tryDecrypt(enc_phone, `profile:${id}:phone`), age: tryDecrypt(enc_age, `profile:${id}:age`), gender: tryDecrypt(enc_gender, `profile:${id}:gender`),
          city: addr.city, state: addr.state, pin: addr.pin,
        };
      }
      return r;
    });
    await rpc('audit', { actor_id: o.userId, action: 'export', target: dataset, details: { rows: out.length, from: query.from || null, to: query.to || null } });
    const stamp = new Date().toISOString().slice(0, 10);
    res.setHeader('content-type', 'text/csv; charset=utf-8');
    res.setHeader('content-disposition', `attachment; filename="knotily-${dataset}-${stamp}.csv"`);
    return { __raw: '﻿' + toCsv(out) };
  }],
];
