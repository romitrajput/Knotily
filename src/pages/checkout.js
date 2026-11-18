import { refresh, snapshot, clearLocal } from '../store/cart.js';
import { loadSession, currentUser } from '../store/session.js';
import { lineItemsHTML } from '../components/cartDrawer.js';
import { authPanel } from '../components/auth.js';
import { payOrder } from '../services/payment.js';
import { navigate } from '../router.js';
import { hydrate } from '../components/media.js';
import { get, post } from '../lib/api.js';
import { track, sessionId } from '../lib/analytics.js';
import { deviceHints } from '../lib/device.js';
import { formatPrice, esc, $, $$ } from '../lib/util.js';
import { config } from '../config.js';

const STATES = ['Andaman and Nicobar Islands','Andhra Pradesh','Arunachal Pradesh','Assam','Bihar','Chandigarh','Chhattisgarh','Dadra and Nagar Haveli and Daman and Diu','Delhi','Goa','Gujarat','Haryana','Himachal Pradesh','Jammu and Kashmir','Jharkhand','Karnataka','Kerala','Ladakh','Lakshadweep','Madhya Pradesh','Maharashtra','Manipur','Meghalaya','Mizoram','Nagaland','Odisha','Puducherry','Punjab','Rajasthan','Sikkim','Tamil Nadu','Telangana','Tripura','Uttar Pradesh','Uttarakhand','West Bengal'];
const GENDERS = [['', 'Prefer not to answer'], ['female', 'Female'], ['male', 'Male'], ['non-binary', 'Non-binary'], ['prefer-not-to-say', 'Prefer not to say']];

const RULES = {
  fullName: [(v) => v.trim().length >= 2, 'Enter the name for delivery.'],
  phone: [(v) => /^[6-9]\d{9}$/.test(v.replace(/\D/g, '').slice(-10)), 'Enter a 10-digit mobile number.'],
  line1: [(v) => v.trim().length >= 4, 'Enter your house number and street.'],
  city: [(v) => v.trim().length >= 2, 'Enter your city.'],
  state: [(v) => STATES.includes(v), 'Choose your state.'],
  pin: [(v) => /^[1-9]\d{5}$/.test(v.trim()), 'Enter a 6-digit PIN code.'],
  age: [(v) => !v || (/^\d{1,3}$/.test(v) && +v >= 13 && +v <= 100), 'Enter an age between 13 and 100, or leave it blank.'],
};

function field(id, label, attrs = '', hint = '', value = '') {
  return `<div class="field">
    <label for="f-${id}">${label}</label>
    <input id="f-${id}" name="${id}" ${attrs} value="${esc(value)}" aria-describedby="e-${id}${hint ? ` h-${id}` : ''}" />
    ${hint ? `<p class="field-hint" id="h-${id}">${hint}</p>` : ''}
    <p class="field-error" id="e-${id}" hidden></p>
  </div>`;
}

function summaryHTML(s) {
  return `
    <ul class="lines lines-compact">${lineItemsHTML(s, { compact: true })}</ul>
    <dl class="sum">
      ${s.mrp > s.subtotal ? `<div><dt>You save</dt><dd>${formatPrice(s.mrp - s.subtotal)}</dd></div>` : ''}
      <div><dt>Subtotal</dt><dd>${formatPrice(s.subtotal)}</dd></div>
      <div><dt>Shipping</dt><dd>${s.shipping ? formatPrice(s.shipping) : 'Free'}</dd></div>
      <div class="sum-total"><dt>Total</dt><dd>${formatPrice(s.total)}</dd></div>
    </dl>`;
}

function testNotice() {
  if (config.paymentProvider === 'mock') return `<p class="notice">Local test mode: payments are simulated on this computer. No money moves.</p>`;
  if (config.env !== 'production') {
    return `<p class="notice">Testing environment: Razorpay is in test mode. Pay with card 4111 1111 1111 1111 (any future date, any CVV, OTP any 4–6 digits) or UPI <b>success@razorpay</b>. No money moves.</p>`;
  }
  return '';
}

