# Stripe setup

## Environments

Keep Stripe test mode and live mode completely separate. Every Vercel project or
deployment environment must use keys and a webhook signing secret from the same
Stripe mode.

Required variables:

```env
NEXT_PUBLIC_APP_URL=https://your-store.example
STRIPE_SECRET_KEY=sk_test_xxx
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_test_xxx
STRIPE_WEBHOOK_SECRET=whsec_xxx
```

For a real production store replace the test keys with `sk_live_...` and
`pk_live_...`, then create a separate endpoint while Stripe Dashboard is in live
mode. Never put secret keys in `NEXT_PUBLIC_*` variables.

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
through exactly the same Stripe endpoint.

## Vercel

1. Configure variables separately for Preview and Production.
2. Ensure `NEXT_PUBLIC_APP_URL` points to the deployment being tested.
3. Redeploy after changing environment variables.
4. In Stripe Workbench, verify every delivery returns HTTP 200.

## Reconciliation cron

The application exposes `/api/cron/reconcile-orders` for delayed or failed
webhook recovery. Configure a random `CRON_SECRET` in Vercel Preview and
Production; Vercel Cron sends it as `Authorization: Bearer ...`. The job runs
every ten minutes, confirms paid pending orders, releases stock only for
expired or safely abandoned sessions, and leaves active Checkout Sessions
pending. Never expose the cron secret to the browser or call this endpoint
without its authorization header.

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

The success redirect is not the source of truth. Order state is driven by
signature-verified Stripe webhooks; the success page only provides a recovery
check if webhook delivery is delayed.
