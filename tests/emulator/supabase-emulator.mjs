// Local stand-in for Supabase (Auth, PostgREST RPC, Storage) and Razorpay, used by the
// automated tests and for trying the site offline. Backed by a real local Postgres
// running the same migrations as production. NOT for production use.
import http from 'node:http';
import { execFile } from 'node:child_process';
import { generateKeyPairSync, sign as cryptoSign, randomUUID, randomBytes, scryptSync, timingSafeEqual, createHmac } from 'node:crypto';

export function startEmulator({ port, pg, serviceKey, anonKey, razorpaySecret, razorpayKeyId }) {
  const base = `http://127.0.0.1:${port}`;
  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const kid = 'emu-key-1';
  const jwk = { ...publicKey.export({ format: 'jwk' }), kid, alg: 'ES256', use: 'sig' };
  const mail = [];
  const refreshTokens = new Map(); // token -> userId
  const verifyTokens = new Map(); // token -> { userId, type }
  const uploads = new Map(); // path -> { type, body }
  const uploadTokens = new Map();
  const rzpOrders = new Map();
  const rzpPayments = new Map();
  const users = new Map(); // id -> { id, email, hash, confirmed }

  const sql = (query) =>
    new Promise((resolve, reject) => {
      execFile('psql', ['-h', pg.host, '-p', String(pg.port), '-U', pg.user, '-d', pg.db, '-X', '-q', '-t', '-A', '-v', 'ON_ERROR_STOP=1', '-c', query], { maxBuffer: 64 * 1024 * 1024 }, (err, stdout, stderr) => {
        if (err) reject(Object.assign(new Error(stderr), { stderr }));
        else resolve(stdout.trim());
      });
    });
  const lit = (s) => {
    const tag = '$q' + randomBytes(6).toString('hex') + '$';
    return tag + s + tag;
  };

  const b64u = (o) => Buffer.from(typeof o === 'string' ? o : JSON.stringify(o)).toString('base64url');
  function jwt(user, ttl = 3600) {
    const now = Math.floor(Date.now() / 1000);
    const head = b64u({ alg: 'ES256', typ: 'JWT', kid });
    const body = b64u({ sub: user.id, email: user.email, role: 'authenticated', aud: 'authenticated', iss: `${base}/auth/v1`, iat: now, exp: now + ttl, amr: [{ method: 'password', timestamp: now }] });
    const sig = cryptoSign('sha256', Buffer.from(`${head}.${body}`), { key: privateKey, dsaEncoding: 'ieee-p1363' }).toString('base64url');
    return `${head}.${body}.${sig}`;
  }
  function session(user) {
    const rt = randomBytes(24).toString('hex');
    refreshTokens.set(rt, user.id);
    return { access_token: jwt(user), token_type: 'bearer', expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, refresh_token: rt, user: publicUser(user) };
  }
  const publicUser = (u) => ({ id: u.id, email: u.email, email_confirmed_at: u.confirmed ? new Date().toISOString() : null, aud: 'authenticated', role: 'authenticated' });
  function userFromBearer(req) {
    const t = String(req.headers.authorization || '').replace(/^Bearer /, '');
    const parts = t.split('.');
    if (parts.length !== 3) return null;
    try {
      const p = JSON.parse(Buffer.from(parts[1], 'base64url').toString());
      if (p.exp * 1000 < Date.now()) return null;
      return users.get(p.sub) || null;
    } catch {
      return null;
    }
  }
  const hash = (pw) => {
    const salt = randomBytes(16);
    return { salt, h: scryptSync(pw, salt, 32) };
  };
  const checkPw = (u, pw) => timingSafeEqual(scryptSync(pw, u.hash.salt, 32), u.hash.h);

  const json = (res, status, body, headers = {}) => {
    res.writeHead(status, { 'content-type': 'application/json', 'access-control-allow-origin': '*', ...headers });
    res.end(JSON.stringify(body));
  };
  const readBody = (req) =>
    new Promise((resolve) => {
      const chunks = [];
      req.on('data', (c) => chunks.push(c));
      req.on('end', () => resolve(Buffer.concat(chunks)));
    });

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, base);
    const p = url.pathname;
    try {
      // ---------------------------------------------------------------- test helpers
      if (p === '/__mail') return json(res, 200, mail.filter((m) => !url.searchParams.get('to') || m.to === url.searchParams.get('to')));
      if (p === '/__razorpay/pay' && req.method === 'POST') {
        const b = JSON.parse((await readBody(req)).toString() || '{}');
        const o = rzpOrders.get(b.order_id);
        const pay = { id: 'pay_' + randomBytes(7).toString('hex'), order_id: o.id, amount: b.amount ?? o.amount, status: b.status || 'captured', currency: 'INR' };
        rzpPayments.set(pay.id, pay);
        const signature = createHmac('sha256', razorpaySecret).update(`${o.id}|${pay.id}`).digest('hex');
        return json(res, 200, { razorpay_order_id: o.id, razorpay_payment_id: pay.id, razorpay_signature: signature });
      }

      // ---------------------------------------------------------------- auth
      if (p === '/auth/v1/.well-known/jwks.json') return json(res, 200, { keys: [jwk] });
      if (p === '/auth/v1/signup' && req.method === 'POST') {
        const b = JSON.parse((await readBody(req)).toString());
        const email = String(b.email).toLowerCase();
        const existing = [...users.values()].find((u) => u.email === email);
        if (existing) return json(res, 200, { id: randomUUID(), email, aud: 'authenticated', role: '', confirmation_sent_at: new Date().toISOString() }); // decoy, like Supabase
        if (String(b.password).length < 6) return json(res, 422, { code: 422, error_code: 'weak_password', msg: 'Password should be at least 6 characters.' });
        const u = { id: randomUUID(), email, hash: hash(b.password), confirmed: false };
        users.set(u.id, u);
        await sql(`insert into auth.users (id, email) values ('${u.id}', ${lit(email)})`);
        const token = randomBytes(16).toString('hex');
        verifyTokens.set(token, { userId: u.id, type: 'signup' });
        mail.push({ to: email, type: 'signup', link: `${base}/auth/v1/verify?token=${token}&type=signup&redirect_to=${encodeURIComponent(url.searchParams.get('redirect_to') || '')}` });
        return json(res, 200, { ...publicUser(u), confirmation_sent_at: new Date().toISOString() });
      }
      if (p === '/auth/v1/verify' && req.method === 'GET') {
        const t = verifyTokens.get(url.searchParams.get('token'));
        if (!t) return json(res, 403, { error: 'otp_expired' });
        verifyTokens.delete(url.searchParams.get('token'));
        const u = users.get(t.userId);
        u.confirmed = true;
        await sql(`update auth.users set email_confirmed_at = now() where id = '${u.id}'`);
        const s = session(u);
        const to = `${url.searchParams.get('redirect_to')}#access_token=${s.access_token}&expires_in=3600&refresh_token=${s.refresh_token}&token_type=bearer&type=${t.type}`;
        res.writeHead(303, { location: to });
        return res.end();
      }
      if (p === '/auth/v1/token' && req.method === 'POST') {
        const b = JSON.parse((await readBody(req)).toString());
        if (url.searchParams.get('grant_type') === 'refresh_token') {
          const uid = refreshTokens.get(b.refresh_token);
          if (!uid) return json(res, 400, { error: 'invalid_grant', error_description: 'Invalid Refresh Token' });
          refreshTokens.delete(b.refresh_token);
          return json(res, 200, session(users.get(uid)));
        }
        const u = [...users.values()].find((x) => x.email === String(b.email).toLowerCase());
        if (!u || !checkPw(u, String(b.password))) return json(res, 400, { error: 'invalid_grant', error_code: 'invalid_credentials', error_description: 'Invalid login credentials' });
        if (!u.confirmed) return json(res, 400, { error: 'invalid_grant', error_code: 'email_not_confirmed', error_description: 'Email not confirmed' });
        return json(res, 200, session(u));
      }
      if (p === '/auth/v1/user' && req.method === 'GET') {
        const u = userFromBearer(req);
        return u ? json(res, 200, publicUser(u)) : json(res, 401, { msg: 'invalid JWT' });
      }
      if (p === '/auth/v1/user' && req.method === 'PUT') {
        const u = userFromBearer(req);
        if (!u) return json(res, 401, { msg: 'invalid JWT' });
        const b = JSON.parse((await readBody(req)).toString());
        if (b.password) {
          if (checkPw(u, b.password)) return json(res, 422, { msg: 'New password should be different from the old password.' });
          u.hash = hash(b.password);
        }
        return json(res, 200, publicUser(u));
      }
      if (p === '/auth/v1/recover' && req.method === 'POST') {
        const b = JSON.parse((await readBody(req)).toString());
        const u = [...users.values()].find((x) => x.email === String(b.email).toLowerCase());
        if (u) {
          const token = randomBytes(16).toString('hex');
          verifyTokens.set(token, { userId: u.id, type: 'recovery' });
          mail.push({ to: u.email, type: 'recovery', link: `${base}/auth/v1/verify?token=${token}&type=recovery&redirect_to=${encodeURIComponent(url.searchParams.get('redirect_to') || '')}` });
        }
        return json(res, 200, {});
      }
      if (p === '/auth/v1/resend' && req.method === 'POST') return json(res, 200, {});
      if (p === '/auth/v1/logout' && req.method === 'POST') return json(res, 204, {});

      // ---------------------------------------------------------------- PostgREST RPC
      const rpcMatch = p.match(/^\/rest\/v1\/rpc\/([a-z_]+)$/);
      if (rpcMatch && req.method === 'POST') {
        if (req.headers.authorization !== `Bearer ${serviceKey}`) {
          return json(res, 401, { code: '42501', message: 'permission denied' }); // anon key cannot run functions
        }
        const body = JSON.parse((await readBody(req)).toString() || '{}');
        try {
          const out = await sql(`set role service_role; select public.${rpcMatch[1]}(${lit(JSON.stringify(body.p ?? {}))}::jsonb);`);
          return json(res, 200, out ? JSON.parse(out) : null);
        } catch (e) {
          const m = String(e.stderr || '').match(/ERROR:\s+(.*)/);
          const d = String(e.stderr || '').match(/DETAIL:\s+(.*)/);
          const msg = m ? m[1].trim() : 'error';
          const isBiz = /^[A-Z_]+$/.test(msg);
          return json(res, 400, { code: isBiz ? 'P0001' : 'XX000', message: msg, details: d ? d[1].trim() : null });
        }
      }

      // ---------------------------------------------------------------- storage
      const signMatch = p.match(/^\/storage\/v1\/object\/upload\/sign\/([^/]+)\/(.+)$/);
      if (signMatch && req.method === 'POST') {
        if (req.headers.authorization !== `Bearer ${serviceKey}`) return json(res, 403, { error: 'Unauthorized' });
        const token = randomBytes(12).toString('hex');
        uploadTokens.set(token, signMatch[2]);
        return json(res, 200, { url: `/object/upload/sign/${signMatch[1]}/${signMatch[2]}?token=${token}` });
      }
      if (signMatch && req.method === 'PUT') {
        const path = uploadTokens.get(url.searchParams.get('token'));
        if (path !== signMatch[2]) return json(res, 403, { error: 'Invalid token' }, { 'access-control-allow-origin': '*' });
        uploadTokens.delete(url.searchParams.get('token'));
        uploads.set(path, { type: req.headers['content-type'], body: await readBody(req) });
        return json(res, 200, { Key: path });
      }
      if (req.method === 'OPTIONS') {
        res.writeHead(204, { 'access-control-allow-origin': '*', 'access-control-allow-methods': 'PUT,POST,GET', 'access-control-allow-headers': '*' });
        return res.end();
      }
      const pubMatch = p.match(/^\/storage\/v1\/object\/public\/([^/]+)\/(.+)$/);
      if (pubMatch && req.method === 'GET') {
        const f = uploads.get(pubMatch[2]);
        if (!f) return json(res, 404, { error: 'not found' });
        res.writeHead(200, { 'content-type': f.type, 'access-control-allow-origin': '*' });
        return res.end(f.body);
      }

      // ---------------------------------------------------------------- Razorpay
      if (p.startsWith('/v1/')) {
        const expected = 'Basic ' + Buffer.from(`${razorpayKeyId}:${razorpaySecret}`).toString('base64');
        if (req.headers.authorization !== expected) return json(res, 401, { error: { code: 'BAD_REQUEST_ERROR', description: 'Authentication failed' } });
        if (p === '/v1/orders' && req.method === 'POST') {
          const b = JSON.parse((await readBody(req)).toString());
          const o = { id: 'order_' + randomBytes(7).toString('hex'), amount: b.amount, currency: b.currency, receipt: b.receipt, status: 'created', notes: b.notes };
          rzpOrders.set(o.id, o);
          return json(res, 200, o);
        }
        const payMatch = p.match(/^\/v1\/payments\/([^/]+)$/);
        if (payMatch) return rzpPayments.has(payMatch[1]) ? json(res, 200, rzpPayments.get(payMatch[1])) : json(res, 404, { error: {} });
        if (/\/refund$/.test(p)) return json(res, 200, { id: 'rfnd_' + randomBytes(5).toString('hex'), status: 'processed' });
      }
      json(res, 404, { error: 'emulator: unknown route ' + req.method + ' ' + p });
    } catch (e) {
      json(res, 500, { error: String(e.message) });
    }
  });

  return new Promise((resolve) =>
    server.listen(port, '127.0.0.1', () =>
      resolve({
        base, close: () => server.close(), mail, users, uploads,
        makeOwner: (email) => sql(`update public.profiles set role = 'owner' where id = (select id from auth.users where email = ${lit(email)})`),
        sql,
      })
    )
  );
}
