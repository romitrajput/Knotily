// Landing pages for the links in Supabase's emails:
//   /account/verified  "Confirm your email"  -> signs the shopper in and offers to carry on
//   /account/reset     "Reset your password" -> new password + confirmation
// Supabase puts the tokens in the URL fragment (#access_token=…), which never reaches
// any server log; we hand them to our API once, which turns them into httpOnly cookies,
// and wipe them from the address bar straight away.
import { post, put } from '../lib/api.js';
import { setUser, loadSession, takeIntent, peekIntent } from '../store/session.js';
import { authPanel } from '../components/auth.js';
import { add } from '../store/cart.js';
import { getProductBySlug, loadCatalog } from '../services/catalog.js';
import { anonId, track } from '../lib/analytics.js';
import { toast } from '../components/toast.js';
import { navigate } from '../router.js';
import { esc, $ } from '../lib/util.js';

function readFragment() {
  const h = new URLSearchParams(location.hash.slice(1));
  if (location.hash) history.replaceState({}, '', location.pathname + location.search);
  return {
    access_token: h.get('access_token'),
    refresh_token: h.get('refresh_token'),
    expires_in: h.get('expires_in'),
    error: h.get('error_description') || h.get('error'),
    type: h.get('type'),
  };
}

// fragment is read once per page load (the router may render twice)
let cached = null;
const fragment = () => (cached ||= readFragment());

export async function verified() {
  const t = fragment();
  let user = null;
  let error = t.error;
  if (t.access_token) {
    try {
      const r = await post('/api/auth/session', { access_token: t.access_token, refresh_token: t.refresh_token, expires_in: t.expires_in, anonId: anonId() });
      user = r.user;
      setUser(user);
      track('signup', { step: 'email_confirmed' });
    } catch (e) {
      error = e.message;
    }
  } else {
    user = await loadSession();
  }
  await loadCatalog().catch(() => {});
  const intent = user ? peekIntent() : null;
  const p = intent ? getProductBySlug(intent.slug) : null;

  if (!user) {
    return {
      name: 'account',
      title: 'Confirm your email',
      html: `<section class="page-narrow auth-page"><h1 class="page-title">That link didn’t work</h1>
        <p>${esc(error || 'It may have expired or already been used.')} Log in below; if your email isn’t confirmed yet, we’ll offer to send a fresh link.</p>
        <div class="auth-card" data-auth-host></div></section>`,
      mount(root) {
        authPanel($('[data-auth-host]', root), { mode: 'login', onSignedIn: () => navigate('/account', { replace: true }) });
      },
    };
  }

  return {
    name: 'account',
    title: 'Email confirmed',
    html: `<section class="page-narrow auth-page">
      <h1 class="page-title">You’re in${user.fullName ? `, ${esc(user.fullName.split(' ')[0])}` : ''}.</h1>
      <p class="confirm-lede">Your email is confirmed and you’re logged in on this device.</p>
      ${p && intent.action === 'buy' ? `<button type="button" class="btn btn-lg" data-continue>Continue: buy ${esc(p.name)} (${esc(intent.color)}, ${esc(intent.size)})</button>` : ''}
      ${p && intent.action === 'remind' ? `<button type="button" class="btn btn-lg" data-continue>Set the reminder for ${esc(p.name)} (${esc(intent.color)}, ${esc(intent.size)})</button>` : ''}
      ${p && intent.action === 'wish' ? `<button type="button" class="btn btn-lg" data-continue>Save ${esc(p.name)} to your wishlist</button>` : ''}
      <p><a class="${p ? 'text-link' : 'btn'}" href="/shop">${p ? 'Or keep browsing' : 'Start shopping'}</a></p>
    </section>`,
    mount(root) {
      root.querySelector('[data-continue]')?.addEventListener('click', async (e) => {
        const i = takeIntent();
        e.target.disabled = true;
        try {
          if (i.action === 'wish') {
            await put(`/api/wishlist/${p.id}`);
            track('wishlist_add', { product_id: p.id, source: 'after_signup' });
            toast('Saved to your wishlist.');
            navigate('/wishlist');
          } else if (i.action === 'buy') {
            await add(i.variantId, 1);
            track('add_to_cart', { product_id: p.id, variant_id: i.variantId, source: 'after_signup' });
            navigate('/checkout');
          } else {
            await post('/api/reminders', { variantId: i.variantId });
            track('reminder_set', { product_id: p.id, variant_id: i.variantId });
            toast('Done. We’ll email you when it’s back.');
            navigate(`/product/${p.slug}?color=${encodeURIComponent(i.color)}`);
          }
        } catch (err) {
          toast(esc(err.code === 'OUT_OF_STOCK' ? 'That size sold out in the meantime. You can set a reminder on the product page.' : err.code === 'IN_STOCK' ? 'Good news: it’s back in stock already.' : err.message));
          navigate(`/product/${p.slug}?color=${encodeURIComponent(i.color)}`);
        }
      });
    },
  };
}

export async function reset() {
  const t = fragment();
  if (!t.access_token) {
    return {
      name: 'account',
      title: 'Reset password',
      html: `<section class="page-narrow auth-page"><h1 class="page-title">Reset link expired</h1>
        <p>${esc(t.error || 'Reset links work once, for one hour.')} Ask for a new one:</p>
        <div class="auth-card" data-auth-host></div></section>`,
      mount(root) {
        authPanel($('[data-auth-host]', root), { mode: 'forgot', onSignedIn: () => navigate('/account', { replace: true }) });
      },
    };
  }
  return {
    name: 'account',
    title: 'Choose a new password',
    html: `<section class="page-narrow auth-page"><div class="auth-card" data-auth>
      <h2 class="auth-title">Choose a new password</h2>
      <form class="auth-form" data-reset novalidate>
        <div class="field"><label for="r-pw">New password</label><input id="r-pw" name="password" type="password" autocomplete="new-password" maxlength="72" required aria-describedby="r-pw-h r-pw-e" />
          <p class="field-hint" id="r-pw-h">At least 8 characters, with a letter and a number.</p><p class="field-error" id="r-pw-e" hidden></p></div>
        <div class="field"><label for="r-pw2">Confirm new password</label><input id="r-pw2" name="confirmPassword" type="password" autocomplete="new-password" maxlength="72" required aria-describedby="r-pw2-e" />
          <p class="field-error" id="r-pw2-e" hidden></p></div>
        <p class="form-error" data-form-error role="alert" hidden></p>
        <button class="btn btn-block btn-lg" type="submit">Save new password</button>
      </form></div></section>`,
    mount(root) {
      const form = $('[data-reset]', root);
      const e1 = $('#r-pw-e', root), e2 = $('#r-pw2-e', root), fe = $('[data-form-error]', root);
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const pw = form.password.value, pw2 = form.confirmPassword.value;
        const ok1 = pw.length >= 8 && /[A-Za-z]/.test(pw) && /\d/.test(pw);
        e1.textContent = 'Use at least 8 characters, with a letter and a number.';
        e1.hidden = ok1;
        e2.textContent = 'The two passwords don’t match.';
        e2.hidden = !ok1 || pw === pw2;
        if (!ok1 || pw !== pw2) return;
        const btn = form.querySelector('button');
        btn.disabled = true;
        try {
          await post('/api/auth/reset', { access_token: t.access_token, refresh_token: t.refresh_token, password: pw, confirmPassword: pw2 });
          await loadSession({ force: true });
          toast('Password updated. You’re logged in.');
          navigate('/account', { replace: true });
        } catch (err) {
          btn.disabled = false;
          fe.textContent = err.message;
          fe.hidden = false;
        }
      });
    },
  };
}

export default verified;
