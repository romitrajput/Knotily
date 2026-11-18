// Sign up / log in / forgot password. Used two ways:
//  - requireAccount(): the pop-up shown when a signed-out shopper taps Buy now or Remind me
//  - authPanel(): the same forms inline on /account
import { post } from '../lib/api.js';
import { setUser, currentUser, saveIntent } from '../store/session.js';
import { anonId, track } from '../lib/analytics.js';
import { getConsent } from '../lib/consent.js';
import { esc, $ } from '../lib/util.js';

const EMAIL_RX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const pwOk = (p) => p.length >= 8 && p.length <= 72 && /[A-Za-z]/.test(p) && /\d/.test(p);

const eye = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z" fill="none" stroke="currentColor" stroke-width="1.6"/><circle cx="12" cy="12" r="3" fill="none" stroke="currentColor" stroke-width="1.6"/></svg>`;

function input(name, label, attrs = '', hint = '') {
  const pw = /type="password"/.test(attrs);
  return `<div class="field">
    <label for="a-${name}">${label}</label>
    <div class="${pw ? 'pw-wrap' : ''}">
      <input id="a-${name}" name="${name}" ${attrs} aria-describedby="ae-${name}${hint ? ` ah-${name}` : ''}" />
      ${pw ? `<button type="button" class="pw-toggle" data-pw-toggle aria-label="Show password" aria-pressed="false">${eye}</button>` : ''}
    </div>
    ${hint ? `<p class="field-hint" id="ah-${name}">${hint}</p>` : ''}
    <p class="field-error" id="ae-${name}" hidden></p>
  </div>`;
}

function viewHTML(mode, { reason = '', email = '' } = {}) {
  if (mode === 'login') {
    return `
      <h2 class="auth-title" id="auth-title">Log in</h2>
      ${reason ? `<p class="auth-reason">Log in to carry on. Your bag and saved details are on your account.</p>` : ''}
      <form class="auth-form" data-form="login" novalidate>
        ${input('email', 'Email', `type="email" autocomplete="email" required value="${esc(email)}"`)}
        ${input('password', 'Password', 'type="password" autocomplete="current-password" required')}
        <p class="form-error" data-form-error role="alert" hidden></p>
        <button class="btn btn-block btn-lg" type="submit">Log in</button>
      </form>
      <p class="auth-switch"><button type="button" class="link-btn" data-mode="forgot">Forgot password?</button></p>
      <p class="auth-switch">New to Knot’ily? <button type="button" class="link-btn" data-mode="signup">Create an account</button></p>`;
  }
  if (mode === 'forgot') {
    return `
      <h2 class="auth-title" id="auth-title">Reset your password</h2>
      <p class="auth-reason">Enter the email you signed up with. We'll send a link to set a new password.</p>
      <form class="auth-form" data-form="forgot" novalidate>
        ${input('email', 'Email', `type="email" autocomplete="email" required value="${esc(email)}"`)}
        <p class="form-error" data-form-error role="alert" hidden></p>
        <button class="btn btn-block btn-lg" type="submit">Send reset link</button>
      </form>
      <p class="auth-switch"><button type="button" class="link-btn" data-mode="login">Back to log in</button></p>`;
  }
  if (mode === 'sent-reset') {
    return `
      <h2 class="auth-title" id="auth-title">Check your inbox</h2>
      <p class="auth-reason">If <strong>${esc(email)}</strong> has a Knot’ily account, a reset link is on its way. It works for one hour.</p>
      <p class="auth-switch"><button type="button" class="link-btn" data-mode="login">Back to log in</button></p>`;
  }
  if (mode === 'verify') {
    return `
      <h2 class="auth-title" id="auth-title">Confirm your email</h2>
      <p class="auth-reason">We sent a link to <strong>${esc(email)}</strong>. Tap it to switch on your account, then you can check out.</p>
      <p class="auth-small">Nothing there after a minute? Check spam or promotions.</p>
      <p class="form-error" data-form-error role="alert" hidden></p>
      <button type="button" class="btn btn-ghost btn-block" data-resend data-email="${esc(email)}">Send the link again</button>
      <p class="auth-switch">Already confirmed? <button type="button" class="link-btn" data-mode="login">Log in</button></p>`;
  }
  // signup
  return `
    <h2 class="auth-title" id="auth-title">Create your account</h2>
    ${reason ? `<p class="auth-reason">${esc(reason)}</p>` : ''}
    <form class="auth-form" data-form="signup" novalidate>
      ${input('fullName', 'Full name', 'autocomplete="name" required maxlength="80"')}
      ${input('email', 'Email', `type="email" autocomplete="email" required value="${esc(email)}"`, 'This is your user ID. Order updates come here.')}
      ${input('password', 'Password', 'type="password" autocomplete="new-password" required maxlength="72"', 'At least 8 characters, with a letter and a number.')}
      ${input('confirmPassword', 'Confirm password', 'type="password" autocomplete="new-password" required maxlength="72"')}
      <label class="check">
        <input type="checkbox" name="acceptTerms" required />
        <span>I agree to the <a href="/terms" target="_blank">terms</a> and <a href="/privacy" target="_blank">privacy policy</a>.</span>
      </label>
      <p class="field-error" id="ae-acceptTerms" hidden></p>
      <p class="form-error" data-form-error role="alert" hidden></p>
      <button class="btn btn-block btn-lg" type="submit">Create account</button>
    </form>
    <p class="auth-switch">Already have an account? <button type="button" class="link-btn" data-mode="login">Log in</button></p>`;
}

