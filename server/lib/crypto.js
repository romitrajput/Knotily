// Field-level encryption for personal data.
//
//  encrypt(value, context) -> "v1.<iv>.<tag>.<ciphertext>"   (AES-256-GCM, base64url parts)
//  decrypt(token, context)  -> original value
//
// - A fresh 96-bit IV per value; GCM's auth tag detects any tampering.
// - `context` (e.g. "profile:<user id>:phone") is bound in as additional authenticated
//   data, so a ciphertext copied onto another row or column will not decrypt.
// - Keys are versioned ("v1", "v2"...). New data uses DATA_ENCRYPTION_KEY_ID; old data
//   still decrypts with its own key, so keys can be rotated (scripts/rotate-keys.mjs).
// - blindIndex() gives a keyed HMAC of an email so we can find a record without decrypting.
import { createCipheriv, createDecipheriv, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { env } from '../env.js';

let ring = null;
function keys() {
  if (ring) return ring;
  let parsed;
  try {
    parsed = JSON.parse(env.encryptionKeys || '{}');
  } catch {
    throw new Error('DATA_ENCRYPTION_KEYS must be JSON like {"v1":"<base64 key>"}');
  }
  ring = new Map();
  for (const [id, b64] of Object.entries(parsed)) {
    const k = Buffer.from(b64, 'base64');
    if (k.length !== 32) throw new Error(`Encryption key ${id} must be 32 bytes (base64)`);
    ring.set(id, k);
  }
  if (!ring.has(env.encryptionKeyId)) throw new Error(`DATA_ENCRYPTION_KEY_ID "${env.encryptionKeyId}" not found in DATA_ENCRYPTION_KEYS`);
  return ring;
}
export function _resetKeyCache() {
  ring = null;
}

const b64u = (buf) => buf.toString('base64url');
const unb64u = (s) => Buffer.from(s, 'base64url');

export function encrypt(value, context) {
  if (value === undefined || value === null || value === '') return null;
  if (!context) throw new Error('encrypt() needs a context');
  const id = env.encryptionKeyId;
  const key = keys().get(id);
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(Buffer.from(`${id}|${context}`));
  const plain = Buffer.from(typeof value === 'string' ? 's' + value : 'j' + JSON.stringify(value), 'utf8');
  const ct = Buffer.concat([cipher.update(plain), cipher.final()]);
  return [id, b64u(iv), b64u(cipher.getAuthTag()), b64u(ct)].join('.');
}

export function decrypt(token, context) {
  if (!token) return null;
  const [id, iv, tag, ct] = String(token).split('.');
  const key = keys().get(id);
  if (!key || !iv || !tag || !ct) throw new Error('Unreadable encrypted value');
  const d = createDecipheriv('aes-256-gcm', key, unb64u(iv));
  d.setAAD(Buffer.from(`${id}|${context}`));
  d.setAuthTag(unb64u(tag));
  const plain = Buffer.concat([d.update(unb64u(ct)), d.final()]).toString('utf8');
  return plain[0] === 'j' ? JSON.parse(plain.slice(1)) : plain.slice(1);
}

// Decrypt, but return null instead of throwing (for bulk exports with damaged rows).
export function tryDecrypt(token, context) {
  try {
    return decrypt(token, context);
  } catch {
    return null;
  }
}

export const keyIdOf = (token) => (token ? String(token).split('.')[0] : null);

export function blindIndex(email) {
  if (!env.blindIndexKey) throw new Error('BLIND_INDEX_KEY is not set');
  return createHmac('sha256', Buffer.from(env.blindIndexKey, 'base64'))
    .update(String(email).trim().toLowerCase())
    .digest('hex');
}

// Short-lived signed tokens (owner re-authentication for data export).
export function signToken(payload, ttlSeconds) {
  const body = b64u(Buffer.from(JSON.stringify({ ...payload, exp: Math.floor(Date.now() / 1000) + ttlSeconds })));
  const sig = b64u(createHmac('sha256', env.tokenSecret).update(body).digest());
  return `${body}.${sig}`;
}

export function verifyToken(token) {
  const [body, sig] = String(token || '').split('.');
  if (!body || !sig) return null;
  const expect = createHmac('sha256', env.tokenSecret).update(body).digest();
  const got = unb64u(sig);
  if (got.length !== expect.length || !timingSafeEqual(got, expect)) return null;
  const payload = JSON.parse(unb64u(body).toString('utf8'));
  if (payload.exp < Math.floor(Date.now() / 1000)) return null;
  return payload;
}

// Hash an IP address for rate-limit keys so raw IPs are never stored.
export function hashIp(ip) {
  return createHmac('sha256', env.tokenSecret || 'ip').update(String(ip || '')).digest('hex').slice(0, 32);
}

export function safeEqual(a, b) {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && timingSafeEqual(x, y);
}
