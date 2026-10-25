# E-commerce Lite — bank-transfer store

Products, cart, guest/customer checkout, CMS, discounts and an administration dashboard. **Payment is by bank transfer (IBAN), not Stripe or cards.** Creating an order never proves that a payment has arrived.

## First launch — no terminal required

1. Import the purchased **Lite branch** into your hosting dashboard, choose Node 22 and follow the [deployment guide](https://www.ownyourwebsite.app/docs/deploy).
2. Paste the supplied license and hosting configuration into the dashboard. Use the exact license product supplied with your purchase, not a guessed product name. Set `ADMIN_EMAIL` to the address you will use for the administrator account. Set the store URL to your actual HTTPS domain.
3. Click **Deploy**. The standard build automatically applies migrations and creates the missing starter CMS pages/settings. It does **not** create demo products, erase orders, or overwrite existing CMS text, visibility, bank details or store settings.
4. Open **Register**, create an account with the exact `ADMIN_EMAIL` address, then sign in. That address receives administrator access. Other registered addresses remain customer accounts.
5. Open **Admin → Settings**. Enter store name, currency, shipping/tax rules and supported countries/categories. Add **IBAN, bank name, account holder and payment instructions** when ready. Checkout also works before an IBAN is configured: the success page shows the editable fallback text from **Payment / fallback instructions** instead of empty bank fields.
6. Add your products and stock. Replace the starter CMS text with your own About, FAQ, support, shipping, returns, privacy, cookie, legal and terms information before accepting orders. Hiding a CMS page hides its public route; it is not replaced with another public policy.
7. Check your public storefront, order total and instructions. Verify a test bank transfer separately with your bank before opening the store to customers.

### Owner access and email

The normalized account address (case-insensitive, with surrounding whitespace ignored) must match `ADMIN_EMAIL`. The match is checked when signing in and while the session is refreshed, like in the Full E-commerce and Taxi templates. Changing `ADMIN_EMAIL` changes which matching account receives administrator access after a redeploy/sign-in. Keep control of that mailbox and hosting configuration.

The administrator role is re-checked against the database whenever a session is used, so a deleted account loses access immediately instead of when its session expires. Administrator accounts cannot be deleted from the profile page. If someone else gained administrator access to your store, contact support at [https://www.ownyourwebsite.app/contact](https://www.ownyourwebsite.app/contact) or support@ownyourwebsite.app and we will help you fix it in your database's SQL editor.

To recover a password, use **Forgot password**. Resend is optional for first-time admin creation, but password recovery and production notifications require working email delivery.

Email can be disabled at runtime without breaking checkout or administrator assignment, but **email is required for password recovery and notifications**. Without delivery, customers must retain their order page link. Do not turn email off if you need those features.

## Bank-transfer order workflow

- Checkout calculates prices, shipping, taxes and discounts on the server. The accepted total, currency and bank instructions are saved on the order. Later settings changes do not rewrite old payment instructions.
- Stock is reserved for **seven days**. The customer sees an **awaiting payment** order with the amount, your bank details and the order number as the payment reference, not a payment receipt. They should save the order link; guest links are signed and expire after 30 days. Treat a guest link as private access to order details.
- To stop abandoned checkouts from blocking your stock, one customer (account or email) can hold at most **3** unpaid orders at a time and one network at most **5**. Further checkouts get a clear "pay or wait" message.

### Managing orders

Open **Admin → Orders** and press **Manage** on an order. One window shows the customer, the address, the items and totals (including the discount code), the bank details the customer received and every action available for that order.

| Status | Meaning |
| --- | --- |
| Pending payment | Order placed, transfer not confirmed yet. Stock is reserved. |
| Confirmed | You confirmed that the payment arrived. |
| Processing | Optional: you are packing the order. |
| Shipped | Handed to the carrier. The customer is emailed, with the tracking number if you entered one. |
| Delivered | The customer has the order and is emailed. |
| Cancelled | Closed without a payment; the reserved stock and a used discount code were released. |
| Refunded | You returned the payment yourself; the order is closed. |

- **Confirm payment received** only after you see the transfer in your bank. The window asks you to check the exact amount and reference first. Confirmation records its time and administrator and sends the customer a confirmation email.
- Fulfilment only moves forward, and Processing or Shipped can be skipped (for example straight to Delivered for in-store pickup). The tracking number can be added or corrected at any time without changing the status.
- **Unpaid orders** are closed with **Cancel unpaid order**, which returns the reserved stock.
- **Paid orders are never cancelled.** The template never moves money: send the payment back from your bank, then press **Mark as refunded**. Before the order ships you can tick **Return the items to stock**; after shipping the items stay out of stock.
- Low-stock alerts are emailed when a payment is confirmed, not for unpaid checkouts, so abandoned orders do not use your email quota.

### Late transfers

Unpaid reservations expire after seven days and the order is cancelled automatically. Expired stock is released when the storefront is read or another checkout begins, so no scheduler or cron variable is required.

A transfer can still arrive later. Open the order and press **Confirm late payment**: the items are reserved again if they are in stock and the original discount is kept, then the order is Confirmed. If an item has sold out meanwhile, the confirmation is refused with the product name; contact the customer and refund or offer a replacement. An order you cancelled by hand cannot be confirmed later.

### Emails

Order placed, payment confirmed, shipped, delivered, cancelled and refunded emails are sent after the change is saved (automatic expiry sends none). Provider failures are logged and never undo an order, and there is no retry queue, so the admin order and the customer's order link are the source of truth.

## Store settings

Store name, support email and currency are managed in **Admin → Settings**. The old `NEXT_PUBLIC_STORE_NAME`, `STORE_SUPPORT_EMAIL` and `NEXT_PUBLIC_CURRENCY_SYMBOL` environment variables are no longer read; you can delete them from your deployment. Links inside emails and the sitemap in `robots.txt` use `NEXT_PUBLIC_APP_URL` (the legacy `NEXT_PUBLIC_STORE_URL` / `NEXT_PUBLIC_SITE_URL` are still accepted); without it, emails are sent without the "view order" button.

- **Free-shipping threshold** has three modes: **Disabled** (shipping is always charged), **0** (every order ships free) or **an amount** (orders whose items subtotal before discounts reaches it ship free).
- **Currency**: changing it relabels existing product prices in the new currency; amounts are **not converted**. Existing orders keep the currency they were placed in.
- **Countries**: checkout and saved addresses only accept the countries enabled in Settings.
- Settings are validated on the server, and a product price can be at most 1,000,000 (the largest order total checkout supports).
- Emails are sent with `RESEND_API_KEY` from `EMAIL_FROM`. Resend's default `onboarding@resend.dev` sender only delivers to your own Resend account, so verify your domain before launch.

## Products and images

- A product that appears in any order cannot be deleted, so order history stays complete. **Archive** it instead: it disappears from the catalog, and its page stays reachable (not indexed by search engines) with an "unavailable" notice.
- Images uploaded with the built-in Cloudinary uploader are optimized automatically. Any other HTTPS image URL also works and is loaded as-is. To optimize another CDN, add its host to `lib/image-hosts.json`, e.g. `{ "protocol": "https", "hostname": "images.example.com" }`.
- `GET /api/products` without `?page` keeps the old response (a plain array of up to 50 products). With `?page=` it returns `{ products, total, page, pageSize }`; the storefront and the admin use this paginated form, so catalogs larger than 50 products are fully shown.

## Customer accounts and contact form

- Changing the password signs the account out on every device.
- Deleting an account keeps its orders and the addresses they use: they are detached from the account and the customer's email is stored on the order, so your records stay intact.
- Contact-form messages are emailed to the store email from Settings (or `ADMIN_EMAIL` when it is empty) with the visitor's address as Reply-To. The form **never sends an automatic reply to the visitor**, and a hidden honeypot field plus the rate limit protect it from bots.

## Upgrading an existing Lite store

This release adds the migration `20261025130000_lite_order_integrity`. The normal build applies it automatically (`prisma migrate deploy`); no manual database step is needed. It is additive and repeatable: orders and addresses are detached instead of deleted with an account, a nullable `checkoutIpHash` column backs the reservation limit, and the free-shipping threshold may be empty (= disabled). Existing values are unchanged.

## Redeploys and your data

Redeploying runs the same **create-only initialization**: missing starter pages are created, existing pages and settings are left alone. Blank content saved deliberately stays blank. A hidden page stays hidden. The database is your persistent store; replacing it with an empty database is a new installation, not a redeploy.

Keep database backups. Use separate Preview and Production databases. Never use schema push/reset or demo reset against a store with customer data.

### Existing Lite / shared Full database — maintainer notes

The new migration adds missing guest-checkout, bank settings, order lifecycle and discount fields, plus legacy owner-setup fields retained for schema compatibility. Historical wishlist rows are copied to the modeled table without deleting the old table. Existing Stripe columns/tables are retained and ignored by Lite. New Lite-specific columns are nullable or have backward-compatible defaults, so Full-style inserts remain possible.

**This is not permission to alternate arbitrary migration histories on one live database.** Use backups and a disposable copy first. Full and Lite share historical migrations but have branch-specific later migrations. In particular, running old Full migrations on a database already initialized by newer Lite can collide with existing columns. Do not rewrite applied migration checksums or run a generated destructive schema diff. The tested direction is upgrading legacy Lite and applying Lite additions to an already-migrated Full database. Application schemas are compatible subsets, not byte-for-byte identical schemas.

If legacy reviews contain duplicate user/product pairs, migration stops rather than deleting customer reviews. A maintainer must reconcile those records on a backup/copy and resolve the failed migration before retrying. Real shared/production databases are never reset by the test suite.

## Optional services

- Google sign-in appears only when its complete configuration is present.
- Cloudinary upload appears only when cloud and unsigned upload preset are configured. Manual image URLs remain available.
- Without Upstash, rate limits use bounded per-process memory. Use distributed protection for multi-instance production traffic. Partially configured or unavailable configured Redis fails closed.
- No Stripe keys, webhooks, card-payment setup or cron secret are needed.
- `GUEST_ORDER_TOKEN_SECRET` (at least 32 random characters) is required for guest checkout and guest order links; without it only signed-in customers can check out.

## Engineering verification

Runtime/tooling are pinned by [.nvmrc](.nvmrc) and [package.json](package.json). [Template CI](.github/workflows/template-ci.yml) installs the exact lockfile, validates the manifest, runs regression tests, typechecking and lint, and builds against disposable PostgreSQL.

The standard build performs database mutations (migrations plus create-only initialization); do not use it as a harmless smoke test against a real store. Unit/SQL tests use mocks and in-memory PostgreSQL. SQL tests cover fresh migration, preservation of legacy/shared fields and repeatability, but do not prove real bank receipt, email delivery or a browser upload provider integration.

The legacy seed alias now invokes safe bootstrap. Destructive demo reset is a separate maintainer-only action, requires explicit opt-in and is blocked in production. It is never part of deployment. Buyers do not need terminal commands for normal setup.
