// Fixed-window rate limits stored in Postgres (works across serverless instances).
import { rpc } from './lib/supabase.js';
import { clientIp, tooMany } from './http.js';
import { hashIp, blindIndex } from './lib/crypto.js';

// key: what is being limited; extra: e.g. an email so one account can't be hammered from many IPs
export async function limit(req, key, max, windowSeconds, extra) {
  const who = extra ? 'e:' + blindIndex(extra).slice(0, 32) : 'ip:' + hashIp(clientIp(req));
  const r = await rpc('rate_limit_hit', { key: `${key}:${who}`, limit: max, window_seconds: windowSeconds });
  if (!r.allowed) throw tooMany(r.retry_after);
}
