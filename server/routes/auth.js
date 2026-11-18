// Accounts: sign up (with password confirmation + email verification), sign in,
// sign out, forgot/reset password. Supabase Auth stores the password hash (bcrypt);
// we store the shopper's details encrypted in `profiles`.
import { readJson, bad, unauthorized, ApiError } from '../http.js';
import { auth, rpc } from '../lib/supabase.js';
import { encrypt, tryDecrypt, blindIndex } from '../lib/crypto.js';
import * as v from '../lib/validate.js';
import { setSessionCookies, clearSessionCookies, getSession, redirectUrl } from '../session.js';
import { limit } from '../ratelimit.js';

async function ensureProfile(userId, email, fullName) {
  const existing = await rpc('profile_get', { id: userId });
  if (existing && existing.enc_email) return existing;
  return rpc('profile_upsert', {
    id: userId,
    email_bidx: blindIndex(email),
    enc_email: encrypt(email, `profile:${userId}:email`),
    enc_full_name: fullName ? encrypt(fullName, `profile:${userId}:name`) : null,
  });
}

export function publicUser(session, profile) {
  return {
    id: session.userId,
    email: session.email || tryDecrypt(profile?.enc_email, `profile:${session.userId}:email`),
    fullName: tryDecrypt(profile?.enc_full_name, `profile:${session.userId}:name`) || '',
    role: profile?.role || 'customer',
  };
}

async function linkVisitor(userId, anonId) {
  if (typeof anonId === 'string' && /^[a-zA-Z0-9-]{8,64}$/.test(anonId)) {
    await rpc('identity_link', { anon_id: anonId, user_id: userId }).catch(() => {});
  }
}

export const routes = [
  ['POST', '/api/auth/signup', async (req) => {
    const b = await readJson(req);
    await limit(req, 'signup', 8, 3600);
    const email = v.email(b.email);
    const password = v.newPassword(b.password, b.confirmPassword);
    const fullName = v.str(b.fullName, { field: 'Full name', min: 2, max: 80, required: true });
    if (b.acceptTerms !== true) throw bad('TERMS', 'Please accept the terms and privacy policy.', { field: 'acceptTerms' });
    const r = await auth.signUp(email, password, redirectUrl('/account/verified'));
    if (!r.ok) {
      const msg = String(r.data.msg || r.data.error_description || r.data.message || '');
      if (/password/i.test(msg)) throw bad('WEAK_PASSWORD', 'Choose a stronger password.', { field: 'password' });
      if (r.status === 429) throw new ApiError(429, 'TOO_MANY_REQUESTS', 'Too many sign-up attempts. Please try again later.');
      if (r.status === 422 && /registered|exists/i.test(msg)) return { ok: true, verify: true }; // don't reveal existing accounts
      console.error('[auth] signup failed', r.status, msg.slice(0, 120));
      throw bad('SIGNUP_FAILED', 'We could not create the account. Please try again.');
    }
    const user = r.data.user || r.data;
    // Supabase returns a decoy user for addresses that already exist; the profile insert then
    // fails on the foreign key and we answer exactly as for a new sign-up.
    if (user?.id) {
      await rpc('profile_upsert', {
        id: user.id,
        email_bidx: blindIndex(email),
        enc_email: encrypt(email, `profile:${user.id}:email`),
        enc_full_name: encrypt(fullName, `profile:${user.id}:name`),
        consent_analytics: b.consentAnalytics === true,
      }).catch(() => {});
    }
    return { ok: true, verify: !r.data.access_token };
  }],

  ['POST', '/api/auth/login', async (req, res) => {
    const b = await readJson(req);
    const email = v.email(b.email);
    await limit(req, 'login', 20, 900);
    await limit(req, 'login-email', 10, 900, email);
    const r = await auth.signIn(email, String(b.password || ''));
    if (!r.ok) {
      const code = r.data.error_code || '';
      const msg = String(r.data.error_description || r.data.msg || '');
      if (code === 'email_not_confirmed' || /not confirmed/i.test(msg)) {
        throw new ApiError(403, 'EMAIL_NOT_CONFIRMED', 'Please confirm your email first. We can send the link again.');
      }
      throw new ApiError(401, 'BAD_CREDENTIALS', 'That email and password do not match.');
    }
    setSessionCookies(res, r.data);
    const profile = await ensureProfile(r.data.user.id, email);
    await linkVisitor(r.data.user.id, b.anonId);
    return { user: publicUser({ userId: r.data.user.id, email }, profile) };
  }],

  // Email links (verify address / reset password) land on our pages with tokens in the
  // URL fragment; the page hands them here so they become httpOnly cookies.
  ['POST', '/api/auth/session', async (req, res) => {
    const b = await readJson(req);
    const r = await auth.getUser(String(b.access_token || ''));
    if (!r.ok) throw unauthorized('LINK_EXPIRED', 'This link has expired. Request a new one.');
    setSessionCookies(res, { access_token: b.access_token, refresh_token: String(b.refresh_token || ''), expires_in: Number(b.expires_in) || 3600 });
    const profile = await ensureProfile(r.data.id, r.data.email);
    await linkVisitor(r.data.id, b.anonId);
    return { user: publicUser({ userId: r.data.id, email: r.data.email }, profile) };
  }],

  ['POST', '/api/auth/logout', async (req, res) => {
    const s = await getSession(req, res);
    if (s) await auth.signOut(s.token).catch(() => {});
    clearSessionCookies(res);
    return { ok: true };
  }],

  ['GET', '/api/auth/me', async (req, res) => {
    const s = await getSession(req, res);
    if (!s) return { user: null };
    const profile = await rpc('profile_get', { id: s.userId });
    return { user: publicUser(s, profile) };
  }],

  ['POST', '/api/auth/forgot', async (req) => {
    const b = await readJson(req);
    const email = v.email(b.email);
    await limit(req, 'forgot', 6, 3600);
    await limit(req, 'forgot-email', 3, 3600, email);
    await auth.recover(email, redirectUrl('/account/reset'));
    return { ok: true }; // same answer whether or not the account exists
  }],

  ['POST', '/api/auth/reset', async (req, res) => {
    const b = await readJson(req);
    await limit(req, 'reset', 10, 3600);
    const password = v.newPassword(b.password, b.confirmPassword);
    const token = String(b.access_token || '');
    const r = await auth.updatePassword(token, password);
    if (!r.ok) {
      const msg = String(r.data.msg || r.data.error_description || '');
      if (/different from the old/i.test(msg)) throw bad('SAME_PASSWORD', 'Choose a password you have not used before.', { field: 'password' });
      if (/password/i.test(msg) && r.status === 422) throw bad('WEAK_PASSWORD', 'Choose a stronger password.', { field: 'password' });
      throw unauthorized('LINK_EXPIRED', 'This reset link has expired. Request a new one.');
    }
    setSessionCookies(res, { access_token: token, refresh_token: String(b.refresh_token || ''), expires_in: 3600 });
    return { ok: true };
  }],

  ['POST', '/api/auth/resend', async (req) => {
    const b = await readJson(req);
    const email = v.email(b.email);
    await limit(req, 'resend', 5, 3600, email);
    await auth.resend(email, redirectUrl('/account/verified'));
    return { ok: true };
  }],
];
