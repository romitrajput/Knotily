# Payments (Razorpay)

## Flow

1. **Checkout** (`POST /api/checkout`): the address is validated and encrypted, stock is reserved, and the total is calculated in the database from live prices and discounts. The API creates a Razorpay order for exactly that amount (in paise).
2. **Razorpay Checkout** opens in the browser (UPI, cards, net banking, wallets) with name, email and phone pre-filled.
3. **Verify** (`POST /api/payments/verify`): the API checks Razorpay's HMAC signature with the key secret, then fetches the payment from Razorpay and confirms the order id, the amount and that it is captured/authorized. Only then is the order marked paid and the stock taken.
4. **Webhook backup** (`POST /api/payments/webhook`, events `payment.captured` and `order.paid`): if the shopper closes the tab after paying, the webhook (signed with your webhook secret) marks the order paid. Marking paid is idempotent, so the browser and the webhook can both arrive safely.
5. **Closed or failed** (`POST /api/payments/cancel`): reserved stock is released immediately.
6. **Paid too late**: if the 15-minute hold expired and the last piece sold meanwhile, the payment is refunded in full automatically and the shopper is told.

Payments are captured automatically: in the Razorpay dashboard set Account & Settings → Payment capture → **Automatic**.

## Testing for free

Testing uses Razorpay **Test mode** keys (`rzp_test_…`). No money moves and nothing needs KYC.

| Method | Use |
|---|---|
| Card (success) | `4111 1111 1111 1111`, any future expiry, any CVV, any OTP |
| UPI | `success@razorpay` (pays) / `failure@razorpay` (fails) |
| Net banking | pick any bank → “Success” or “Failure” on Razorpay's test page |

On your own computer you can also run with `PAYMENT_PROVIDER=mock`: a “test payment” sheet replaces Razorpay. The API refuses the mock in production.

## Going live

1. Complete Razorpay activation (business details, KYC, bank account, website review — Razorpay checks that the site has a privacy policy, terms, refund/shipping info and contact details; these pages are in the site).
2. Live mode → generate keys → put them in Vercel's **Production** variables (`RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`).
3. Live mode → Webhooks → `https://knotily.in/api/payments/webhook`, events `payment.captured`, `order.paid`, new secret → `RAZORPAY_WEBHOOK_SECRET`.
4. Place one real low-value order and refund it from the Razorpay dashboard.

## Refunds

Cancelling or refunding an order in the dashboard updates the order and stock. Send the money back from Razorpay → Transactions → Payments → Refund (automatic refunds are only issued for the “paid after the last piece sold” case).
