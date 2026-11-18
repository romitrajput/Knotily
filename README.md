# Knot'ily

The Knot'ily shop: a clean, photo-led storefront for oversized tees and streetwear, with accounts, live stock, restock reminders, Razorpay checkout, encrypted customer data, consent-based journey analytics and an owner dashboard. Two environments — **Testing** and **Production** — run the same code with different settings.

**Stack:** Vite + vanilla JS (custom WebGL garment engine) · zero-dependency Node 20 API on Vercel · Supabase (Postgres, Auth, Storage) · Razorpay · Resend.

## What's inside

**Shoppers**
- White, editorial layout: announcement bar, mega menu, hero slider, latest-drop and category rows, collection tiles, full-width banners.
- Search (instant results), shop filters (category, colour, size, in stock, on sale) and sorting, wishlist saved to the account.
- Product pages with a photo gallery (still product images until the owner uploads photos), colour swatches with a subtle tint, and a small fly-into-the-bag moment on Buy now.
- Create an account (email = user ID, password typed twice, email confirmation), log in, forgot/reset password.
- Buy now / bag check login first — new visitors get a “create an account” pop-up and pick up where they left off after confirming their email.
- Live stock per colour and size: “Only 2 left”, **Out of stock + Remind me** (emailed when restocked).
- Product music at 20% volume with a mute button (remembered), photo/video previews, reviews, discounts.
- Checkout pre-fills name and email (and the saved address next time); address, PIN, landmark, optional age and gender; Razorpay (UPI, cards, net banking, wallets).
- Account page: orders, reminders, details, analytics choice, delete request.
- Adapts to phone / tablet / desktop and iOS / Android (bigger tap targets, no-zoom form fields on iOS and Android, notch-safe spacing, bottom-sheet pop-ups on phones).
- Consent banner, privacy policy and terms (drafts to complete — see docs/SECURITY.md).

**Owner** (`/admin`)
- Overview analytics: revenue, funnel, visitors, devices/OS, sources, states, sizes, colours, products, every recorded action.
- Products: details, category, price + discount, colours, sizes × stock, print artwork (with live front/back product-image preview), music, photos/videos, reviews, draft/live.
- Inventory, orders (decrypted address + each customer's journey from landing to purchase), categories, alerts, settings.
- Email alerts: running low, sold out, **more than 10 shoppers waiting for a design**, new orders.
- Download decrypted CSVs (orders, customers, activity, inventory) after re-entering the password; every download is logged.

**Security:** personal data encrypted with AES-256-GCM before it reaches the database; database locked so public keys can do nothing; httpOnly sessions; CSRF checks; rate limits; Razorpay signature *and* amount verification; strict CSP. Details in docs/SECURITY.md.

## Start here

1. **docs/SETUP.md** — create the Testing and Production accounts (Supabase, Vercel, Razorpay, Resend), environment variables, owner account.
2. **docs/ENVIRONMENTS.md** — develop → main flow and the pre-launch checklist.
3. **docs/OWNER_GUIDE.md** — using the dashboard.
4. docs/ARCHITECTURE.md, docs/SECURITY.md, docs/PAYMENTS.md, docs/SUGGESTIONS.md (ideas waiting for your OK).

```bash
npm install
cp .env.example .env      # Testing Supabase values
npm run api & npm run dev # http://localhost:5173
npm run test:all          # needs local PostgreSQL, see tests/README.md
```