function showErr(form, name, msg) {
  const el = $(`#ae-${name}`, form.closest('[data-auth]'));
  const inp = form.elements[name];
  if (el) {
    el.textContent = msg || '';
    el.hidden = !msg;
  }
  if (inp) inp.toggleAttribute('aria-invalid', !!msg);
  return !msg;
}

function validate(form, kind) {
  const f = form.elements;
  const checks = [];
  if (f.fullName) checks.push(showErr(form, 'fullName', f.fullName.value.trim().length >= 2 ? '' : 'Enter your full name.'));
  if (f.email) checks.push(showErr(form, 'email', EMAIL_RX.test(f.email.value.trim()) ? '' : 'Enter an email like name@example.com.'));
  if (f.password && kind === 'signup') checks.push(showErr(form, 'password', pwOk(f.password.value) ? '' : 'Use at least 8 characters, with a letter and a number.'));
  if (f.password && kind === 'login') checks.push(showErr(form, 'password', f.password.value ? '' : 'Enter your password.'));
  if (f.confirmPassword) checks.push(showErr(form, 'confirmPassword', f.confirmPassword.value && f.confirmPassword.value === f.password.value ? '' : 'The two passwords don’t match.'));
  if (f.acceptTerms) checks.push(showErr(form, 'acceptTerms', f.acceptTerms.checked ? '' : 'Please accept the terms to continue.'));
  const firstBad = form.querySelector('[aria-invalid]');
  firstBad?.focus();
  return checks.every(Boolean);
}

