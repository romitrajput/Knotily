// Builds supabase/seed.sql (Testing environment only) from the demo catalogue.
// Usage: node scripts/make-seed.mjs
import { writeFileSync } from 'node:fs';
import { PRODUCTS, CATEGORIES } from './seed-data/products.js';

const q = (s) => `'${String(s).replace(/'/g, "''")}'`;
const out = ['-- Demo catalogue for the TESTING environment. Never run this on production.', 'begin;'];
CATEGORIES.forEach((c, i) =>
  out.push(`select public.admin_category_save(jsonb_build_object('slug', ${q(c.id)}, 'name', ${q(c.label)}, 'description', ${q(c.blurb)}, 'sort', ${i}));`)
);
// deterministic pseudo-random stock so tests are repeatable
let seed = 7;
const rnd = () => ((seed = (seed * 9301 + 49297) % 233280) / 233280);
PRODUCTS.forEach((p, i) => {
  const colors = p.colors.map((c) => ({ name: c.name, hex: c.hex, ink_hex: c.ink || null }));
  const variants = [];
  p.colors.forEach((c, ci) =>
    p.sizes.forEach((s) => {
      let stock = Math.floor(rnd() * 25) + 3;
      if (i === 2 && ci === 0 && (s === 'M' || s === 'L')) stock = 0;          // After Hours black M/L sold out
      if (i === 0 && ci === 0 && s === 'S') stock = 2;                          // Bad Idea red S running low
      variants.push({ color: c.name, size: s, stock, low_stock_threshold: 5 });
    })
  );
  const product = {
    slug: p.slug, name: p.name, description: p.description, details: p.details,
    price_paise: p.price * 100, discount_pct: p.compareAt ? Math.round((1 - p.price / p.compareAt) * 100) : (p.category === 'tees' && i % 3 === 0 ? 10 : 0),
    garment_type: p.art === 'set' ? 'skirt' : p.art,
    // extra per-colour trims (varsity sleeves, tie colour) ride along in print_spec.trims
    print_spec: { ...(p.print || {}), ...(p.colors.some((c) => c.hex2 || c.tie) ? { trims: Object.fromEntries(p.colors.filter((c) => c.hex2 || c.tie).map((c) => [c.name, { ...(c.hex2 ? { hex2: c.hex2 } : {}), ...(c.tie ? { tie: c.tie } : {}) }])) } : {}) },
    status: 'live', is_new: !!p.isNew, sort: i,
  };
  const reviews = i < 4 ? [
    { author: 'Aanya', rating: 5, title: 'Obsessed with the fit', body: 'Heavy fabric, prints feel premium. Sized down one for a closer fit.' },
    { author: 'Kabir', rating: 4, title: 'Great tee', body: 'Colour is exactly like the site. Delivery took 4 days.' },
  ] : [];
  out.push(`select public.admin_product_save(jsonb_build_object('product', ${q(JSON.stringify(product))}::jsonb || jsonb_build_object('category_id', (select id from public.categories where slug = ${q(p.category)})), 'colors', ${q(JSON.stringify(colors))}::jsonb, 'variants', ${q(JSON.stringify(variants))}::jsonb, 'reviews', ${q(JSON.stringify(reviews))}::jsonb, 'media', '[]'::jsonb));`);
});
out.push('commit;');
writeFileSync(new URL('../supabase/seed.sql', import.meta.url), out.join('\n') + '\n');
console.log(`seed.sql: ${CATEGORIES.length} categories, ${PRODUCTS.length} products`);
