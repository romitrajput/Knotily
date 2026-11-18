# Tests

| Command | What it checks | Needs |
|---|---|---|
| `npm test` | encryption (tamper-proof, bound to its owner, key rotation), blind index, signed tokens, Razorpay signatures, password and shipping rules, device detection, CSV formula injection | Node 20.6+ |
| `npm run test:sql` | stock reservations, concurrency (8 shoppers racing for 3 pieces), payment idempotency, late payments, reminders and the >10 alert, restock emails, low-stock alerts, order transitions, analytics, **and that the public Supabase keys can't read or change anything** | PostgreSQL 16 |
| `npm run test:api` | 23 end-to-end API scenarios (including wishlist and homepage banners): sign-up with confirmation, verify link, encryption at rest, CSRF, sign-in gate, out of stock + reminders, checkout → Razorpay → verify (forged signatures refused), webhook, forgot/reset, rate limits, owner-only routes, >10 waiting alert, restock emails, low-stock alert, decrypted export behind the password, signed uploads, consent-gated analytics, shipping email, logout | PostgreSQL 16 |
| `npm run test:e2e` | the full shopper journey in a real browser (desktop + iPhone) and the owner dashboard (products with artwork/music/photos, inventory, orders + journey, settings, categories, decrypted download) | PostgreSQL 16, `npx playwright install chromium` |

The API and browser tests run against a **local stand-in for Supabase and Razorpay** (`tests/emulator/`) and a real local Postgres with the real migrations, so nothing on the internet is touched. They do not prove that your hosted Supabase, Razorpay and Resend accounts are set up correctly — the checklist in docs/ENVIRONMENTS.md does that on the Testing site.

## Local PostgreSQL for the tests

The tests expect Postgres on `127.0.0.1:54329`, user `postgres`, no password (override with `PGHOST`, `PGPORT`, `PGUSER`).

macOS (Homebrew):
```bash
brew install postgresql@16
initdb -D ~/knotily-pg -U postgres --auth=trust
pg_ctl -D ~/knotily-pg -o "-p 54329" -l ~/knotily-pg/log start
```
Ubuntu / WSL:
```bash
sudo apt install postgresql-16
/usr/lib/postgresql/16/bin/initdb -D ~/knotily-pg -U postgres --auth=trust
/usr/lib/postgresql/16/bin/pg_ctl -D ~/knotily-pg -o "-p 54329 -k /tmp" -l ~/knotily-pg/log start
```
Docker:
```bash
docker run -d --name knotily-pg -p 54329:5432 -e POSTGRES_HOST_AUTH_METHOD=trust postgres:16
```

## Offline demo stack

`npm run stack` starts the whole site on `http://localhost:54411` with the demo catalogue, the emulator and mock payments. Confirmation and reset emails are listed at `http://127.0.0.1:54410/__mail`. Make an account owner with:
```bash
psql -h 127.0.0.1 -p 54329 -U postgres -d knotily_e2e -c "update profiles set role='owner' where id=(select id from auth.users where email='you@example.com')"
```
