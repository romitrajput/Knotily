# Testing and Production

```
 feature branch ──PR──►  develop  ──────────────PR (after checklist)──────────►  main
                           │                                                     │
                 Vercel Preview (test.knotily.in)                  Vercel Production (knotily.in)
                 Supabase knotily-testing                          Supabase knotily-production
                 Razorpay TEST keys, yellow banner                 Razorpay LIVE keys
                 demo catalogue, test orders                       real customers
```

Both environments run **the same code**. Only the settings differ (Vercel environment variables), so what you test is exactly what goes live.

| | Testing | Production |
|---|---|---|
| `APP_ENV` | `testing` → yellow “Testing environment” banner, `[TESTING]` in email subjects, Razorpay test-card hint at checkout | `production` → no banner; the API refuses to start without live keys, webhook secret, email and https |
| Data | its own database, its own encryption keys | its own database, its own encryption keys |
| Payments | `rzp_test_…` — free, no money moves | `rzp_live_…` |
| Search engines | Vercel marks preview URLs `noindex` | indexed |

## Everyday flow

1. Make a change on a short branch, open a pull request into `develop`. GitHub Actions runs all tests.
2. Merge → Vercel deploys `develop` to the Testing site within a minute; new database migrations are applied to the Testing project.
3. Try it on the Testing site (checklist below).
4. Open a pull request **develop → main**. Tests run again. Merge when happy → Production deploys; migrations wait for your approval in GitHub (Environments → production) and then apply.

Protect the branches (GitHub → Settings → Branches → Add rule for `main` and `develop`): require a pull request and the `CI` check to pass.

## Before promoting to Production — checklist

Shopper (on a phone and on a laptop):
- [ ] Home page: announcement, menu (mega menu on laptop, drawer on phone), hero, product rows, tiles.
- [ ] Search finds a product; shop filters and sort work; wishlist heart saves and shows on the Wishlist page.
- [ ] Product page: colour swatches change the pictures; Buy now flies into the bag and opens checkout.
- [ ] Buy now while logged out → account pop-up → sign up (passwords must match) → confirmation email → link → “Continue” → checkout pre-filled.
- [ ] Out-of-stock size shows “Out of stock” and **Remind me** works.
- [ ] Product music plays quietly, mute works and is remembered.
- [ ] Previews (photos, video) and reviews show.
- [ ] Checkout with a Razorpay test card → order page → receipt email; stock went down.
- [ ] Close the Razorpay window without paying → “Nothing was charged”, the pieces are free again.
- [ ] Forgot password → email → new password (twice) → logged in.
- [ ] Account page: orders, reminders, edit details, analytics switch, delete request.

Owner:
- [ ] Dashboard overview shows the test visits and orders.
- [ ] Create a product with colours, sizes, stock, artwork, music, photos, video, reviews; publish; it appears in the shop with the artwork on the product images.
- [ ] Set a sold-out size back in stock → the waiting shopper gets the email.
- [ ] Low-stock and sold-out alerts arrive by email.
- [ ] Orders: packed → shipped sends the shipping email; journey shows the steps.
- [ ] Download data: password asked; CSVs open in Excel/Sheets with readable names and addresses.

## Database changes

- Never edit a migration that has already run. Add a new file `supabase/migrations/<timestamp>_<what>.sql`.
- Keep changes backwards compatible for one release (add columns before using them; remove them a release later), because the site and the database update a minute apart.
- Supabase Pro takes daily backups of Production; before a risky migration, also run Dashboard → Database → Backups → “Create backup”.

## Rolling back

- Site: Vercel → Deployments → pick the previous Production deployment → **Promote to Production** (instant).
- Database: write a new migration that undoes the change; restore a backup only as a last resort (it rewinds orders too).
