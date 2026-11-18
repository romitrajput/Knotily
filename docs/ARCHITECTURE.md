# Architecture

```
 Shopper / Owner browser
   │  HTTPS, httpOnly session cookies, x-knotily header (CSRF)
   ▼
 Vercel ──────────────┬─────────────────────────────────────────────────────────────
   static front end   │  /api/*  → api/index.js → server/router.js  (Node 20, no npm deps)
   (Vite build, dist) │     ├─ checks login (Supabase Auth JWT, verified with JWKS)
                      │     ├─ encrypts / decrypts personal data (AES-256-GCM)
                      │     ├─ calls database functions with the service key  ──►  Supabase Postgres
                      │     ├─ Razorpay orders / signature + amount verification ──►  Razorpay
                      │     └─ emails (receipts, shipped, restock, owner alerts)  ──►  Resend
                      └─ cron: /api/cron/release-reservations
 Browser → Supabase Storage directly only for owner uploads, through signed one-time URLs.
 Supabase Auth sends its own emails (confirm address, reset password) through Resend SMTP.
```

## Principles

- **The browser is never trusted.** Prices, discounts, stock, totals and payment status are decided in the database and the API. The browser only shows them.
- **One door to the data.** The database is reachable only through `security definer`-free SQL functions (`fn(p jsonb) returns jsonb`) that only the server's service key may run. Every table has Row Level Security switched on with *no* policies, and table and function privileges are revoked from `anon` and `authenticated`, so the public Supabase keys can read or write nothing.
- **Personal data is encrypted before it reaches the database** (see SECURITY.md). Postgres only ever stores ciphertext for names, emails, phones, addresses, age and gender.
- **Stock is correct under load.** Checkout locks the variant rows (`SELECT … FOR UPDATE`), reserves stock for 15 minutes, and payment confirmation turns the reservation into a sale exactly once (idempotent). Tested with 8 shoppers racing for 3 pieces.
- **No framework, no runtime npm dependencies** in the front end or the API: less to patch, nothing to audit but our own code.

## Folder map

```
api/index.js                 Vercel function: hands every /api/* request to server/router.js
server/
  router.js                  route table, CSRF check, error mapping
  env.js                     configuration from environment variables; refuses unsafe production config
  http.js                    body parsing, cookies, CSV export helpers
  session.js                 httpOnly session cookies, auto refresh, requireUser / requireOwner
  notify.js                  owner alerts, restock emails, receipts
  ratelimit.js               per-IP / per-account limits (stored hashed in Postgres)
  lib/crypto.js              AES-256-GCM field encryption, blind index, signed tokens
  lib/supabase.js            database RPC, Auth, Storage signed uploads, JWT verification
  lib/razorpay.js            orders, payment fetch, refunds, signature checks
  lib/email.js               branded email templates (Resend)
  lib/validate.js            input rules (email, password, shipping, Indian PIN/phone/states)
  lib/device.js              phone / tablet / desktop and iOS / Android / … (shared with the browser)
  routes/auth.js             sign up, verify, log in, log out, forgot / reset password
  routes/shop.js             catalogue, bag, reminders, account, analytics events
  routes/checkout.js         checkout, payment verify / cancel / webhook, cron
  routes/admin.js            owner dashboard API (products, uploads, stock, orders, alerts, settings, export)
supabase/
  migrations/                schema, security lock-down, all business logic as SQL functions, storage bucket
  seed.sql                   demo catalogue for the TESTING project only
  templates/                 branded auth emails (confirm, reset) to paste into Supabase
src/                         front end (ES modules; Vite builds it)
  main.js, router.js         routes and start-up (config, session and catalogue load in parallel)
  lib/api.js                 fetch wrapper (CSRF header, errors)
  lib/analytics.js           consent-gated journey tracking (session id, visitor id, UTM, device)
  lib/consent.js, device.js  consent state; <html data-device data-os> for device-specific UI
  store/session.js, cart.js  signed-in user; server-side bag
  services/catalog.js        /api/catalog → page shape; services/payment.js Razorpay Checkout
  components/                header, footer, bag drawer, auth pop-up, buy box (stock + reminders),
                             product track player, reviews, consent banner, search overlay, hero slider,
                             fly-to-bag, wishlist hearts
  pages/                     home, shop (filters), product, wishlist, bag, checkout, order, account,
                             email-link landings, privacy, terms, story
  admin/                     owner dashboard (overview charts, products editor with live product-image preview,
                             homepage banners,
                             inventory, orders + journeys, categories, alerts, settings, data download)
  gl/                        the garment renderer that makes the still product images (meshes, fabric shader,
                             uploaded print artwork on the tee)
  styles/                    tokens → base → components → pages → app → device → admin
tests/
  unit.test.mjs              encryption, tokens, signatures, validation, device detection
  sql/                       database logic + permission tests (real Postgres)
  emulator/                  local stand-in for Supabase Auth/REST/Storage and Razorpay
  api.test.mjs               21 end-to-end API scenarios
  e2e/                       browser journeys (Playwright): shopper and owner
```

