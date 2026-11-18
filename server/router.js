// Request router for the whole API. Vercel runs it from api/index.js; local
// development and tests run it from scripts/local-api.mjs.
import { send, ApiError, checkCsrf } from './http.js';
import { assertConfig } from './env.js';
import { routes as authRoutes } from './routes/auth.js';
import { routes as shopRoutes } from './routes/shop.js';
import { routes as checkoutRoutes } from './routes/checkout.js';
import { routes as adminRoutes } from './routes/admin.js';

const table = [...authRoutes, ...shopRoutes, ...checkoutRoutes, ...adminRoutes].map(([method, pattern, handler, opts = {}]) => {
  const keys = [];
  const rx = new RegExp('^' + pattern.replace(/:(\w+)/g, (_, k) => (keys.push(k), '([^/]+)')) + '/?$');
  return { method, rx, keys, handler, opts };
});

let configChecked = false;

export async function handle(req, res) {
  const url = new URL(req.url, 'http://local');
  // Vercel rewrites /api/* to /api/index?__path=*; keep the original path
  const path = url.searchParams.get('__path') ? '/api/' + url.searchParams.get('__path') : url.pathname;
  url.searchParams.delete('__path');
  try {
    if (!configChecked) {
      assertConfig();
      configChecked = true;
    }
    let match = null;
    let allowed = false;
    for (const r of table) {
      const m = path.match(r.rx);
      if (!m) continue;
      allowed = true;
      if (r.method !== req.method) continue;
      match = { r, params: Object.fromEntries(r.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])])) };
      break;
    }
    if (!match) return send(res, allowed ? 405 : 404, { error: { code: allowed ? 'METHOD_NOT_ALLOWED' : 'NOT_FOUND', message: 'Not found.' } });
    if (match.r.opts.csrf !== false) checkCsrf(req);
    const out = await match.r.handler(req, res, { params: match.params, query: Object.fromEntries(url.searchParams) });
    if (out && out.__raw !== undefined) return send(res, 200, out.__raw);
    return send(res, 200, out ?? { ok: true });
  } catch (e) {
    if (e instanceof ApiError) {
      if (e.extra?.retryAfter) res.setHeader('retry-after', String(e.extra.retryAfter));
      return send(res, e.status, { error: { code: e.code, message: e.message, ...e.extra } });
    }
    console.error('[api] unhandled', req.method, path, e?.stack || e);
    return send(res, 500, { error: { code: 'SERVER_ERROR', message: 'Something went wrong on our side. Please try again.' } });
  }
}
