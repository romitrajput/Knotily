// Small HTTP toolkit shared by every route (Node's http.IncomingMessage / ServerResponse).
import { env } from './env.js';

export class ApiError extends Error {
  constructor(status, code, message, extra = {}) {
    super(message || code);
    this.status = status;
    this.code = code;
    this.extra = extra;
  }
}
export const bad = (code, message, extra) => new ApiError(400, code, message, extra);
export const unauthorized = (code = 'SIGN_IN_REQUIRED', message = 'Sign in to continue.') => new ApiError(401, code, message);
export const forbidden = (code = 'FORBIDDEN', message = 'You do not have access to this.') => new ApiError(403, code, message);
export const notFound = (message = 'Not found.') => new ApiError(404, 'NOT_FOUND', message);
export const tooMany = (retryAfter) => new ApiError(429, 'TOO_MANY_REQUESTS', 'Too many attempts. Please wait a moment and try again.', { retryAfter });

const MAX_BODY = 1024 * 1024;

export async function readRaw(req) {
  if (req.rawBody !== undefined) return req.rawBody;
  // Vercel may already have parsed the body; keep the raw bytes when it hasn't.
  if (req.body !== undefined && req.body !== null) {
    req.rawBody = Buffer.isBuffer(req.body) ? req.body.toString('utf8') : typeof req.body === 'string' ? req.body : JSON.stringify(req.body);
    return req.rawBody;
  }
  const chunks = [];
  let size = 0;
  try {
    for await (const c of req) {
      size += c.length;
      if (size > MAX_BODY) throw new ApiError(413, 'TOO_LARGE', 'Request too large.');
      chunks.push(c);
    }
  } catch (e) {
    if (e instanceof ApiError) throw e;
    throw new ApiError(400, 'ABORTED', 'The request was interrupted.'); // browser navigated away mid-upload
  }
  req.rawBody = Buffer.concat(chunks).toString('utf8');
  return req.rawBody;
}

export async function readJson(req) {
  const raw = await readRaw(req);
  if (!raw) return {};
  try {
    const v = JSON.parse(raw);
    if (v === null || typeof v !== 'object') throw new Error();
    return v;
  } catch {
    throw bad('BAD_JSON', 'Malformed request.');
  }
}

export function send(res, status, body, headers = {}) {
  const payload = typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body);
  res.statusCode = status;
  for (const [k, v] of Object.entries(headers)) res.setHeader(k, v);
  if (!res.getHeader('content-type')) res.setHeader('content-type', 'application/json; charset=utf-8');
  if (!res.getHeader('cache-control')) res.setHeader('cache-control', 'no-store');
  res.setHeader('x-content-type-options', 'nosniff');
  res.end(payload);
}

export function parseCookies(req) {
  const out = {};
  for (const part of String(req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

export function setCookie(res, name, value, { maxAge, path = '/api', httpOnly = true } = {}) {
  const parts = [`${name}=${encodeURIComponent(value)}`, `Path=${path}`, 'SameSite=Lax'];
  if (httpOnly) parts.push('HttpOnly');
  if (env.cookieSecure) parts.push('Secure');
  if (maxAge !== undefined) parts.push(`Max-Age=${Math.max(0, Math.floor(maxAge))}`);
  const prev = res.getHeader('set-cookie');
  res.setHeader('set-cookie', [...(Array.isArray(prev) ? prev : prev ? [prev] : []), parts.join('; ')]);
}

export function clientIp(req) {
  return String(req.headers['x-forwarded-for'] || req.socket?.remoteAddress || '').split(',')[0].trim();
}

// CSRF defence for cookie-authenticated requests: state-changing calls must come from
// our own pages (Origin check) and carry a custom header that cross-site forms cannot set.
export function checkCsrf(req) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return;
  if (req.headers['x-knotily'] !== '1') throw forbidden('CSRF', 'Request blocked.');
  const origin = req.headers.origin;
  if (origin && !env.allowedOrigins.includes(origin.replace(/\/$/, ''))) throw forbidden('CSRF', 'Request blocked.');
}

export function csvEscape(v) {
  if (v === null || v === undefined) return '';
  let s = typeof v === 'object' ? JSON.stringify(v) : String(v);
  // stop spreadsheet formula injection when the owner opens the file in Excel/Sheets
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(rows) {
  if (!rows.length) return '';
  const cols = [...rows.reduce((set, r) => (Object.keys(r).forEach((k) => set.add(k)), set), new Set())];
  return [cols.join(','), ...rows.map((r) => cols.map((c) => csvEscape(r[c])).join(','))].join('\r\n') + '\r\n';
}
