# Security and privacy

## Personal data encryption

| Data | Stored as |
|---|---|
| Email | AES-256-GCM ciphertext + an HMAC-SHA256 *blind index* (lets us find an account by email without storing it) |
| Name, phone, age, gender | AES-256-GCM ciphertext |
| Saved address, order shipping details | AES-256-GCM ciphertext (one encrypted JSON object) |
| Password | never seen by us; Supabase Auth stores a bcrypt hash |
| Card / UPI details | never seen by us; they stay with Razorpay |
| State (for the orders-by-state chart) | plain text, on purpose (not identifying on its own) |

- Format: `v1.<iv>.<tag>.<ciphertext>` — a random 96-bit IV per value, a 128-bit auth tag, and the key id in front.
- Each value is bound to its owner and purpose with *additional authenticated data* (e.g. `profile:<user id>:phone`). Copying one customer's ciphertext onto another row makes it undecryptable instead of leaking it.
- Keys live only in Vercel environment variables (`DATA_ENCRYPTION_KEYS`, `BLIND_INDEX_KEY`), separate per environment, never in the database or the code. A full database leak without the keys reveals no personal details.
- **Decryption happens only in the API**: for the shopper's own account and checkout pre-fill, for the owner's order list (shipping address), and for the owner's CSV download.

### The owner's decrypted download

1. Owner opens Dashboard → Download data and re-enters their password (checked with Supabase Auth again).
2. The API issues a signed export pass valid for 10 minutes, for that owner only.
3. Each CSV (orders, customers, events, inventory) is decrypted on the fly, protected against spreadsheet formula injection, and the download is written to `audit_log` (who, what, when).

### Key rotation

1. `npm run keys -- --rotate v2` and add the new key to `DATA_ENCRYPTION_KEYS` *next to* the old one: `{"v1":"…","v2":"…"}`.
2. Set `DATA_ENCRYPTION_KEY_ID=v2` and redeploy. New data uses v2; old data still decrypts with v1.
3. Keep v1 for as long as data encrypted with it exists. Never change `BLIND_INDEX_KEY` on a live environment (accounts would no longer be found by email).
4. **Back up the keys** in a password manager. Lost keys = lost personal data (orders and totals stay readable).

## Accounts and sessions

- Email is the user ID. Sign-up needs the password twice (8–72 chars, a letter and a number) and the terms accepted; the account works only after the emailed confirmation link.
- Sign-up and forgot-password give the same answer whether or not the email exists (no account fishing).
- Sessions are `httpOnly`, `Secure`, `SameSite=Lax` cookies; the page's JavaScript can't read them. Tokens from email links are moved into cookies and wiped from the address bar immediately.
- Access tokens are verified with Supabase's public signing keys (JWKS), audience and expiry checked.
- The owner dashboard is gated by `role = 'owner'` on the profile, checked by the API on every request.

## API protections

- **CSRF**: every state-changing request must carry the `x-knotily` header and come from an allowed origin. The Razorpay webhook is the only exception and is authenticated by its HMAC signature instead.
- **Rate limits** (stored in Postgres with hashed IPs): log in 20 per 15 min per IP and 10 per email, sign-up 8/hour, forgot 6/hour, checkout 30/hour, owner re-auth 10/15 min, exports 30/hour, events 240/min.
- **Payments**: the amount is computed in the database; Razorpay's signature is verified *and* the payment is fetched from Razorpay to confirm the amount and status before an order is marked paid.
- **Uploads**: the owner gets a one-time signed URL for a single path; file type and size are checked (images 10 MB, artwork PNG/WebP 15 MB, video 100 MB, audio 20 MB). The bucket only accepts those types.
- **Headers**: strict Content-Security-Policy (scripts only from this site and Razorpay Checkout), HSTS, `X-Frame-Options: DENY`, `nosniff`, a tight Permissions-Policy.
- **Database**: RLS on every table, no policies, privileges revoked from the public roles; tested in `tests/sql/logic.test.sql` (“PERMISSION TESTS PASSED”).
- **Fail-safe config**: in production the API refuses to start without Razorpay live keys, the webhook secret, Resend, the cron secret and https.

## Privacy (India's DPDP Act 2023)

- Analytics only after consent (banner on first visit; changeable any time in Account → Privacy or the footer). Declined = nothing recorded.
- Purpose shown at collection; age and gender are optional and labelled as such.
- Shoppers can correct details and request deletion from their account; the owner gets an alert and email. *Deletion itself is done by the owner (Supabase → Authentication → delete user removes the account and its profile, addresses, bag and reminders; orders stay for tax records, and because their encrypted shipping details are bound to the deleted account, they can no longer be decrypted — the personal data is effectively shredded while totals and items remain).* Respond within 30 days.
- Privacy policy and terms pages are drafts: fill in the business details in `src/pages/legal.js` and have a lawyer review them.

## If something goes wrong

1. Suspect a leaked key? Rotate it immediately: Supabase service key (Project Settings → API), Razorpay keys, Resend key, `SERVER_TOKEN_SECRET`, `CRON_SECRET`. Encryption keys: add a new one (rotation above) and re-check who had access.
2. Check `audit_log` for exports and product/order changes.
3. Under the DPDP Act, notify the Data Protection Board and affected people of a personal data breach.
