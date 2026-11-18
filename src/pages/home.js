// Home: hero slider → latest drop → collections → full-width banners → category rows
// → promises → about. Everything the owner uploads (banners, photos) shows up here;
// until then, the brand panels and still garment images fill in.
import { listProducts, listCategories, getBanners } from '../services/catalog.js';
import { productCard, productRow } from '../components/productCard.js';
import { garmentImg, hydrate } from '../components/media.js';
import { heroSliderHTML, mountHeroSlider } from '../components/heroSlider.js';
import { icons } from '../components/icons.js';
import { track } from '../lib/analytics.js';
import { formatPrice, esc } from '../lib/util.js';
import { config } from '../config.js';

function brandHero(picks) {
  return `
    <section class="hero hero-brand" aria-label="${esc(config.currentDrop)}">
      <div class="hb-copy">
        <p class="kicker">${esc(config.currentDrop)} · Live now</p>
        <h1 class="hb-title">No strings<br />attached.</h1>
        <p class="hb-sub">Oversized tees and streetwear made in short runs. When a colour sells out, it's gone.</p>
        <div class="hb-cta"><a class="btn btn-white" href="/shop?sort=new">Shop the drop</a><a class="btn btn-ghost-white" href="/shop">All pieces</a></div>
      </div>
      <div class="hb-pics">
        ${picks.map((p, i) => `<a class="hb-pic hb-pic-${i}" href="/product/${esc(p.slug)}" style="--tint:${esc(p.colors[0].hex)}" aria-label="${esc(p.name)}">${garmentImg(p, p.colors[0], { eager: true })}</a>`).join('')}
      </div>
    </section>`;
}

function tilesHTML(cats, products) {
  const tiles = getBanners('tile');
  const items = tiles.length
    ? tiles.map((b) => ({ href: b.link_url, title: b.title, img: `<img src="${esc(b.image_url)}" alt="" loading="lazy" />`, id: b.id }))
    : cats
        .map((c) => {
          const p = products.find((x) => x.category === c.id);
          return p ? { href: `/shop/${c.id}`, title: c.label, img: garmentImg(p, p.colors[0]), tint: p.colors[0].hex } : null;
        })
        .filter(Boolean);
  if (!items.length) return '';
  return `
    <section class="tiles-sec" aria-labelledby="disc-title">
      <div class="row-head"><h2 class="sec-title" id="disc-title">Discover collections</h2></div>
      <div class="tiles">
        ${items.map((t) => `<a class="tile" href="${esc(t.href)}" ${t.id ? `data-banner="${esc(t.id)}"` : ''} ${t.tint ? `style="--tint:${esc(t.tint)}"` : ''}>
          <span class="tile-img">${t.img}</span>
          <span class="tile-copy"><span class="tile-title">${esc(t.title)}</span><span class="tile-cta">Shop now</span></span></a>`).join('')}
      </div>
    </section>`;
}

function stripsHTML() {
  const strips = getBanners('strip');
  if (!strips.length) {
    return `<section class="strip strip-brand" aria-label="Knot’ily">
      <p class="strip-kicker">Knot’ily</p>
      <h2 class="strip-title">Made to be undone</h2>
      <a class="btn btn-white" href="/story">Our story</a></section>`;
  }
  return strips.map((b) => `
    <section class="strip ${b.theme === 'light' ? 'is-light' : ''}" aria-label="${esc(b.title || 'Featured')}">
      <picture>${b.mobile_image_url ? `<source media="(max-width: 700px)" srcset="${esc(b.mobile_image_url)}" />` : ''}<img src="${esc(b.image_url)}" alt="" loading="lazy" /></picture>
      <div class="strip-copy">
        ${b.title ? `<h2 class="strip-title">${esc(b.title)}</h2>` : ''}
        ${b.subtitle ? `<p class="strip-sub">${esc(b.subtitle)}</p>` : ''}
        <a class="btn ${b.theme === 'light' ? '' : 'btn-white'}" href="${esc(b.link_url)}" data-banner="${esc(b.id)}">${esc(b.cta_label || 'Shop now')}</a>
      </div>
    </section>`).join('');
}

export default async function home() {
  const all = await listProducts();
  const cats = listCategories();
  if (!all.length) {
    return {
      name: 'home',
      title: '',
      html: `<section class="page-narrow"><h1 class="page-title">The next drop is on its way</h1><p>Nothing is live right now. Create an account and check back soon.</p><a class="btn" href="/account?mode=signup">Create an account</a></section>`,
    };
  }
  const latest = [...all].sort((a, b) => Number(b.isNew) - Number(a.isNew)).slice(0, 8);
  const heroes = getBanners('hero');
  const picks = latest.filter((p) => p.stock !== 'out').slice(0, 3);
  const rows = cats
    .map((c) => ({ c, items: all.filter((p) => p.category === c.id) }))
    .filter((r) => r.items.length >= 3)
    .slice(0, 3);
  const [firstRow, ...moreRows] = rows;

  return {
    name: 'home',
    title: '',
    description: 'Knot’ily: oversized tees and streetwear in short drops. Free shipping over ₹1,999 across India.',
    html: `
      ${heroes.length ? heroSliderHTML(heroes) : brandHero(picks)}
      <div class="wrap">
        ${productRow('Latest drop', latest, '/shop?sort=new', { id: 'latest' })}
        ${tilesHTML(cats, all)}
      </div>
      ${stripsHTML()}
      <div class="wrap">
        ${firstRow ? productRow(firstRow.c.label, firstRow.items.slice(0, 8), `/shop/${firstRow.c.id}`) : ''}
        ${moreRows.map((r) => productRow(r.c.label, r.items.slice(0, 8), `/shop/${r.c.id}`)).join('')}
        <section class="usps" aria-label="Why shop with us">
          <div>${icons.truck}<p><b>Free shipping</b> on orders over ${formatPrice(config.freeShippingThreshold)}</p></div>
          <div>${icons.refresh}<p><b>7-day returns</b> on unworn pieces</p></div>
          <div>${icons.lock}<p><b>Secure payments</b> UPI, cards, net banking</p></div>
          <div>${icons.spark}<p><b>Short runs</b> sold out means gone</p></div>
        </section>
        <section class="about" aria-labelledby="about-title">
          <h2 id="about-title" class="sec-title">Streetwear you can tie your own way</h2>
          <div class="about-body" data-about>
            <p>Knot’ily makes oversized tees, hoodies and streetwear in small drops. Every style is cut in a short run, so when a colour sells out it retires — no endless restocks, and you rarely meet your outfit twin.</p>
            <p>We pick heavyweight cotton and washed fabrics for how they feel first. Prints are made to last wash after wash, and every piece ships across India from our studio within 2–3 working days.</p>
            <p>Not sure about your size? Every product page has a size guide, and if it doesn't fit you can return unworn pieces within 7 days. Sold out in your size? Tap “Remind me” and we'll email you the moment it's back.</p>
          </div>
          <button type="button" class="link-inline" data-more aria-expanded="false">Read more</button>
        </section>
      </div>`,

    mount(root) {
      hydrate(root);
      const stop = mountHeroSlider(root);
      root.addEventListener('click', (e) => {
        const t = e.target.closest('.tile[data-banner], .strip [data-banner]');
        if (t) track('banner_click', { banner_id: t.dataset.banner });
      });
      const about = root.querySelector('[data-about]');
      const more = root.querySelector('[data-more]');
      more.addEventListener('click', () => {
        const open = about.classList.toggle('open');
        more.textContent = open ? 'Read less' : 'Read more';
        more.setAttribute('aria-expanded', String(open));
      });
      return stop;
    },
  };
}

export { productCard };
