// Starts a complete offline Knot'ily for browser tests:
//   local Postgres (fresh DB) + Supabase/Razorpay emulator + API + unbundled front end.
// Usage: node tests/e2e/stack.mjs   (prints the URL; Ctrl+C to stop)
// Needs PostgreSQL running (see tests/README.md). Payments use the mock provider here.
import http from 'node:http';
import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, readFileSync, existsSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, extname, resolve } from 'node:path';
import { startEmulator } from '../emulator/supabase-emulator.mjs';

const root = resolve(new URL('../..', import.meta.url).pathname);
const PG = { host: process.env.PGHOST || '127.0.0.1', port: Number(process.env.PGPORT || 54329), user: process.env.PGUSER || 'postgres', db: process.env.PGDATABASE || 'knotily_e2e' };
const EMU_PORT = Number(process.env.EMU_PORT || 54410);
const WEB_PORT = Number(process.env.WEB_PORT || 54411);
const SERVICE = 'svc-' + randomBytes(8).toString('hex');

export async function startStack({ provider = process.env.PAYMENT_PROVIDER || 'mock', quiet = false } = {}) {
  execFileSync('bash', ['tests/sql/reset-db.sh'], { cwd: root, stdio: 'ignore', env: { ...process.env, PGHOST: PG.host, PGPORT: String(PG.port), PGUSER: PG.user, PGDATABASE: PG.db } });
  const emu = await startEmulator({ port: EMU_PORT, pg: PG, serviceKey: SERVICE, anonKey: 'anon', razorpaySecret: 'rzp_secret_e2e', razorpayKeyId: 'rzp_test_e2e', siteUrl: `http://localhost:${WEB_PORT}` });
  Object.assign(process.env, {
    APP_ENV: 'testing', SITE_URL: `http://localhost:${WEB_PORT}`, ALLOWED_ORIGINS: `http://localhost:${WEB_PORT},http://127.0.0.1:${WEB_PORT}`, COOKIE_SECURE: 'false',
    SUPABASE_URL: emu.base, SUPABASE_ANON_KEY: 'anon', SUPABASE_SERVICE_ROLE_KEY: SERVICE,
    DATA_ENCRYPTION_KEYS: JSON.stringify({ v1: randomBytes(32).toString('base64') }), DATA_ENCRYPTION_KEY_ID: 'v1',
    BLIND_INDEX_KEY: randomBytes(32).toString('base64'), SERVER_TOKEN_SECRET: randomBytes(32).toString('hex'),
    PAYMENT_PROVIDER: provider, RAZORPAY_KEY_ID: 'rzp_test_e2e', RAZORPAY_KEY_SECRET: 'rzp_secret_e2e', RAZORPAY_WEBHOOK_SECRET: 'whsec_e2e', RAZORPAY_API_BASE: emu.base,
    MAIL_OUTBOX_DIR: mkdtempSync(join(tmpdir(), 'knotily-mail-')),
  });
  const { handle } = await import('../../server/router.js');
  const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.json': 'application/json', '.mp3': 'audio/mpeg', '.mp4': 'video/mp4' };
  const server = http.createServer((req, res) => {
    if (req.url.startsWith('/api/')) return handle(req, res);
    const p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    for (const f of [join(root, p), join(root, 'public', p)]) {
      if (f.startsWith(root) && existsSync(f) && statSync(f).isFile()) {
        res.writeHead(200, { 'content-type': TYPES[extname(f)] || 'application/octet-stream', 'cache-control': 'no-store' });
        return res.end(readFileSync(f));
      }
    }
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end(readFileSync(join(root, 'index.html')));
  });
  await new Promise((r) => server.listen(WEB_PORT, '127.0.0.1', r));
  const url = `http://localhost:${WEB_PORT}`;
  if (!quiet) console.log(`Knot'ily (offline test stack) on ${url}  ·  emulator ${emu.base}  ·  mail: ${emu.base}/__mail`);
  return { url, emu, close: () => (server.close(), emu.close()) };
}

if (import.meta.url === `file://${process.argv[1]}`) startStack();
