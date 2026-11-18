// Full-width hero slider for the owner's 'hero' banners (photo, title, subtitle, button).
// Autoplays every 6 s (not with reduced motion), pauses on hover/focus or with the pause button.
import { icons } from './icons.js';
import { track } from '../lib/analytics.js';
import { esc } from '../lib/util.js';

export function heroSliderHTML(slides) {
  return `
    <section class="hero" aria-roledescription="carousel" aria-label="Featured" data-hero>
      <div class="hero-track">
        ${slides.map((b, i) => `
          <div class="hero-slide ${b.theme === 'light' ? 'is-light' : ''} ${i === 0 ? 'is-on' : ''}" role="group" aria-roledescription="slide" aria-label="${i + 1} of ${slides.length}" ${i ? 'aria-hidden="true"' : ''}>
            <picture>
              ${b.mobile_image_url ? `<source media="(max-width: 700px)" srcset="${esc(b.mobile_image_url)}" />` : ''}
              <img src="${esc(b.image_url)}" alt="" ${i === 0 ? 'fetchpriority="high"' : 'loading="lazy"'} />
            </picture>
            <div class="hero-copy">
              ${b.title ? `<h2 class="hero-title">${esc(b.title)}</h2>` : ''}
              ${b.subtitle ? `<p class="hero-sub">${esc(b.subtitle)}</p>` : ''}
              <a class="btn ${b.theme === 'light' ? '' : 'btn-white'}" href="${esc(b.link_url)}" data-banner="${esc(b.id)}" ${i ? 'tabindex="-1"' : ''}>${esc(b.cta_label || 'Shop now')}</a>
            </div>
          </div>`).join('')}
      </div>
      ${slides.length > 1 ? `
        <div class="hero-ctrl">
          <button type="button" class="hero-arrow" data-prev aria-label="Previous slide">${icons.left}</button>
          <div class="hero-dots">${slides.map((_, i) => `<button type="button" data-dot="${i}" aria-label="Slide ${i + 1}" ${i === 0 ? 'aria-current="true"' : ''}></button>`).join('')}</div>
          <button type="button" class="hero-arrow" data-next aria-label="Next slide">${icons.right}</button>
          <button type="button" class="hero-arrow" data-play aria-label="Pause slideshow">${icons.pause}</button>
        </div>` : ''}
    </section>`;
}

export function mountHeroSlider(root) {
  const hero = root.querySelector('[data-hero]');
  if (!hero) return () => {};
  hero.addEventListener('click', (e) => {
    const a = e.target.closest('[data-banner]');
    if (a) track('banner_click', { banner_id: a.dataset.banner, href: a.getAttribute('href') });
  });
  const slides = [...hero.querySelectorAll('.hero-slide')];
  if (slides.length < 2) return () => {};
  const dots = [...hero.querySelectorAll('[data-dot]')];
  const playBtn = hero.querySelector('[data-play]');
  let i = 0;
  let timer = 0;
  let playing = !matchMedia('(prefers-reduced-motion: reduce)').matches;
  let hovered = false;

  const go = (n) => {
    i = (n + slides.length) % slides.length;
    slides.forEach((s, k) => {
      s.classList.toggle('is-on', k === i);
      s.toggleAttribute('aria-hidden', k !== i);
      s.querySelectorAll('a').forEach((a) => (k === i ? a.removeAttribute('tabindex') : a.setAttribute('tabindex', '-1')));
    });
    dots.forEach((d, k) => (k === i ? d.setAttribute('aria-current', 'true') : d.removeAttribute('aria-current')));
  };
  const schedule = () => {
    clearTimeout(timer);
    if (playing && !hovered) timer = setTimeout(() => (go(i + 1), schedule()), 6000);
  };
  const setPlaying = (on) => {
    playing = on;
    playBtn.innerHTML = on ? icons.pause : icons.play;
    playBtn.setAttribute('aria-label', on ? 'Pause slideshow' : 'Play slideshow');
    schedule();
  };
  hero.querySelector('[data-prev]').addEventListener('click', () => (go(i - 1), schedule()));
  hero.querySelector('[data-next]').addEventListener('click', () => (go(i + 1), schedule()));
  dots.forEach((d) => d.addEventListener('click', () => (go(Number(d.dataset.dot)), schedule())));
  playBtn.addEventListener('click', () => setPlaying(!playing));
  hero.addEventListener('mouseenter', () => ((hovered = true), schedule()));
  hero.addEventListener('mouseleave', () => ((hovered = false), schedule()));
  hero.addEventListener('focusin', () => ((hovered = true), schedule()));
  hero.addEventListener('focusout', () => ((hovered = false), schedule()));
  // swipe on touch screens
  let x0 = null;
  hero.addEventListener('touchstart', (e) => (x0 = e.touches[0].clientX), { passive: true });
  hero.addEventListener('touchend', (e) => {
    if (x0 === null) return;
    const dx = e.changedTouches[0].clientX - x0;
    if (Math.abs(dx) > 40) go(i + (dx < 0 ? 1 : -1)), schedule();
    x0 = null;
  });
  setPlaying(playing);
  return () => clearTimeout(timer);
}
