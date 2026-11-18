// Local API server for development: `npm run api` (Vite proxies /api to it).
// Optional: serve the unbundled front end too with --static (used by automated tests).
import http from 'node:http';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { join, extname, resolve } from 'node:path';
import { handle } from '../server/router.js';

const port = Number(process.env.API_PORT || 3001);
const root = resolve(new URL('..', import.meta.url).pathname);
const serveStatic = process.argv.includes('--static');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.json': 'application/json', '.txt': 'text/plain', '.webp': 'image/webp', '.mp3': 'audio/mpeg', '.mp4': 'video/mp4' };

function sendFile(res, file) {
  res.writeHead(200, { 'content-type': TYPES[extname(file)] || 'application/octet-stream' });
  res.end(readFileSync(file));
}

http.createServer((req, res) => {
  if (req.url.startsWith('/api/')) return handle(req, res);
  if (!serveStatic) {
    res.writeHead(404);
    return res.end();
  }
  const p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  for (const candidate of [join(root, p), join(root, 'public', p)]) {
    if (candidate.startsWith(root) && existsSync(candidate) && statSync(candidate).isFile()) return sendFile(res, candidate);
  }
  sendFile(res, join(root, 'index.html')); // SPA fallback
}).listen(port, () => console.log(`Knot'ily API on http://localhost:${port}${serveStatic ? ' (with static front end)' : ''}`));
