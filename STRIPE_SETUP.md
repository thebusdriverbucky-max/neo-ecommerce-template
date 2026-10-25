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

## Cancelled orders and late payments

Cancelling a pending order from the admin first expires its Stripe Checkout
Session, so the customer can no longer pay it. If a payment still reaches an
order that was cancelled (for example the customer paid at the same moment),
the application refunds it automatically and emails the store owner so it can be
checked in Stripe. If the automatic refund fails, the email says so and the
payment must be refunded manually from the Stripe Dashboard.

A customer who returns from Stripe without paying can start a new checkout
immediately: their previous unpaid checkout is released (its Session is expired
and its stock reservation returned), so they do not have to wait for it to
time out.

## Refunds from the admin

Paid orders are not cancelled; they are refunded. **Admin -> Orders -> Manage
-> Refund** refunds what is left of the payment through Stripe and marks the
order `REFUNDED` right away (or once Stripe confirms a refund that is still
pending). While the order has not shipped, **Return the items to stock** puts
the items back; the stock is returned once, even though Stripe also sends
`refund.created` and `refund.updated` for the same refund. Partial refunds are
made in the Stripe Dashboard and update the order through the webhook.

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
11. Create a partial refund in the Stripe Dashboard; order becomes
    `PARTIALLY_REFUNDED`.
12. Refund the remaining amount (Dashboard or the admin **Refund** button);
    order becomes `REFUNDED`.
13. Send a correctly signed event carrying another deployment ID; it must return
    success without changing an order in this store.
14. Verify a wrong amount, currency, Order ID, Session ID, or PaymentIntent ID
    cannot confirm an order.

15. Start checkout and close the Stripe tab without paying; the order stays
    `Pending payment`. In **Admin -> Orders -> Manage** press **Cancel order**.
    Its Checkout Session must show as expired in Stripe and the stock must be
    restored once.
16. Late payment for a cancelled order. With webhooks forwarded (`stripe listen`),
    start checkout and keep the Stripe payment page open. In another terminal
    run `npm run prisma:studio`, open the order and set its `status` to
    `CANCELLED` (this imitates a cancel that lands while the customer is paying;
    unlike the admin button it does not expire the Session or return stock).
    Then pay on the still-open Stripe page. The payment must be refunded
    automatically, the order must stay cancelled and the store owner must get an
    email. Resending the same event from Workbench does nothing, because each
    event is processed once. The "refund failed, check Stripe" alert is covered
    by the automated tests (`npm test`).
17. Start checkout, press Back on Stripe's page to return to the store, then start
    checkout again immediately; the second attempt must work and the first
    session must be expired in Stripe.
18. Pay an order, then in **Manage** press **Refund** with **Return the items to
    stock** ticked. Stripe must show the payment as refunded, the order must
    become `REFUNDED`, and the stock must go back up once (check it again after
    the `refund.created` and `refund.updated` webhooks arrive).
19. Mark a paid order `Shipped`, then press **Refund**; the stock option is not
    offered, the order becomes `REFUNDED` and the stock does not change.

The success redirect is not the source of truth. Order state is driven by
signature-verified Stripe webhooks; the success page only provides a recovery
check if webhook delivery is delayed.
