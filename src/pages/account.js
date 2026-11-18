import { get, put, del, post } from '../lib/api.js';
import { loadSession, currentUser, logout } from '../store/session.js';
import { authPanel } from '../components/auth.js';
import { toast } from '../components/toast.js';
import { navigate } from '../router.js';
import { getConsent, setConsent } from '../lib/consent.js';
import { track } from '../lib/analytics.js';
import { STATUS } from './order.js';
import { formatPrice, esc, $ } from '../lib/util.js';
import { config } from '../config.js';

const safeNext = (n) => (typeof n === 'string' && /^\/(?!\/)[\w\-/?=&%.]*$/.test(n) ? n : '/account');

export default async function account({ query }) {
  const user = await loadSession();
  if (!user) {
    return {
      name: 'account',
      title: 'Log in',
      html: `<section class="page-narrow auth-page"><div class="auth-card" data-auth-host></div></section>`,
      mount(root) {
        authPanel($('[data-auth-host]', root), {
          mode: query.mode === 'signup' ? 'signup' : 'login',
          onSignedIn: () => navigate(safeNext(query.next), { replace: true }),
        });
      },
    };
  }

  const [acc, orders, reminders] = await Promise.all([
    get('/api/account').catch(() => ({})),
    get('/api/account/orders').then((r) => r.orders).catch(() => []),
    get('/api/reminders').then((r) => r.reminders).catch(() => []),
  ]);

  return {
    name: 'account',
    title: 'Your account',
    html: `
    <section class="page-narrow account">
      <header class="account-head">
        <h1 class="page-title">Hi${acc.fullName ? `, ${esc(acc.fullName.split(' ')[0])}` : ''}</h1>
        <div class="account-head-actions">
          ${user.role === 'owner' ? '<a class="btn btn-line" href="/admin">Owner dashboard</a>' : ''}
          <button type="button" class="btn btn-line" data-logout>Log out</button>
        </div>
      </header>

      <div class="account-grid">
        <section class="panel" aria-labelledby="ord-title">
          <h2 id="ord-title">Orders</h2>
          ${orders.length ? `<ul class="order-list">${orders.map((o) => `
            <li><a href="/order/${esc(o.id)}">
              <span class="ol-num">${esc(o.number)}</span>
              <span class="ol-meta">${new Date(o.created_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })} · ${(o.items || []).reduce((s, i) => s + i.qty, 0)} item(s)</span>
              <span class="status status-${esc(o.status)}">${esc(STATUS[o.status] || o.status)}</span>
              <span class="ol-total">${formatPrice(o.total_paise / 100)}</span>
            </a></li>`).join('')}</ul>` : '<p class="muted">No orders yet. <a class="text-link" href="/shop">Shop the drop</a></p>'}
        </section>

        <section class="panel" aria-labelledby="rem-title">
          <h2 id="rem-title">Restock reminders</h2>
          ${reminders.length ? `<ul class="rem-list" data-reminders>${reminders.map((r) => `
            <li data-variant="${esc(r.variant_id)}">
              <a href="/product/${esc(r.slug)}?color=${encodeURIComponent(r.color)}">${esc(r.product)}</a>
              <span class="muted">${esc(r.color)}, ${esc(r.size)}</span>
              <button type="button" class="link-btn" data-cancel-reminder>Cancel</button>
            </li>`).join('')}</ul>` : '<p class="muted">When a size is sold out, tap “Remind me” and we’ll email you when it’s back.</p>'}
        </section>

        <section class="panel" aria-labelledby="det-title">
          <h2 id="det-title">Your details</h2>
          <form data-details novalidate>
            <div class="field"><label for="d-email">Email (your user ID)</label><input id="d-email" type="email" value="${esc(acc.email || user.email)}" readonly /></div>
            <div class="field"><label for="d-name">Full name</label><input id="d-name" name="fullName" autocomplete="name" maxlength="80" value="${esc(acc.fullName || '')}" required /></div>
            <div class="field"><label for="d-phone">Mobile number</label><input id="d-phone" name="phone" type="tel" inputmode="numeric" maxlength="14" value="${esc(acc.phone || '')}" /></div>
            <p class="form-error" data-form-error hidden></p>
            <button class="btn" type="submit">Save</button>
          </form>
          <p class="muted small">To change your password, log out and use “Forgot password?”.</p>
        </section>

        <section class="panel" aria-labelledby="priv-title">
          <h2 id="priv-title">Privacy</h2>
          <label class="check"><input type="checkbox" data-consent ${getConsent() === true ? 'checked' : ''} /><span>Help improve Knot’ily with anonymous usage analytics</span></label>
          <p class="muted small">Your name, phone, address, age and gender are stored encrypted. Read the <a href="/privacy">privacy policy</a>.</p>
          ${acc.deletionRequested
            ? '<p class="notice">Deletion requested. We’ll erase your account and personal data within 30 days and email you when it’s done.</p>'
            : '<button type="button" class="link-btn danger" data-delete>Delete my account and data</button>'}
        </section>
      </div>
    </section>`,

    mount(root) {
      $('[data-logout]', root).addEventListener('click', async () => {
        track('logout');
        await logout();
        navigate('/', { replace: true });
      });

      root.querySelector('[data-reminders]')?.addEventListener('click', async (e) => {
        const b = e.target.closest('[data-cancel-reminder]');
        if (!b) return;
        const li = b.closest('li');
        b.disabled = true;
        try {
          await del(`/api/reminders/${li.dataset.variant}`);
          li.remove();
          toast('Reminder cancelled.');
        } catch (err) {
          b.disabled = false;
          toast(esc(err.message));
        }
      });

      const form = $('[data-details]', root);
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const fe = $('[data-form-error]', form);
        fe.hidden = true;
        const name = form.fullName.value.trim();
        const phone = form.phone.value.replace(/\D/g, '').slice(-10);
        if (name.length < 2) return (fe.textContent = 'Enter your full name.'), (fe.hidden = false);
        if (phone && !/^[6-9]\d{9}$/.test(phone)) return (fe.textContent = 'Enter a 10-digit mobile number or leave it blank.'), (fe.hidden = false);
        try {
          await put('/api/account', { fullName: name, phone });
          toast('Saved.');
        } catch (err) {
          fe.textContent = err.message;
          fe.hidden = false;
        }
      });

      $('[data-consent]', root).addEventListener('change', async (e) => {
        setConsent(e.target.checked);
        await put('/api/account', { consentAnalytics: e.target.checked }).catch(() => {});
        toast(e.target.checked ? 'Thanks. Analytics switched on.' : 'Analytics switched off.');
      });

      root.querySelector('[data-delete]')?.addEventListener('click', async (e) => {
        if (!confirm('Delete your Knot’ily account and personal data? Orders already placed are kept for tax records in anonymised form. This can’t be undone.')) return;
        e.target.disabled = true;
        try {
          await post('/api/account/delete-request');
          e.target.outerHTML = '<p class="notice">Deletion requested. We’ll erase your account and personal data within 30 days and email you when it’s done.</p>';
        } catch (err) {
          e.target.disabled = false;
          toast(esc(err.message));
        }
      });
    },
  };
}
