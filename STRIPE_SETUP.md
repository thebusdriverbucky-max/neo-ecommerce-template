# Stripe setup

## Environments

Keep Stripe test mode and live mode completely separate. Every Vercel project or
deployment environment must use keys and a webhook signing secret from the same
Stripe mode.

Required variables:

```env
NEXT_PUBLIC_APP_URL=https://your-store.example
STRIPE_SECRET_KEY=sk_test_xxx
STRIPE_WEBHOOK_SECRET=whsec_xxx
STRIPE_DEPLOYMENT_ID=store-your-store-example
CRON_SECRET=generate-a-long-random-value
```

For a real production store replace the test secret key with `sk_live_...`, then
create a separate endpoint while Stripe Dashboard is in live mode. The included
Checkout is created on the server and redirects to Stripe's hosted page, so it
does not use a browser publishable key. Never put the Stripe secret key or
webhook signing secret in a `NEXT_PUBLIC_*` variable.

`STRIPE_DEPLOYMENT_ID` is a stable, non-secret identifier for this site. Use a
different value for every store that shares a Stripe account. The application
writes it to new Checkout Session and PaymentIntent metadata and accepts only
objects carrying this store's value. Correctly signed events belonging to other
deployments are acknowledged without changing local orders.

## Webhook endpoint

Endpoint:

```text
https://your-store.example/api/stripe/webhooks
```

Subscribe only to events handled by the application:

- `checkout.session.completed`
- `checkout.session.expired`
- `payment_intent.succeeded`
- `payment_intent.payment_failed`
- `refund.created`
- `refund.updated`

`charge.refunded` is intentionally not used. Stripe recommends `refund.created`
for refund details. `refund.updated` captures later status transitions. The code
distinguishes partial and complete refunds.

Each deployed project can have its own endpoint. Multiple endpoints can belong
to one Stripe account, but each endpoint has a different `whsec_...`. Do not copy
one project's webhook secret into another unless both deployments receive events
through exactly the same Stripe endpoint. Keep a unique `STRIPE_DEPLOYMENT_ID`
even when deployments intentionally share an endpoint.

## Vercel

1. Configure variables separately for Preview and Production.
2. Ensure `NEXT_PUBLIC_APP_URL` points to the deployment being tested.
3. Give Preview and Production distinct `STRIPE_DEPLOYMENT_ID` values when they
   share a Stripe account.
4. Redeploy after changing environment variables.
5. In Stripe Workbench, verify every delivery returns HTTP 200.

## Reconciliation cron

The application exposes `/api/cron/reconcile-orders` for delayed or failed
webhook recovery. Configure a random `CRON_SECRET` in Vercel Preview and
Production; Vercel Cron sends it as `Authorization: Bearer ...`. The committed
schedule runs once per day and fits Hobby's technical cron frequency limit, but
Hobby is only suitable for personal, non-commercial demos and previews. Use a
commercially permitted Vercel plan or another suitable host for a production
store. Vercel does not guarantee the exact execution time on Hobby; eligible
paid plans may use a more frequent schedule. The job confirms paid pending
orders, releases stock only for expired or safely abandoned sessions, and
leaves active Checkout Sessions pending. Never expose the cron secret to the
browser or call this endpoint without its authorization header.

The webhook remains the source of truth; cron is a delayed recovery safety net,
not the normal payment confirmation path.

## Upgrading an existing store

Checkout Sessions and PaymentIntents created by an older release may not contain
`STRIPE_DEPLOYMENT_ID` metadata. This release deliberately does not reconcile or
mutate those unmarked Stripe objects because it cannot safely distinguish them
from another site in a shared Stripe account. Before deploying the upgrade to an
active store, resolve existing pending orders under the old release or review
them manually in Stripe and the admin dashboard. New checkouts created after the
upgrade carry the marker automatically.

## Required test scenarios

Use Stripe test mode and verify both Stripe Workbench and the admin order:

1. Successful payment with card `4242 4242 4242 4242`.
2. Declined payment with card `4000 0000 0000 0002`.
3. 3DS authentication with card `4000 0025 0000 3155`.
4. Cancel Checkout and return to the cart; cart contents must remain.
5. Let a Checkout Session expire; order becomes cancelled and stock is restored once.
6. Resend `checkout.session.completed`; status and stock must not change twice.
7. Resend `payment_intent.succeeded`; confirmation emails must not duplicate.
8. Apply fixed and percentage discounts; Stripe amount must match the order total.
9. Test taxable and non-taxable configurations.
10. Test paid and free shipping.
11. Create a partial refund; order becomes `PARTIALLY_REFUNDED`.
12. Refund the remaining amount; order becomes `REFUNDED`.
13. Send a correctly signed event carrying another deployment ID; it must return
    success without changing an order in this store.
14. Verify a wrong amount, currency, Order ID, Session ID, or PaymentIntent ID
    cannot confirm an order.

The success redirect is not the source of truth. Order state is driven by
signature-verified Stripe webhooks; the success page only provides a recovery
check if webhook delivery is delayed.
