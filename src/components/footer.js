import { config } from '../config.js';
import { logoSVG } from '../brand/logo.js';
import { showConsentBanner } from './consentBanner.js';
import { icons } from './icons.js';
import { esc } from '../lib/util.js';

export function mountFooter(el) {
  const year = new Date().getFullYear();
  el.innerHTML = `
    <footer class="footer">
      <div class="footer-top">
        <div class="footer-brand">
          <a class="logo" href="/" aria-label="Knot’ily home">${logoSVG({ label: 'Knot’ily' })}</a>
          <p>Oversized tees and streetwear in short drops. Made in India.</p>
          <div class="footer-social">
            <a href="${config.instagram}" data-external rel="noopener" aria-label="Instagram">${icons.insta}</a>
            <a href="mailto:${esc(config.supportEmail)}" data-external aria-label="Email us">${icons.mail}</a>
          </div>
        </div>
        <nav aria-label="Shop links"><h3>Shop</h3><ul data-footer-cats><li><a href="/shop">All pieces</a></li></ul></nav>
        <nav aria-label="Help links"><h3>Order support</h3><ul>
          <li><a href="/account">Track your order</a></li>
          <li><a href="/story#shipping">Shipping</a></li>
          <li><a href="/story#shipping">Returns and refunds</a></li>
          <li><a href="/story#sizing">Size guide</a></li>
          <li><a href="mailto:${esc(config.supportEmail)}" data-external>Contact us</a></li></ul></nav>
        <nav aria-label="Company links"><h3>Company</h3><ul>
          <li><a href="/story">Our story</a></li>
          <li><a href="/privacy">Privacy policy</a></li>
          <li><a href="/terms">Terms</a></li>
          <li><button type="button" class="link-inline" data-cookie-settings>Cookie settings</button></li></ul></nav>
      </div>
      <div class="footer-base">
        <p>© ${year} Knot’ily. All rights reserved. Prices in INR, taxes included.</p>
        <p class="pay-marks" aria-label="Payment methods">UPI · Cards · Net banking · Wallets</p>
      </div>
    </footer>`;
  el.querySelector('[data-cookie-settings]').addEventListener('click', () => showConsentBanner({ force: true }));
}

export function renderFooterCategories(cats) {
  const ul = document.querySelector('[data-footer-cats]');
  if (!ul) return;
  ul.innerHTML = `<li><a href="/shop?sort=new">New in</a></li><li><a href="/shop">All pieces</a></li>` + cats.map((c) => `<li><a href="/shop/${encodeURIComponent(c.id)}">${esc(c.label)}</a></li>`).join('');
}
