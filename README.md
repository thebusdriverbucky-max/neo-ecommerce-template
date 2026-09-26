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
