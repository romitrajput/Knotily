// Sign-in sessions live in httpOnly cookies, so page scripts can never read the tokens.
//   kn_at  short-lived Supabase access token (about 1 hour)
//   kn_rt  refresh token (30 days), used to renew kn_at silently
import { env } from './env.js';
import { parseCookies, setCookie, unauthorized, forbidden } from './http.js';
import { auth, verifyAccessToken, rpc } from './lib/supabase.js';

const REFRESH_DAYS = 30;

export function setSessionCookies(res, t) {
  setCookie(res, 'kn_at', t.access_token, { maxAge: t.expires_in || 3600 });
  setCookie(res, 'kn_rt', t.refresh_token, { maxAge: REFRESH_DAYS * 86400 });
  // readable hint for the UI ("someone is signed in") without exposing any token
  setCookie(res, 'kn_in', '1', { maxAge: REFRESH_DAYS * 86400, path: '/', httpOnly: false });
}

export function clearSessionCookies(res) {
  setCookie(res, 'kn_at', '', { maxAge: 0 });
  setCookie(res, 'kn_rt', '', { maxAge: 0 });
  setCookie(res, 'kn_in', '', { maxAge: 0, path: '/', httpOnly: false });
}

// Returns { userId, email, token } or null. Renews an expired access token when it can.
export async function getSession(req, res) {
  if (req._session !== undefined) return req._session;
  const c = parseCookies(req);
  let claims = c.kn_at ? await verifyAccessToken(c.kn_at) : null;
  let token = c.kn_at;
  if (!claims && c.kn_rt) {
    const r = await auth.refresh(c.kn_rt);
    if (r.ok && r.data.access_token) {
      setSessionCookies(res, r.data);
      token = r.data.access_token;
      claims = await verifyAccessToken(token);
    } else {
      clearSessionCookies(res);
    }
  }
  req._session = claims ? { userId: claims.sub, email: claims.email, token } : null;
  return req._session;
}

export async function requireUser(req, res) {
  const s = await getSession(req, res);
  if (!s) throw unauthorized();
  return s;
}

export async function requireOwner(req, res) {
  const s = await requireUser(req, res);
  const profile = await rpc('profile_get', { id: s.userId });
  if (!profile || profile.role !== 'owner') throw forbidden('OWNER_ONLY', 'This area is for the store owner.');
  return { ...s, profile };
}

export const redirectUrl = (path) => `${env.siteUrl}${path}`;