export default async function checkout() {
  const user = await loadSession();
  if (!user) {
    return {
      name: 'checkout',
      title: 'Checkout',
      html: `<section class="page-narrow auth-page"><h1 class="page-title">Checkout</h1><div class="auth-card" data-auth-host></div></section>`,
      mount(root) {
        authPanel($('[data-auth-host]', root), {
          mode: 'signup',
          reason: 'Create a free account (or log in) to check out. Your bag and details are saved to it.',
          onSignedIn: () => navigate('/checkout', { replace: true }),
        });
      },
    };
  }

  const [s, acc] = await Promise.all([refresh().catch(() => snapshot()), get('/api/account').catch(() => ({}))]);
  if (!s.items.length) {
    return {
      name: 'checkout',
      title: 'Checkout',
      html: `<section class="page-narrow"><h1 class="page-title">Checkout</h1>
        <div class="empty empty-page"><p>Your bag is empty, so there's nothing to check out yet.</p><a class="btn" href="/shop">Shop the drop</a></div></section>`,
    };
  }
  const a = acc.address || {};
  const email = acc.email || currentUser()?.email || '';

  return {
    name: 'checkout',
    title: 'Checkout',
    html: `
    <section class="checkout">
      <h1 class="page-title">Checkout</h1>
      ${testNotice()}
      <div class="checkout-layout">
        <form class="checkout-form" data-checkout novalidate>
          <fieldset>
            <legend>Contact</legend>
            <div class="field">
              <label for="f-email">Email</label>
              <input id="f-email" type="email" value="${esc(email)}" readonly aria-describedby="h-email" />
              <p class="field-hint" id="h-email">Your account email. Receipts and shipping updates come here.</p>
            </div>
            ${field('fullName', 'Full name', 'autocomplete="name" required maxlength="80"', '', a.fullName || acc.fullName || '')}
            ${field('phone', 'Mobile number', 'type="tel" inputmode="numeric" autocomplete="tel-national" maxlength="14" required', 'For the courier to reach you.', a.phone || acc.phone || '')}
          </fieldset>

          <fieldset>
            <legend>Shipping address</legend>
            ${field('line1', 'House number and street', 'autocomplete="address-line1" required maxlength="160"', '', a.line1 || '')}
            ${field('line2', 'Area or locality (optional)', 'autocomplete="address-line2" maxlength="160"', '', a.line2 || '')}
            ${field('landmark', 'Landmark (optional)', 'maxlength="120"', 'Helps the courier find you, e.g. “opposite City Mall”.', a.landmark || '')}
            <div class="field-row">
              ${field('city', 'City', 'autocomplete="address-level2" required maxlength="80"', '', a.city || '')}
              ${field('pin', 'PIN code', 'inputmode="numeric" autocomplete="postal-code" maxlength="6" required', '', a.pin || '')}
            </div>
            <div class="field">
              <label for="f-state">State</label>
              <select id="f-state" name="state" autocomplete="address-level1" required aria-describedby="e-state">
                <option value="">Choose a state</option>
                ${STATES.map((st) => `<option ${st === a.state ? 'selected' : ''}>${st}</option>`).join('')}
              </select>
              <p class="field-error" id="e-state" hidden></p>
            </div>
          </fieldset>

          <fieldset>
            <legend>About you <span class="legend-note">optional</span></legend>
            <p class="field-hint fieldset-hint">Helps us plan sizes and styles. Stored encrypted, never shared.</p>
            <div class="field-row">
              ${field('age', 'Age', 'type="number" inputmode="numeric" min="13" max="100"', '', acc.age || '')}
              <div class="field">
                <label for="f-gender">Gender</label>
                <select id="f-gender" name="gender">${GENDERS.map(([v, l]) => `<option value="${v}" ${v === (acc.gender || '') ? 'selected' : ''}>${l}</option>`).join('')}</select>
              </div>
            </div>
            <label class="check"><input type="checkbox" name="saveAddress" checked /><span>Save these details for next time</span></label>
          </fieldset>

          <p class="form-error" data-form-error role="alert" hidden></p>
          <button class="btn btn-block btn-lg" type="submit" data-place>Pay ${formatPrice(s.total)}</button>
          <p class="pay-note">Secure payment by Razorpay: UPI, cards, net banking and wallets.</p>
        </form>

        <aside class="summary" aria-label="Order summary">
          <h2>Your order</h2>
          <div data-summary>${summaryHTML(s)}</div>
          <a class="link-btn" href="/bag">Edit bag</a>
        </aside>
      </div>
    </section>`,

    mount(root) {
      const form = $('[data-checkout]', root);
      const summary = $('[data-summary]', root);
      const formErr = $('[data-form-error]', root);
      const btn = $('[data-place]', root);
      hydrate(summary);
      track('checkout_start', { value: s.total, items: s.count });

      const setErr = (name, msg) => {
        const err = $(`#e-${name}`, form);
        const el = form.elements[name];
        if (err) {
          err.textContent = msg || '';
          err.hidden = !msg;
        }
        el?.toggleAttribute('aria-invalid', !!msg);
        return !msg;
      };
      const check = (name) => {
        const [ok, msg] = RULES[name];
        return setErr(name, ok(form.elements[name].value || '') ? '' : msg);
      };

      form.addEventListener('change', (e) => RULES[e.target.name] && e.target.value && check(e.target.name));
      form.addEventListener('input', (e) => e.target.getAttribute('aria-invalid') != null && RULES[e.target.name] && check(e.target.name));

      const lock = (on) => {
        btn.disabled = on;
        $$('input:not([readonly]), select', form).forEach((el) => (el.disabled = on));
      };

      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        formErr.hidden = true;
        const bad = Object.keys(RULES).filter((n) => !check(n));
        if (bad.length) {
          form.elements[bad[0]].focus();
          return;
        }
        const f = form.elements;
        const shipping = {
          fullName: f.fullName.value.trim(), phone: f.phone.value.replace(/\D/g, '').slice(-10),
          line1: f.line1.value.trim(), line2: f.line2.value.trim(), landmark: f.landmark.value.trim(),
          city: f.city.value.trim(), state: f.state.value, pin: f.pin.value.trim(),
          age: f.age.value ? Number(f.age.value) : null, gender: f.gender.value || null,
        };
        const saveAddress = f.saveAddress.checked;
        lock(true);
        btn.textContent = 'Reserving your pieces…';
        let order;
        try {
          order = await post('/api/checkout', { shipping, saveAddress, sessionId: sessionId(), hints: deviceHints() });
        } catch (err) {
          lock(false);
          btn.textContent = `Pay ${formatPrice(snapshot().total)}`;
          if (err.field && form.elements[err.field]) {
            setErr(err.field, err.message);
            form.elements[err.field].focus();
            return;
          }
          if (['OUT_OF_STOCK', 'INSUFFICIENT_STOCK', 'UNAVAILABLE', 'EMPTY'].includes(err.code)) {
            const next = await refresh().catch(() => snapshot());
            summary.innerHTML = summaryHTML(next);
            hydrate(summary);
          }
          formErr.textContent = err.message;
          formErr.hidden = false;
          return;
        }

        btn.textContent = 'Waiting for payment…';
        const result = await payOrder(order);
        if (result.status === 'paid') {
          clearLocal();
          navigate(`/order/${result.orderId}?new=1`, { replace: true });
          return;
        }
        lock(false);
        btn.textContent = `Pay ${formatPrice(snapshot().total)}`;
        formErr.textContent = result.message || 'The payment did not go through. Nothing was charged.';
        formErr.hidden = false;
        if (result.code === 'SOLD_OUT_REFUNDED') {
          const next = await refresh().catch(() => snapshot());
          summary.innerHTML = summaryHTML(next);
          hydrate(summary);
        }
      });
    },
  };
}
