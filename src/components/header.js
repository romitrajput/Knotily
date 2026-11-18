// Announcement bar + sticky white header: menu (with a Shop mega menu on desktop and a
// slide-out drawer on phones), centred logo, and search / account / wishlist / bag icons.
import { subscribe, snapshot } from '../store/cart.js';
import { openCart } from './cartDrawer.js';
import { openSearch } from './search.js';
import { onSession, currentUser } from '../store/session.js';
import { onWishlist, wishCount } from '../store/wishlist.js';
import { listCategories, allProducts, getBanners } from '../services/catalog.js';
import { logoSVG } from '../brand/logo.js';
import { icons } from './icons.js';
import { config } from '../config.js';
import { formatPrice, esc, $, $$ } from '../lib/util.js';

let el;
let annTimer = 0;

export function mountHeader(host) {
  el = host;
  el.innerHTML = `
    <div class="ann" data-ann role="region" aria-label="Announcements"><p class="ann-msg" data-ann-msg>Free shipping on orders over ${formatPrice(config.freeShippingThreshold)}</p></div>
    <header class="hdr" data-header>
      <div class="hdr-left">
        <button type="button" class="icon hdr-burger" data-menu-open aria-label="Open menu" aria-expanded="false">${icons.menu}</button>
        <nav class="hdr-nav" aria-label="Main" data-nav>
          <a href="/shop?sort=new">New in</a>
          <div class="has-mega">
            <button type="button" class="mega-btn" data-mega-btn aria-expanded="false" aria-controls="mega">Shop ${icons.down}</button>
          </div>
          <span data-nav-cats></span>
          <a href="/story">Story</a>
        </nav>
      </div>
      <a class="logo" href="/" aria-label="Knot’ily home">${logoSVG({ label: 'Knot’ily' })}</a>
      <div class="hdr-right">
        <a class="hdr-owner" href="/admin" data-owner-link hidden>Owner</a>
        <button type="button" class="icon" data-search-open aria-label="Search">${icons.search}</button>
        <a class="icon hide-sm" href="/account" data-account-link aria-label="Log in or create an account">${icons.user}</a>
        <a class="icon hide-sm" href="/wishlist" aria-label="Wishlist" data-wish-link>${icons.heart}<span class="count" data-wish-count hidden></span></a>
        <button type="button" class="icon" data-open-cart aria-label="Open bag, 0 items">${icons.bag}<span class="count" data-bag-count hidden></span></button>
      </div>
      <div class="mega" id="mega" data-mega hidden></div>
    </header>
    <div class="menu-root" data-menu hidden>
      <div class="menu-scrim" data-menu-close></div>
      <nav class="menu" aria-label="Menu">
        <div class="menu-head"><span>Menu</span><button type="button" class="icon" data-menu-close aria-label="Close menu">${icons.close}</button></div>
        <div class="menu-body" data-menu-body></div>
      </nav>
    </div>`;

  // bag count
  const bagBtn = $('[data-open-cart]', el);
  const bagCount = $('[data-bag-count]', el);
  bagBtn.addEventListener('click', openCart);
  const onCart = (s) => {
    bagCount.hidden = !s.count;
    bagCount.textContent = s.count;
    bagBtn.setAttribute('aria-label', `Open bag, ${s.count} item${s.count === 1 ? '' : 's'}`);
  };
  onCart(snapshot());
  subscribe(onCart);

  // wishlist count
  const wc = $('[data-wish-count]', el);
  onWishlist(() => {
    const n = wishCount();
    wc.hidden = !n;
    wc.textContent = n;
  });

  // who's signed in
  const acc = $('[data-account-link]', el);
  const own = $('[data-owner-link]', el);
  const who = (u) => {
    acc.setAttribute('aria-label', u ? `Your account (${u.email})` : 'Log in or create an account');
    acc.classList.toggle('is-in', !!u);
    own.hidden = u?.role !== 'owner';
  };
  who(currentUser());
  onSession(who);

  $('[data-search-open]', el).addEventListener('click', () => openSearch());

  // mega menu (desktop): opens on hover or click, closes on leave / Escape / outside click
  const megaBtn = $('[data-mega-btn]', el);
  const mega = $('[data-mega]', el);
  let closeT = 0;
  const setMega = (open) => {
    clearTimeout(closeT);
    mega.hidden = !open;
    megaBtn.setAttribute('aria-expanded', String(open));
    el.querySelector('.hdr').classList.toggle('mega-open', open);
  };
  megaBtn.addEventListener('click', () => setMega(mega.hidden));
  for (const t of [megaBtn.parentElement, mega]) {
    t.addEventListener('mouseenter', () => matchMedia('(hover: hover)').matches && setMega(true));
    t.addEventListener('mouseleave', () => matchMedia('(hover: hover)').matches && (closeT = setTimeout(() => setMega(false), 180)));
  }
  mega.addEventListener('click', (e) => e.target.closest('a') && setMega(false));
  document.addEventListener('keydown', (e) => e.key === 'Escape' && !mega.hidden && (setMega(false), megaBtn.focus()));
  document.addEventListener('click', (e) => !mega.hidden && !e.target.closest('.has-mega, [data-mega]') && setMega(false));

  // phone menu drawer
  const menu = $('[data-menu]', el);
  const burger = $('[data-menu-open]', el);
  const setMenu = (open) => {
    if (open) {
      menu.hidden = false;
      requestAnimationFrame(() => menu.classList.add('open'));
      document.body.classList.add('drawer-open');
      menu.querySelector('a, button')?.focus();
    } else {
      menu.classList.remove('open');
      document.body.classList.remove('drawer-open');
      setTimeout(() => (menu.hidden = true), 300);
    }
    burger.setAttribute('aria-expanded', String(open));
  };
  burger.addEventListener('click', () => setMenu(true));
  menu.addEventListener('click', (e) => (e.target.closest('[data-menu-close]') || e.target.closest('a')) && setMenu(false));
  document.addEventListener('keydown', (e) => e.key === 'Escape' && menu.classList.contains('open') && setMenu(false));

  const header = $('[data-header]', el);
  const onScroll = () => header.classList.toggle('is-scrolled', scrollY > 8);
  addEventListener('scroll', onScroll, { passive: true });
  onScroll();
  addEventListener('knotily:navigate', () => setMega(false));
}

