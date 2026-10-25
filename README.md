# Neo Ecommerce Template (Main)

A modern, production-ready e-commerce platform built with Next.js, Prisma, Stripe, and NextAuth.

## Features

- 🛍️ **Product Catalog** with advanced search, categories, and filters
- 🛒 **Shopping Cart** with persistent client-side state
- 💳 **Stripe Payment Integration** with automated webhooks and secure checkout
- 🔐 **Authentication** (NextAuth with multiple OAuth providers and credentials)
- 👤 **User Accounts** to track order history and manage profile details
- 📊 **Admin Dashboard** with real-time analytics, order tracking, and product management
- 🎨 **Dark Mode Support** and clean Tailwind styling
- 📱 **Fully Responsive** mobile-first user experience
- 📧 **Email Notifications** via Resend for order confirmations and customer updates
- 🔒 **Security-first Architecture** with rate limiting and robust validation

## Getting Started

To set up, run, and deploy this project, please refer to our official guides:

1. **First-Step Guide (Start Here):**  
   [https://www.ownyourwebsite.app/help](https://www.ownyourwebsite.app/help) — Read this first to quickly understand how the template works and get it running.

2. **Deployment Guide:**  
   [https://www.ownyourwebsite.app/docs/deploy](https://www.ownyourwebsite.app/docs/deploy) — Step-by-step instructions on deploying your website to production.

3. **Environment Variables Config:**  
   [https://www.ownyourwebsite.app/docs/env](https://www.ownyourwebsite.app/docs/env) — Information on which environment variables are required and how to obtain them.

4. **Rate Limiting:**
   See [RATE_LIMITING.md](./RATE_LIMITING.md) for the free Vercel WAF setup and
   the optional Upstash protection layer.

### Supported toolchain

Use Node.js 22 (the exact tested release is recorded in `.nvmrc`) and npm 10.
Install the committed dependency graph with `npm ci`; do not replace or omit
`package-lock.json` when deploying the purchased source. The included Template
CI workflow installs from the lockfile, runs tests and TypeScript, rehearses the
production database build contract on PostgreSQL 16, repeats the safe bootstrap,
and rejects migration/schema drift.

## Database deployment contract

The production `build` command is the only database preparation step required
after configuring the environment variables. It generates Prisma Client,
applies committed migrations with `prisma migrate deploy`, safely creates any
missing baseline store settings and CMS pages, and then builds the application.

The bootstrap is idempotent: repeat deployments do not overwrite store settings
or CMS content edited by the owner. You can run it separately with
`npm run db:bootstrap` (or `npm run db:seed`).

The included legal, privacy, cookie, shipping, return, and refund text is
placeholder content, not business or legal advice. Review and replace it for
your products, providers, operating countries, and actual policies before
accepting orders.

`npm run db:reset-demo` is different: it deletes operational store data and is
only for a disposable local database. It is blocked unless
`ALLOW_DEMO_RESET=true` is explicitly set, and it is never run by `build`.

Use separate Preview and Production databases. Never point a Preview deployment
at the Production database, because every deployment applies migrations to the
database configured for that environment.

`DATABASE_URL` is the pooled runtime connection. `DATABASE_URL_UNPOOLED` is the
direct connection used by Prisma migrations. Both must target the same database,
branch, and schema for the current deployment environment.

## Stripe deployment contract

Card checkout requires `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, and
`STRIPE_DEPLOYMENT_ID`. The deployment ID is not a secret: choose a stable,
unique value for this store, such as `store-yourdomain-com`, and do not reuse it
for another site connected to the same Stripe account. The included Checkout is
server-side and redirects to Stripe's hosted page, so no Stripe publishable key
is required.

The signature-verified `/api/stripe/webhooks` endpoint is the payment source of
truth. The protected `/api/cron/reconcile-orders` job is only a recovery safety
net for delayed or failed webhook delivery. Configure `CRON_SECRET`; the
included Vercel schedule runs once per day and fits Hobby's technical cron
frequency limit. Vercel Hobby is for personal, non-commercial demos and
previews; use a commercially permitted Vercel plan or another suitable host for
a production store. Eligible paid plans may use a more frequent schedule. See
[STRIPE_SETUP.md](./STRIPE_SETUP.md) for the exact event list, shared-account
isolation, and acceptance checks.

## Admin account

The account whose email equals `ADMIN_EMAIL` becomes the admin when it signs
in (the comparison ignores letter case and surrounding spaces). Register, or
sign in with Google, using exactly that email **immediately after the first
deploy**, so nobody else can claim it first.

The admin role is re-checked against the database on every admin request:
if the user is deleted, or is no longer an admin (its role was changed in the
database and `ADMIN_EMAIL` was changed to a different address), the access
ends without waiting for the 30-day session to expire. If someone else gained
admin access to your store, contact support at
[https://www.ownyourwebsite.app/contact](https://www.ownyourwebsite.app/contact)
or support@ownyourwebsite.app and we will help you fix it in the Neon SQL
Editor.

## Store settings

Store name, support email and currency are managed in **Admin -> Settings**.
The old `NEXT_PUBLIC_STORE_NAME`, `STORE_SUPPORT_EMAIL` and
`NEXT_PUBLIC_CURRENCY_SYMBOL` environment variables are no longer read; you can
delete them from your deployment. Emails and prices use the store name from
Settings and the currency stored on each order. Links inside emails use
`NEXT_PUBLIC_APP_URL` (the legacy `NEXT_PUBLIC_STORE_URL` is still accepted as
an alias); when neither is set, emails are sent without the "view order" button.

### Free-shipping threshold

In Admin -> Settings the free-shipping threshold has three modes:

- **Disabled** - shipping is always charged.
- **0** - every order ships for free.
- **An amount** - orders at or above that amount (after discounts) ship for free.

### Stripe minimum charge

Stripe refuses card charges below a minimum per currency (for example 0.50 USD
or 0.30 GBP). Checkout rejects a paid total below that minimum with a clear
message instead of failing at Stripe. Free orders (total 0) are not affected.

## Managing orders

Open **Admin -> Orders** and press **Manage** on an order. One window shows the
customer, the address, the items and the totals, and lets you move the order
forward, add a tracking number, and cancel or refund it.

| Status | Meaning |
| --- | --- |
| Pending payment | Checkout started; the customer has not paid yet. Stock is reserved. |
| Confirmed | Paid. Stripe's webhook sets this automatically. |
| Processing | Optional: you are packing the order. |
| Shipped | Handed to the carrier. The customer gets an email with the tracking number. |
| Delivered | The customer has the order and gets a delivery email. |
| Cancelled | Closed without a payment; the reserved stock was returned. |
| Partially refunded | Part of the payment was returned; the rest can still be shipped. |
| Refunded | The whole payment was returned to the customer. |

Fulfilment only moves forward, and Processing or Shipped can be skipped (for
example straight to Delivered for in-store pickup).

- **Unpaid orders** (Pending payment) and **free orders** (100% discount, not
  shipped yet) are closed with **Cancel order**, which returns the stock.
- **Paid orders are never "cancelled"**: press **Refund** instead. It returns
  the remaining payment through Stripe and the order becomes Refunded. Before
  the order ships you can also tick **Return the items to stock**. For a
  partial refund use the Stripe Dashboard; the order updates automatically.

## Product images

Images uploaded with the built-in Cloudinary uploader are optimized
automatically. Any other HTTPS image URL pasted into a product also works; it is
loaded as-is, without optimization. To have another CDN optimized as well, add
its host to `lib/image-hosts.json`:

```json
{ "protocol": "https", "hostname": "images.example.com" }
```

## Contact form

Messages from the storefront contact form are emailed to the store email
configured in Admin -> Settings (or `ADMIN_EMAIL` when it is empty), with the
visitor's address set as Reply-To so you can answer directly. The form does
**not** send an automatic reply or confirmation to the visitor, and a hidden
honeypot field plus the rate limit protect it from bots.

## Upgrading

This release adds a database migration. `npm run build` applies it
automatically (`prisma migrate deploy`), so no manual database step is needed.

- Orders are now kept when a customer deletes their account: they are detached
  from the account (the customer's email is stored on the order) so refunds and
  accounting records stay intact.
- Order numbers now come from an atomic per-year counter, which prevents
  duplicate numbers under concurrent checkouts.

## License Configuration

All configuration values (including `LICENSE_KEY`, `LICENSE_PRODUCT`, or any other license-related keys) will be sent directly to your email address immediately after purchase. Simply paste them into your environment variables when configuring the project!

## Tech Stack

- **Framework:** Next.js (App Router)
- **Database:** PostgreSQL (Neon)
- **ORM:** Prisma
- **Authentication:** NextAuth v5
- **Payments:** Stripe
- **Styling:** Tailwind CSS
- **Email:** Resend
- **Rate Limiting:** Vercel WAF; optional Upstash Redis for advanced limits
