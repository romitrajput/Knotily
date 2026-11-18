// Asks once whether analytics may run. Essential cookies (login, security) don't need consent.
import { getConsent, setConsent } from '../lib/consent.js';
import { currentUser } from '../store/session.js';
import { put } from '../lib/api.js';
import { track } from '../lib/analytics.js';

let el = null;

export function showConsentBanner({ force = false } = {}) {
  if (!force && getConsent() !== null) return;
  if (el) return;
  el = document.createElement('section');
  el.className = 'consent';
  el.setAttribute('role', 'region');
  el.setAttribute('aria-label', 'Cookie choices');
  el.innerHTML = `
    <p><strong>Help us make better drops?</strong> With your OK we record anonymous usage (pages, products, sizes, device) to plan designs and stock. Login and security cookies are always on. <a href="/privacy">Privacy policy</a></p>
    <div class="consent-actions">
      <button type="button" class="btn btn-line" data-choice="no">Only essential</button>
      <button type="button" class="btn" data-choice="yes">Accept analytics</button>
    </div>`;
  document.body.appendChild(el);
  requestAnimationFrame(() => el.classList.add('in'));
  el.addEventListener('click', (e) => {
    const b = e.target.closest('[data-choice]');
    if (!b) return;
    const yes = b.dataset.choice === 'yes';
    setConsent(yes);
    if (yes) track('consent', { analytics: true });
    if (currentUser()) put('/api/account', { consentAnalytics: yes }).catch(() => {});
    el.classList.remove('in');
    const gone = el;
    el = null;
    setTimeout(() => gone.remove(), 300);
  });
}
