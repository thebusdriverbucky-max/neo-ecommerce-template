# Rate limiting

Production deployments must have rate limiting, but Upstash Redis is optional.
The default setup uses one Vercel WAF rate-limit rule, which fits the Vercel
Hobby allowance. Upstash can be enabled as a second, more precise protection
layer.

## Required baseline: Vercel WAF

Vercel includes one rate-limit rule per Hobby project. Configure it from the
project dashboard:

1. Open **Firewall** and select **Configure**.
2. Create one custom rule named `API burst protection`.
3. Match requests where the request path starts with `/api/`.
4. Exclude these paths from the rule:
   - `/api/stripe/webhooks` — Stripe signatures and the durable event ledger
     protect this endpoint; Stripe retries must remain deliverable.
   - `/api/cron/reconcile-orders` — this endpoint requires `CRON_SECRET`.
5. Select the **Rate Limit** action.
6. Use a fixed window of 60 seconds, a limit of 120 requests and the IP counting
   key. Start with **Log** while testing, then change the action to the default
   HTTP 429 response.
7. Publish the firewall configuration and verify it in Firewall traffic logs.

This single coarse rule protects API functions from request bursts before they
consume application compute. Adjust the threshold from observed legitimate
traffic; do not lower it blindly on a storefront that performs many API calls.

Vercel tracks WAF counters per region. Hobby supports one rate-limit rule, a
fixed-window algorithm and IP/JA4 counting keys. Check current Vercel plan limits
and pricing before launch because platform allowances can change.

If the store is deployed somewhere other than Vercel, configure an equivalent
rate limit in the hosting provider, reverse proxy or CDN.

## Optional advanced layer: Upstash Redis

Set both variables to enable application-level limits:

```env
UPSTASH_REDIS_REST_URL=https://...
UPSTASH_REDIS_REST_TOKEN=...
```

Upstash adds separate policies for orders, authentication, password recovery,
contact requests, coupons, reviews, wishlist and admin APIs. It can count by an
authenticated user ID or guest email instead of relying only on an IP address,
uses longer windows and shares counters globally.

Both values must come from the same active Upstash database. If only one value
is supplied, the production application treats the setup as broken and returns
HTTP 503 from protected routes. If both values are absent, the application uses
external/WAF mode and does not attempt to contact Redis.

When a configured Upstash service becomes unavailable, Preview and Production
fail closed with HTTP 503 so an attacker cannot disable the application-level
protection by causing a Redis outage. Local development remains usable.

## Recommended production stack

- Small/Hobby store: the required Vercel WAF rule only.
- Store needing per-user limits or longer windows: Vercel WAF plus Upstash.
- Never expose Redis tokens in `NEXT_PUBLIC_*` variables or browser code.
- Do not rate-limit Stripe webhooks so tightly that legitimate retries fail.
- Test HTTP 429 behavior before launch and monitor both firewall and application
  logs after enabling a rule.
