// Thin, dependency-free client for the three Supabase services we use:
//   - Database: Postgres functions over PostgREST (/rest/v1/rpc/<fn>), service role only
//   - Auth: GoTrue (/auth/v1/*) for sign-up, sign-in, password reset, email verification
//   - Storage: signed upload URLs for product media
import { createPublicKey, createHmac, verify as cryptoVerify, timingSafeEqual } from 'node:crypto';
import { env } from '../env.js';
import { ApiError } from '../http.js';

const FRIENDLY = {
  OUT_OF_STOCK: 'Sorry, this size and colour is out of stock.',
  INSUFFICIENT_STOCK: 'Not enough left in stock for that quantity.',
  UNAVAILABLE: 'This item is no longer available.',
  NOT_FOUND: 'Not found.',
  EMPTY: 'Your bag is empty.',
  IN_STOCK: 'Good news: this one is in stock, so there is no need for a reminder.',
  WISHLIST_FULL: 'Your wishlist is full (200 pieces). Remove a few to add more.',
  BAD_QTY: 'Choose a quantity between 1 and 10.',
  BAD_TRANSITION: 'That status change is not allowed.',
};

export async function rpc(fn, args = {}) {
  if (!env.supabaseUrl || !env.supabaseServiceKey) throw new Error('Supabase is not configured');
  const res = await fetch(`${env.supabaseUrl}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: {
      apikey: env.supabaseServiceKey,
      authorization: `Bearer ${env.supabaseServiceKey}`,
      'content-type': 'application/json',
      accept: 'application/json',
    },
    body: JSON.stringify({ p: args }),
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) {
    // business-rule errors raised by our functions come back as code P0001
    if (data?.code === 'P0001') {
      let detail = {};
      try {
        detail = data.details ? JSON.parse(data.details) : {};
      } catch {}
      const code = data.message;
      throw new ApiError(code === 'NOT_FOUND' ? 404 : 409, code, FRIENDLY[code] || code, detail);
    }
    console.error(`[db] ${fn} failed`, res.status, data?.code, data?.message);
    throw new ApiError(502, 'DB_ERROR', 'Something went wrong. Please try again.');
  }
  return data;
}

// ------------------------------------------------------------------ auth (GoTrue)
async function gotrue(path, { method = 'POST', body, token, query } = {}) {
  const url = new URL(`${env.supabaseUrl}/auth/v1${path}`);
  for (const [k, v] of Object.entries(query || {})) url.searchParams.set(k, v);
  const res = await fetch(url, {
    method,
    headers: {
      apikey: env.supabaseAnonKey || env.supabaseServiceKey,
      authorization: `Bearer ${token || env.supabaseAnonKey || env.supabaseServiceKey}`,
      'content-type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {}
  return { ok: res.ok, status: res.status, data };
}

export const auth = {
  signUp: (email, password, redirectTo) => gotrue('/signup', { body: { email, password }, query: { redirect_to: redirectTo } }),
  signIn: (email, password) => gotrue('/token', { body: { email, password }, query: { grant_type: 'password' } }),
  refresh: (refreshToken) => gotrue('/token', { body: { refresh_token: refreshToken }, query: { grant_type: 'refresh_token' } }),
  recover: (email, redirectTo) => gotrue('/recover', { body: { email }, query: { redirect_to: redirectTo } }),
  resend: (email, redirectTo) => gotrue('/resend', { body: { type: 'signup', email }, query: { redirect_to: redirectTo } }),
  getUser: (token) => gotrue('/user', { method: 'GET', token }),
  updatePassword: (token, password) => gotrue('/user', { method: 'PUT', token, body: { password } }),
  signOut: (token) => gotrue('/logout', { token }),
};

// Verify a Supabase access token locally (no network round trip per request).
// Supports the current asymmetric signing keys (JWKS: ES256/RS256) and legacy HS256.
let jwks = { at: 0, keys: [] };
async function loadJwks() {
  if (Date.now() - jwks.at < 10 * 60 * 1000 && jwks.keys.length) return jwks.keys;
  try {
    const res = await fetch(`${env.supabaseUrl}/auth/v1/.well-known/jwks.json`);
    if (res.ok) jwks = { at: Date.now(), keys: (await res.json()).keys || [] };
  } catch {}
  return jwks.keys;
}

export async function verifyAccessToken(token) {
  const parts = String(token || '').split('.');
  if (parts.length !== 3) return null;
  let header, payload;
  try {
    header = JSON.parse(Buffer.from(parts[0], 'base64url').toString());
    payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString());
  } catch {
    return null;
  }
  const data = Buffer.from(`${parts[0]}.${parts[1]}`);
  const sig = Buffer.from(parts[2], 'base64url');
  let valid = false;
  if (header.alg === 'HS256' && process.env.SUPABASE_JWT_SECRET) {
    const expect = createHmac('sha256', process.env.SUPABASE_JWT_SECRET).update(data).digest();
    valid = expect.length === sig.length && timingSafeEqual(expect, sig);
  } else if (header.alg === 'ES256' || header.alg === 'RS256') {
    const jwk = (await loadJwks()).find((k) => k.kid === header.kid) || null;
    if (jwk) {
      const key = createPublicKey({ key: jwk, format: 'jwk' });
      valid = cryptoVerify('sha256', data, header.alg === 'ES256' ? { key, dsaEncoding: 'ieee-p1363' } : key, sig);
    } else {
      // unknown key id: fall back to asking Supabase directly
      const r = await auth.getUser(token);
      return r.ok ? { sub: r.data.id, email: r.data.email, email_verified: !!r.data.email_confirmed_at, exp: payload.exp } : null;
    }
  } else {
    const r = await auth.getUser(token);
    return r.ok ? { sub: r.data.id, email: r.data.email, email_verified: !!r.data.email_confirmed_at, exp: payload.exp } : null;
  }
  if (!valid) return null;
  if (!payload.exp || payload.exp * 1000 < Date.now()) return null;
  if (payload.aud !== 'authenticated' && !(Array.isArray(payload.aud) && payload.aud.includes('authenticated'))) return null;
  return payload;
}

// ------------------------------------------------------------------ storage
export async function signedUpload(path) {
  const res = await fetch(`${env.supabaseUrl}/storage/v1/object/upload/sign/${env.storageBucket}/${path}`, {
    method: 'POST',
    headers: { apikey: env.supabaseServiceKey, authorization: `Bearer ${env.supabaseServiceKey}`, 'content-type': 'application/json' },
    body: '{}',
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.url) throw new ApiError(502, 'STORAGE_ERROR', 'Could not prepare the upload. Please try again.');
  return {
    uploadUrl: `${env.supabaseUrl}/storage/v1${data.url}`,
    publicUrl: `${env.supabaseUrl}/storage/v1/object/public/${env.storageBucket}/${path}`,
  };
}
