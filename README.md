# E-commerce Lite — bank-transfer store

Products, cart, guest/customer checkout, CMS, discounts and an administration dashboard. **Payment is by bank transfer (IBAN), not Stripe or cards.** Creating an order never proves that a payment has arrived.

## First launch — no terminal required

1. Import the purchased **Lite branch** into your hosting dashboard, choose Node 22 and follow the [deployment guide](https://www.ownyourwebsite.app/docs/deploy).
2. Paste the supplied license and hosting configuration into the dashboard. Use the exact license product supplied with your purchase, not a guessed product name. Connect PostgreSQL and Resend with a verified sending address. The owner address is set by the [ADMIN_EMAIL configuration](lib/owner-setup.ts:17); use an inbox you control. Set the store URL to your actual HTTPS domain.
3. Click **Deploy**. The standard build automatically applies migrations and creates the missing starter CMS pages/settings. It does **not** create demo products, erase orders, or overwrite existing CMS text, visibility, bank details or store settings.
4. Open **Sign In → Store owner? Set up your store**. Click **Email me a setup link**. Open the email and choose your name and a password of at least 12 characters. The one-time link lasts 30 minutes. Then sign in to your dashboard.
5. Open **Admin → Settings**. Enter store name, currency, shipping/tax rules, supported countries/categories and all four bank-transfer fields: **IBAN, bank name, account holder and payment instructions**. Include instructions to use the order number as the transfer reference. Checkout stays unavailable until these details are filled in.
6. Add your products and stock. Replace the starter CMS text with your own About, FAQ, support, shipping, returns, privacy, cookie, legal and terms information before accepting orders. Hiding a CMS page hides its public route; it is not replaced with another public policy.
7. Check your public storefront, order total and instructions. Verify a test bank transfer separately with your bank before opening the store to customers.

### Owner access and email

Only someone with access to the configured owner inbox can finish initial setup. An address typed into a registration form does **not** grant administrator rights. Setup replaces any password for a pre-registered owner address, clears old reset tokens/provider links and revokes earlier sessions. No administrator is assigned during deployment.

Initial setup closes after the first administrator is created. Existing administrators simply sign in. To recover a password, use **Forgot password**. Changing the configured owner address after setup does not promote another account. If you lose access to the owner inbox, contact your supplier rather than resetting the database.

If the setup email does not arrive, check spam, the Resend verified sender/domain, recipient restrictions and hosting configuration, then redeploy. Wait five minutes between link requests. If the site reports that email is unavailable, correct the email settings in your hosting dashboard; there is no insecure “first visitor becomes admin” fallback.

Email can be disabled at runtime without breaking checkout, but **email is required for no-terminal owner setup and password recovery**. Without delivery, customers must retain their order page link. Do not turn email off if you need those features.

## Bank-transfer order workflow

- Checkout calculates prices, shipping, taxes and discounts on the server. The accepted total, currency and bank instructions are saved on the order. Later settings changes do not rewrite old payment instructions.
- Stock is reserved for **seven days**. The customer sees an **awaiting payment** order, not a payment receipt. They should save the order link; guest links are signed and expire after 30 days. Treat a guest link as private access to order details.
- Check the actual incoming transfer in your bank. Only then mark the order **Confirmed** in Admin → Orders. Confirmation records its time and administrator. Continue through Processing, Shipped and Delivered as fulfillment progresses.
- Use **Cancelled** for an unpaid order. Cancellation/expiration returns its reserved stock once. A refund status records an action you performed outside the app; **the template never sends money back through a bank API**. Mark a full refund only when the return/restocking decision is appropriate, because it returns stock. Partial refund status does not automatically return stock.
- Unpaid reservations are released by the authenticated daily scheduler and opportunistically during checkout. The exact release can occur after the seven-day deadline on the next run; confirmation is rejected once the deadline has passed. On Vercel the schedule is included in [vercel.json](vercel.json). Enable the scheduler secret in your hosting settings; on other hosts configure the equivalent authenticated daily HTTP job.
- For a transfer arriving after expiration, use the recovery action on the expired/cancelled order to re-reserve available stock, then confirm the payment. If stock or the original discount allowance is unavailable, contact the customer and resolve fulfillment/refund manually. Do not mark a missing transfer as paid to bypass expiration.
- Submission, confirmation and shipping/delivery emails are attempted from the live order workflow. Provider failures do not undo an order and are not proof of delivery. There is no durable email retry queue; use the admin order and customer order link as the source of truth.

## Redeploys and your data

Redeploying runs the same **create-only initialization**: missing starter pages are created, existing pages and settings are left alone. Blank content saved deliberately stays blank. A hidden page stays hidden. The database is your persistent store; replacing it with an empty database is a new installation, not a redeploy.

Keep database backups. Use separate Preview and Production databases. Never use schema push/reset or demo reset against a store with customer data.

### Existing Lite / shared Full database — maintainer notes

The new migration adds missing guest-checkout, bank settings, order lifecycle, owner setup and discount fields. Historical wishlist rows are copied to the modeled table without deleting the old table. Existing Stripe columns/tables are retained and ignored by Lite. New Lite-specific columns are nullable or have backward-compatible defaults, so Full-style inserts remain possible.

**This is not permission to alternate arbitrary migration histories on one live database.** Use backups and a disposable copy first. Full and Lite share historical migrations but have branch-specific later migrations. In particular, running old Full migrations on a database already initialized by newer Lite can collide with existing columns. Do not rewrite applied migration checksums or run a generated destructive schema diff. The tested direction is upgrading legacy Lite and applying Lite additions to an already-migrated Full database. Application schemas are compatible subsets, not byte-for-byte identical schemas.

If legacy reviews contain duplicate user/product pairs, migration stops rather than deleting customer reviews. A maintainer must reconcile those records on a backup/copy and resolve the failed migration before retrying. Real shared/production databases are never reset by the test suite.

## Optional services

- Google sign-in appears only when its complete configuration is present.
- Cloudinary upload appears only when cloud and unsigned upload preset are configured. Manual image URLs remain available.
- Without Upstash, rate limits use bounded per-process memory. Use distributed protection for multi-instance production traffic. Partially configured or unavailable configured Redis fails closed.
- No Stripe keys, webhooks or card-payment setup are needed. The scheduler is for **unpaid bank-transfer reservations**, not Stripe reconciliation.

## Engineering verification

Runtime/tooling are pinned by [.nvmrc](.nvmrc) and [package.json](package.json). [Template CI](.github/workflows/template-ci.yml) installs the exact lockfile, validates the manifest, runs regression tests, typechecking and lint, and builds against disposable PostgreSQL.

The standard build performs database mutations (migrations plus create-only initialization); do not use it as a harmless smoke test against a real store. Unit/SQL tests use mocks and in-memory PostgreSQL. SQL tests cover fresh migration, preservation of legacy/shared fields and repeatability, but do not prove real bank receipt, email delivery or a browser upload provider integration.

The legacy seed alias now invokes safe bootstrap. Destructive demo reset is a separate maintainer-only action, requires explicit opt-in and is blocked in production. It is never part of deployment. Buyers do not need terminal commands for normal setup.