## Request flow: Buy now

1. Shopper picks colour + size. The buy box reads live availability (`available`, `state`) from the catalogue.
2. Not signed in → the account pop-up (sign up with password + confirmation, or log in). Their intent is remembered so the email-confirmation page can carry on.
3. `PUT /api/cart/items` → `cart_set` checks stock in the database. Sold out → “Out of stock” + **Remind me**.
4. The product picture flies into the bag icon (0.7 s, skipped with reduced motion), then checkout opens with name/email (and saved address) pre-filled.
5. `POST /api/checkout` validates and encrypts the address, `order_create` locks and reserves stock, and a Razorpay order is created for the server-computed amount.
6. Razorpay Checkout runs; `POST /api/payments/verify` checks the signature **and** asks Razorpay for the payment's amount and status before `order_mark_paid` takes the stock. The webhook does the same if the browser never returns.
7. Receipt email to the shopper; low-stock / sold-out alerts to the owner; the analytics journey is linked to the account.

## Stock rules

| Situation | What happens |
|---|---|
| Add to bag | refused if `stock − reserved` is 0 (`OUT_OF_STOCK`) or less than the quantity |
| Checkout | reserves for `reservation_minutes` (default 15); expired holds are released on the next checkout and by the daily cron |
| Paid | stock and reservation both drop by the quantity; bag cleared |
| Paid after the hold expired and the last piece sold | automatic full refund, shopper told |
| Variant reaches its alert level | one `low_stock` alert (and `out_of_stock` at 0) until it is restocked |
| More than N shoppers waiting for a design (N = 10 by default) | one `reminder_threshold` alert per wave |
| Owner raises a sold-out variant above 0 | every waiting shopper is emailed, reminders closed |
| Order cancelled/refunded before shipping | pieces go back on the shelf |

## Look and feel

White, editorial storefront modelled on photo-led streetwear sites: blue announcement bar, sticky header with a Shop mega menu (categories, colours, featured), hero slider, product rows, collection tiles and full-width banners, all managed by the owner under **Dashboard → Homepage**. Brand colours: royal blue `#14219E` for buttons and links, orange `#EE6522` for the logo and sale badges; Poppins throughout.

There is no 3D or animated garment any more. Until the owner uploads photos, each product shows **still front/back images** that the browser renders once from the garment design (including uploaded print artwork) and caches; owner photos take over automatically. The only motion is small and optional: image swap on hover, the gentle colour tint on the product gallery, the fly-into-the-bag on Buy now, and the hero slider (paused with reduced motion).

New in this version: search overlay, filters, wishlist (`wishlist_items`, `/api/wishlist`), homepage banners (`banners`, `/api/admin/banners`, included in `/api/catalog`).