// Binds the forms inside `host` (re-rendered on mode switch).
export function authPanel(host, { mode = 'signup', reason = '', onSignedIn = () => {}, onClose } = {}) {
  let state = { mode, reason, email: '' };
  const render = () => {
    host.innerHTML = viewHTML(state.mode, state);
    host.dataset.auth = state.mode;
    const first = host.querySelector('input:not([type=checkbox])') || host.querySelector('button');
    setTimeout(() => first?.focus({ preventScroll: true }), 30);
  };
  const go = (m) => {
    const em = host.querySelector('input[name=email]')?.value.trim();
    if (em) state.email = em;
    state.mode = m;
    if (m === 'signup') track('signup_start');
    render();
  };

  host.addEventListener('click', async (e) => {
    const m = e.target.closest('[data-mode]');
    if (m) return go(m.dataset.mode);
    const t = e.target.closest('[data-pw-toggle]');
    if (t) {
      const inp = t.previousElementSibling;
      const show = inp.type === 'password';
      inp.type = show ? 'text' : 'password';
      t.setAttribute('aria-pressed', String(show));
      t.setAttribute('aria-label', show ? 'Hide password' : 'Show password');
      return;
    }
    const r = e.target.closest('[data-resend]');
    if (r) {
      r.disabled = true;
      try {
        await post('/api/auth/resend', { email: r.dataset.email });
        r.textContent = 'Sent. Check your inbox.';
      } catch (err) {
        const fe = host.querySelector('[data-form-error]');
        fe.textContent = err.message;
        fe.hidden = false;
        r.disabled = false;
      }
    }
  });

  host.addEventListener('input', (e) => {
    const form = e.target.form;
    if (form && e.target.getAttribute('aria-invalid') != null) validate(form, form.dataset.form);
  });

  host.addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = e.target;
    const kind = form.dataset.form;
    const fe = form.querySelector('[data-form-error]');
    fe.hidden = true;
    if (!validate(form, kind)) return;
    const f = form.elements;
    const btn = form.querySelector('button[type=submit]');
    const label = btn.textContent;
    btn.disabled = true;
    btn.textContent = 'One moment…';
    const email = f.email.value.trim().toLowerCase();
    state.email = email;
    try {
      if (kind === 'signup') {
        const r = await post('/api/auth/signup', {
          fullName: f.fullName.value.trim(), email, password: f.password.value, confirmPassword: f.confirmPassword.value,
          acceptTerms: f.acceptTerms.checked, consentAnalytics: getConsent() === true,
        });
        track('signup');
        if (r.verify) {
          state.mode = 'verify';
          render();
        } else {
          const me = await post('/api/auth/login', { email, password: f.password.value, anonId: anonId() });
          setUser(me.user);
          onSignedIn(me.user);
        }
      } else if (kind === 'login') {
        const r = await post('/api/auth/login', { email, password: f.password.value, anonId: anonId() });
        setUser(r.user);
        track('login');
        onSignedIn(r.user);
      } else if (kind === 'forgot') {
        await post('/api/auth/forgot', { email });
        state.mode = 'sent-reset';
        render();
      }
    } catch (err) {
      btn.disabled = false;
      btn.textContent = label;
      if (err.code === 'EMAIL_NOT_CONFIRMED') {
        state.mode = 'verify';
        render();
        return;
      }
      if (err.field && form.elements[err.field]) {
        showErr(form, err.field, err.message);
        form.elements[err.field].focus();
      } else {
        fe.textContent = err.message;
        fe.hidden = false;
      }
    }
  });

  render();
  return { go };
}

// ------------------------------------------------------------------ pop-up
let open = null;

export function requireAccount({ reason = 'Create a free account to buy. It takes a minute, and your details are saved for next time.', intent = null, mode = 'signup' } = {}) {
  const u = currentUser();
  if (u) return Promise.resolve(u);
  if (intent) saveIntent(intent);
  track('signup_prompt', { reason: intent?.action || 'buy' });
  if (open) open.close(null);

  return new Promise((resolve) => {
    const last = document.activeElement;
    const wrap = document.createElement('div');
    wrap.className = 'modal-root';
    wrap.innerHTML = `
      <div class="modal-scrim" data-dismiss></div>
      <div class="modal" role="dialog" aria-modal="true" aria-labelledby="auth-title">
        <button type="button" class="icon-btn modal-close" data-dismiss aria-label="Close">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>
        </button>
        <div class="modal-body" data-auth-host></div>
      </div>`;
    document.body.appendChild(wrap);
    document.body.classList.add('modal-open');
    requestAnimationFrame(() => wrap.classList.add('in'));

    const close = (value) => {
      if (!open) return;
      open = null;
      wrap.classList.remove('in');
      document.body.classList.remove('modal-open');
      document.removeEventListener('keydown', onKey);
      setTimeout(() => wrap.remove(), 250);
      last?.focus?.({ preventScroll: true });
      resolve(value);
    };
    const onKey = (e) => {
      if (e.key === 'Escape') close(null);
      if (e.key === 'Tab') {
        const f = wrap.querySelectorAll('a[href], button:not([disabled]), input:not([disabled])');
        const first = f[0];
        const lastEl = f[f.length - 1];
        if (e.shiftKey && document.activeElement === first) (e.preventDefault(), lastEl.focus());
        else if (!e.shiftKey && document.activeElement === lastEl) (e.preventDefault(), first.focus());
      }
    };
    document.addEventListener('keydown', onKey);
    wrap.addEventListener('click', (e) => e.target.closest('[data-dismiss]') && close(null));
    open = { close };
    authPanel(wrap.querySelector('[data-auth-host]'), { mode, reason, onSignedIn: (user) => close(user) });
  });
}
