# Production readiness plan

## P0 — release blockers

- [ ] Update vulnerable runtime dependencies in a dedicated branch. Start with
      Auth.js/NextAuth, Next.js, DOMPurify, Nodemailer and Undici; run authentication,
      checkout, admin and email regression tests after each major upgrade.
- [ ] Make `npm audit --omit=dev` free of critical/high runtime findings, or
      document an explicit risk acceptance for each remaining advisory.
- [ ] Run `npm run build` against the intended database and verify all Prisma
      migrations are applied.
- [ ] Configure Vercel Preview with Stripe test keys and Production with Stripe
      live keys. Never mix modes.
- [ ] Configure all webhook events listed in `STRIPE_SETUP.md`; verify signatures
      and HTTP 200 delivery in Stripe Workbench.
- [ ] Complete every Stripe scenario in `STRIPE_SETUP.md` before enabling live mode.
- [ ] Replace guest order URL access with a signed, expiring guest-order token.
      A query parameter such as `success=true` is not authentication.
- [ ] Add monitoring and alerting for webhook HTTP 4xx/5xx, failed Checkout
      creation, email failures and database errors.

## P1 — payment correctness and resilience

- [ ] Add a processed Stripe event table keyed by unique `event.id` for durable
      webhook deduplication and audit history.
- [ ] Add a scheduled reconciliation job for stale `PENDING` orders and Stripe
      payments whose webhook delivery failed.
- [ ] Persist Stripe Checkout Session ID and PaymentIntent ID in separate unique
      columns instead of overloading one field.
- [ ] Persist refund records (`refundId`, amount, currency, status, timestamps)
      rather than only aggregate refunded amount.
- [ ] Decide fulfillment behavior for partial refunds; never automatically
      restock unless the business process identifies returned quantities.
- [ ] Validate supported Stripe currencies and zero-decimal currencies. Current
      `amount * 100` conversion only fits standard two-decimal currencies.
- [ ] Avoid creating a new Stripe Coupon for each checkout. Prefer a dedicated
      discount line item or reusable promotion strategy with cleanup.
- [ ] Store money calculations in integer minor units or Decimal arithmetic;
      avoid JavaScript floating-point totals.
- [ ] Add an automated cleanup policy for abandoned addresses and cancelled orders.

## P1 — automated tests

- [ ] Unit-test totals: products, quantity, fixed discount, percent discount,
      tax, shipping threshold, rounding and zero total.
- [ ] Unit-test the order state machine and stock invariants under duplicated and
      out-of-order events.
- [ ] Integration-test the order API with Stripe and email clients mocked.
- [ ] Integration-test webhook signature rejection, malformed payloads, duplicate
      events, partial refunds and full refunds.
- [ ] Add Playwright end-to-end tests for cart, guest checkout, authenticated
      checkout, cancellation return, order page and admin status.
- [ ] Run typecheck, lint, unit tests and build in CI for every pull request.
- [ ] Run Stripe CLI tests in CI or a dedicated test environment where secrets
      are isolated.

## P1 — security and privacy

- [ ] Confirm admin authorization on every admin API and server action, not only
      in layouts or client components.
- [ ] Add security headers: CSP, HSTS, Referrer-Policy, Permissions-Policy and
      frame restrictions.
- [ ] Configure and verify the external edge rate limit described in
      `RATE_LIMITING.md`. If optional Redis limits are enabled, verify they fail
      safely during an outage and cannot be bypassed with forged proxy headers.
- [ ] Validate ownership of saved billing/shipping address IDs before attaching
      them to an order.
- [ ] Review logs to ensure customer data, Stripe payloads and secrets are not
      exposed.
- [ ] Define retention/deletion procedures for addresses, accounts and orders.
- [ ] Rotate any key that has ever been committed, pasted into logs or shared.

## P2 — operations and product quality

- [ ] Add structured logging with request, order and Stripe event IDs.
- [ ] Add uptime checks for storefront, order API and webhook endpoint.
- [ ] Configure database backups and perform a restore drill.
- [ ] Test email sender authentication (SPF, DKIM, DMARC), bounces and retries.
- [ ] Fix lint warnings and image optimization warnings.
- [ ] Verify SEO metadata, legal pages, accessibility, mobile layouts and browser support.
- [ ] Document customer setup: database, Stripe, webhook, email, storage, admin,
      DNS, Vercel variables and post-deployment smoke test.

## Template distribution requirements

- [ ] Ship only `.env.example`; never ship `.env` or vendor credentials.
- [ ] Give every customer their own Stripe account/keys, webhook endpoint and
      signing secret. Your test account should not process customer transactions.
- [ ] Provide database migrations and seed/demo data separately.
- [ ] Pin supported Node.js and package-manager versions.
- [ ] Add a customer-facing deployment checklist and troubleshooting guide.
- [ ] Define what the template license covers and what operational/payment
      configuration remains the buyer's responsibility.

## Definition of done

Release is ready when CI is green, no unaccepted critical/high runtime
vulnerabilities remain, migrations and backup restore are verified, all Stripe
test cases pass, webhook retries are idempotent, monitoring is active, and a
fresh deployment can be completed using documentation only.