// Colour names grouped from the live catalogue, most common first.
function colourList() {
  const m = new Map();
  for (const p of allProducts()) for (const c of p.colors) {
    const k = c.name;
    if (!m.has(k)) m.set(k, { name: k, hex: c.hex, n: 0 });
    m.get(k).n++;
  }
  return [...m.values()].sort((a, b) => b.n - a.n).slice(0, 10);
}

// Called once the catalogue has loaded (categories, colours, banners).
export function renderNav() {
  if (!el) return;
  const cats = listCategories();
  const colours = colourList();
  const tile = getBanners('tile')[0];
  const sale = allProducts().some((p) => p.discountPct);
  const promo = tile
    ? `<a class="mega-promo" href="${esc(tile.link_url)}"><img src="${esc(tile.image_url)}" alt="" loading="lazy" /><span>${esc(tile.title || 'Shop now')}</span></a>`
    : `<a class="mega-promo mega-promo-brand" href="/shop?sort=new"><span class="mp-kicker">${esc(config.currentDrop)}</span><span class="mp-title">No strings attached</span><span class="mp-cta">Shop the drop</span></a>`;

  $('[data-nav-cats]', el).innerHTML = cats.slice(0, 2).map((c) => `<a href="/shop/${esc(c.id)}">${esc(c.label)}</a>`).join('');
  $('[data-mega]', el).innerHTML = `
    <div class="mega-inner">
      <div class="mega-col"><p class="mega-h">Categories</p><ul>
        <li><a href="/shop">All pieces</a></li>
        ${cats.map((c) => `<li><a href="/shop/${esc(c.id)}">${esc(c.label)}</a></li>`).join('')}</ul></div>
      <div class="mega-col"><p class="mega-h">Shop by colour</p><ul class="mega-colours">
        ${colours.map((c) => `<li><a href="/shop?color=${encodeURIComponent(c.name)}"><i style="--sw:${esc(c.hex)}"></i>${esc(c.name)}</a></li>`).join('')}</ul></div>
      <div class="mega-col"><p class="mega-h">Featured</p><ul>
        <li><a href="/shop?sort=new">New arrivals</a></li>
        ${sale ? '<li><a href="/shop?sale=1">On sale</a></li>' : ''}
        <li><a href="/shop?stock=1">In stock now</a></li>
        <li><a href="/wishlist">Your wishlist</a></li></ul></div>
      ${promo}
    </div>`;
  $('[data-menu-body]', el).innerHTML = `
    <a class="menu-big" href="/shop?sort=new">New in</a>
    <a class="menu-big" href="/shop">Shop all</a>
    ${cats.map((c) => `<a class="menu-big" href="/shop/${esc(c.id)}">${esc(c.label)}</a>`).join('')}
    <p class="menu-h">Shop by colour</p>
    <div class="menu-colours">${colours.map((c) => `<a href="/shop?color=${encodeURIComponent(c.name)}"><i style="--sw:${esc(c.hex)}"></i>${esc(c.name)}</a>`).join('')}</div>
    <div class="menu-links">
      <a href="/account">${icons.user}<span>Account</span></a>
      <a href="/wishlist">${icons.heart}<span>Wishlist</span></a>
      <a href="/story">${icons.spark}<span>Our story</span></a>
      <a href="mailto:${esc(config.supportEmail)}" data-external>${icons.mail}<span>Help</span></a>
    </div>`;

  // announcement messages from the owner (rotate every 5 s), else the shipping line
  const msgs = getBanners('announcement').map((b) => ({ text: b.title, link: b.link_url }));
  if (!msgs.length) msgs.push({ text: `Free shipping on orders over ${formatPrice(config.freeShippingThreshold)} · ${config.currentDrop} is live`, link: '/shop?sort=new' });
  const box = $('[data-ann-msg]', el);
  let i = 0;
  const show = () => {
    const m = msgs[i % msgs.length];
    box.innerHTML = m.link ? `<a href="${esc(m.link)}">${esc(m.text)}</a>` : esc(m.text);
    box.classList.remove('in');
    void box.offsetWidth;
    box.classList.add('in');
  };
  clearInterval(annTimer);
  show();
  if (msgs.length > 1 && !matchMedia('(prefers-reduced-motion: reduce)').matches) annTimer = setInterval(() => (i++, show()), 5000);
}

export function setActiveNav(path) {
  $$('.hdr-nav a, .menu a').forEach((a) => {
    const href = a.getAttribute('href');
    if (href === path) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  });
}
