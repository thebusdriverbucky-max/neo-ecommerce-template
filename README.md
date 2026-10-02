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

To recover a password, use **Forgot password**. Resend is optional for first-time admin creation, but password recovery and production notifications require working email delivery.

Email can be disabled at runtime without breaking checkout or administrator assignment, but **email is required for password recovery and notifications**. Without delivery, customers must retain their order page link. Do not turn email off if you need those features.

## Bank-transfer order workflow

- Checkout calculates prices, shipping, taxes and discounts on the server. The accepted total, currency and bank instructions are saved on the order. Later settings changes do not rewrite old payment instructions.
- Stock is reserved for **seven days**. The customer sees an **awaiting payment** order, not a payment receipt. They should save the order link; guest links are signed and expire after 30 days. Treat a guest link as private access to order details.
- Check the actual incoming transfer in your bank. Only then mark the order **Confirmed** in Admin → Orders. Confirmation records its time and administrator. Continue through Processing, Shipped and Delivered as fulfillment progresses.
- Use **Cancelled** for an unpaid order. Cancellation/expiration returns its reserved stock once. A refund status records an action you performed outside the app; **the template never sends money back through a bank API**. Mark a full refund only when the return/restocking decision is appropriate, because it returns stock. Partial refund status does not automatically return stock.
- Unpaid reservations expire after seven days. Expired stock is released opportunistically when the storefront is read or another checkout begins, so no scheduler or cron environment variable is required. Confirmation is rejected once the deadline has passed.
- For a transfer arriving after expiration, use the recovery action on the expired/cancelled order to re-reserve available stock, then confirm the payment. If stock or the original discount allowance is unavailable, contact the customer and resolve fulfillment/refund manually. Do not mark a missing transfer as paid to bypass expiration.
- Submission, confirmation and shipping/delivery emails are attempted from the live order workflow. Provider failures do not undo an order and are not proof of delivery. There is no durable email retry queue; use the admin order and customer order link as the source of truth.

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

## Engineering verification

Runtime/tooling are pinned by [.nvmrc](.nvmrc) and [package.json](package.json). [Template CI](.github/workflows/template-ci.yml) installs the exact lockfile, validates the manifest, runs regression tests, typechecking and lint, and builds against disposable PostgreSQL.

The standard build performs database mutations (migrations plus create-only initialization); do not use it as a harmless smoke test against a real store. Unit/SQL tests use mocks and in-memory PostgreSQL. SQL tests cover fresh migration, preservation of legacy/shared fields and repeatability, but do not prove real bank receipt, email delivery or a browser upload provider integration.

The legacy seed alias now invokes safe bootstrap. Destructive demo reset is a separate maintainer-only action, requires explicit opt-in and is blocked in production. It is never part of deployment. Buyers do not need terminal commands for normal setup.
