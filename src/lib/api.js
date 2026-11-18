// Thin client for our own API (/api/*). Cookies carry the session (httpOnly),
// and every call sends the `x-knotily` header the server uses as a CSRF check.
import { config } from '../config.js';

export class ApiError extends Error {
  constructor(status, code, message, extra = {}) {
    super(message);
    this.status = status;
    this.code = code;
    Object.assign(this, extra);
  }
}

const DEFAULT_MSG = 'Something went wrong. Check your connection and try again.';

export async function api(path, { method = 'GET', body, keepalive = false, headers = {} } = {}) {
  let res;
  try {
    res = await fetch(config.apiBaseUrl + path, {
      method,
      credentials: 'same-origin',
      keepalive,
      headers: { 'x-knotily': '1', ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...headers },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError(0, 'NETWORK', "We couldn't reach Knot’ily. Check your connection and try again.");
  }
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }
  if (!res.ok) {
    const e = data?.error || {};
    throw new ApiError(res.status, e.code || 'HTTP_' + res.status, e.message || DEFAULT_MSG, { field: e.field, detail: e.detail });
  }
  return data;
}

export const get = (path) => api(path);
export const post = (path, body = {}) => api(path, { method: 'POST', body });
export const put = (path, body = {}) => api(path, { method: 'PUT', body });
export const del = (path) => api(path, { method: 'DELETE' });

export const paise = (n) => Math.round(n) / 100;
