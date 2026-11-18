# Setting up Knot'ily (Testing first, then Production)

You will create **two of everything** — one for Testing, one for Production — so experiments never touch real customers. Do the Testing column first, try the site end to end, then repeat for Production.

| | Testing | Production |
|---|---|---|
| Git branch | `develop` | `main` |
| Website | e.g. `test.knotily.in` (or Vercel's `knotily-git-develop-…vercel.app`) | `knotily.in` |
| Supabase project | `knotily-testing` (free plan is fine) | `knotily-production` (**Pro**, ~US$25/month: free projects pause after a week idle and have no backups) |
| Vercel | same project, Preview environment for branch `develop` | same project, Production environment (**Pro**, ~US$20/month: the Hobby plan is non-commercial only) |
| Razorpay | Test mode keys `rzp_test_…` (free, no real money) | Live keys `rzp_live_…` (after Razorpay activates your account / KYC) |
| Resend | can share one account; use a sending domain you own | same |
| Encryption keys | `npm run keys` once | `npm run keys` again (different keys!) |

Prices: check the providers' pricing pages — these change.

---

## 1. Put the code on GitHub

The zip already contains a Git repository with two branches, `main` (Production) and `develop` (Testing). Create an **empty private** repository on GitHub (no README), then:
```bash
unzip knotily.zip && cd knotily
git remote add origin https://github.com/<you>/knotily.git
git push -u origin main develop
```
Day-to-day work happens on `develop` (Testing). See ENVIRONMENTS.md for promoting to `main`.

## 2. Supabase (do it once per environment)

1. [supabase.com](https://supabase.com) → New project → name `knotily-testing`, region **Mumbai (ap-south-1)**, a strong database password (save it).
2. **Apply the database**: on your computer, install the [Supabase CLI](https://supabase.com/docs/guides/cli), then
   ```bash
   supabase login
   supabase link --project-ref <project-ref>        # the id in the dashboard URL
   supabase db push                                  # runs supabase/migrations/*
   ```
   (After step 6 GitHub Actions does this automatically on every push.)
3. **Testing only — demo catalogue**: Dashboard → SQL Editor → paste `supabase/seed.sql` → Run. Never run it on Production.
4. **Authentication → Sign In / Providers → Email**: Email enabled, **Confirm email ON**, minimum password length 8.
5. **Authentication → URL Configuration**:
   - Site URL: `https://test.knotily.in` (Production: `https://knotily.in`)
   - Redirect URLs: `https://test.knotily.in/account/verified` and `https://test.knotily.in/account/reset` (and `http://localhost:5173/**` on Testing for local work)
6. **Authentication → Emails → SMTP Settings**: enable custom SMTP with Resend (host `smtp.resend.com`, port `465`, user `resend`, password = a Resend API key, sender `Knot'ily <hello@knotily.in>`). Supabase's built-in mailer only sends a few emails per hour.
7. **Authentication → Emails → Templates**: paste `supabase/templates/confirm-signup.html` into *Confirm signup* and `reset-password.html` into *Reset password* (subjects: “Confirm your Knot'ily account”, “Reset your Knot'ily password”).
8. **Project Settings → API / API Keys**: copy the Project URL, the anon (or *publishable*) key and the service_role (or *secret*) key. Make sure the **Data API** is enabled with the `public` schema exposed — the server talks to the database through it (the tables are locked; only the secret key can call the functions).
9. **Storage**: the `product-media` bucket is created by the migrations (public read, owner uploads only through the dashboard).

## 3. Razorpay

1. [dashboard.razorpay.com](https://dashboard.razorpay.com) → switch to **Test mode** → Account & Settings → API Keys → Generate. Save the Key ID and Secret.
2. Webhooks → Add: URL `https://test.knotily.in/api/payments/webhook`, a secret of your choice (save it), events **payment.captured** and **order.paid**.
3. Production later: switch to **Live mode**, generate live keys, and add the same webhook with `https://knotily.in/api/payments/webhook`.

Test payments: card `4111 1111 1111 1111`, any future expiry, any CVV, any OTP; or UPI `success@razorpay` / `failure@razorpay`. Nothing is charged.

## 4. Resend (email)

1. [resend.com](https://resend.com) → Domains → add `knotily.in` and add the DNS records it shows (SPF, DKIM) at your domain registrar.
2. API Keys → create one for Production and one for Testing.

## 5. Vercel

1. [vercel.com](https://vercel.com) → Add New → Project → import the GitHub repo. Framework: Vite (detected). Production branch: `main` (Settings → Git).
2. **Settings → Environment Variables** — add every variable from `.env.example`:
   - *Production* scope: the Production values (`APP_ENV=production`, `SITE_URL=https://knotily.in`, `PAYMENT_PROVIDER=razorpay`, live Razorpay keys, Production Supabase, Production encryption keys, `NODEJS_HELPERS=0`).
   - *Preview* scope, **branch `develop`**: the Testing values (`APP_ENV=testing`, `SITE_URL=https://test.knotily.in`, `PAYMENT_PROVIDER=razorpay`, `rzp_test_` keys, Testing Supabase, Testing encryption keys, `NODEJS_HELPERS=0`).
   - Generate keys with `npm run keys` (once per environment) and keep a copy in a password manager.
3. **Settings → Domains**: add `knotily.in` (Production) and `test.knotily.in` → *Git branch* `develop`.
4. **Deployment Protection**: Vercel protects preview deployments by default. Either turn it off for the Testing domain, or keep it and add Razorpay's webhook URL with a *Protection Bypass for Automation* token (`?x-vercel-protection-bypass=<token>`), otherwise test payments confirm only through the browser.
5. Cron: `vercel.json` schedules `/api/cron/release-reservations` daily (Vercel sends `CRON_SECRET` automatically; crons run on Production only). Held stock is also released on every checkout, so this is just tidy-up.

## 6. GitHub Actions (automatic tests and database updates)

Repository → Settings → Secrets and variables → Actions → add:
`SUPABASE_ACCESS_TOKEN` (supabase.com → Account → Access Tokens), `TESTING_PROJECT_REF`, `TESTING_DB_PASSWORD`, `PRODUCTION_PROJECT_REF`, `PRODUCTION_DB_PASSWORD`, and optionally `TESTING_DB_URL` (for the “load demo catalogue” button).

- `CI` runs the unit, database, API and browser tests and a build on every push and pull request.
- `Database migrations` applies new files in `supabase/migrations` to Testing (on `develop`) or Production (on `main`).
- Settings → Environments → `production` → add yourself as a required reviewer so production database changes wait for your click.

## 7. Make yourself the owner

1. Open the site, **Log in → Create an account** with your email, confirm the email.
2. Supabase → SQL Editor (once per environment):
   ```sql
   update public.profiles set role = 'owner'
   where id = (select id from auth.users where email = 'you@example.com');
   ```
3. Reload: an orange **Owner** link appears in the header → `/admin`. In **Settings**, set the address for owner alerts.

## 8. Try everything on Testing

Use the checklist in ENVIRONMENTS.md (“Before promoting to Production”). When it all passes, merge `develop` into `main`.

## Working on your own computer

```bash
npm install
cp .env.example .env        # fill in the TESTING Supabase values; PAYMENT_PROVIDER=mock is fine locally
npm run api                 # API on :3001 (emails are written to ./.outbox)
npm run dev                 # site on http://localhost:5173 (forwards /api to :3001)
```
Fully offline (no Supabase at all, used by the automated tests): install PostgreSQL 16 and run `npm run stack` — see tests/README.md.
