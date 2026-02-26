# Stripe Setup Instructions

## Prerequisites
- Stripe account (Live mode enabled)
- Vercel deployment URL

## Steps

### 1. Get Stripe API Keys
1. Go to https://dashboard.stripe.com/apikeys
2. Copy **Secret key** (starts with `sk_live_`)
3. Copy **Publishable key** (starts with `pk_live_`)

### 2. Add Keys to Vercel
1. Go to Vercel → Project → Settings → Environment Variables
2. Add:
STRIPE_SECRET_KEY=sk_live_xxxxx
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_live_xxxxx

text
3. Redeploy

### 3. Create Webhook
1. Go to https://dashboard.stripe.com/webhooks
2. Click "Add endpoint"
3. Set URL: `https://yourstore.vercel.app/api/stripe/webhooks`
4. Select events:
- `checkout.session.completed`
- `charge.refunded`
- `payment_intent.succeeded`
- `payment_intent.payment_failed`
5. Copy webhook signing secret (starts with `whsec_`)
6. Add to Vercel:
STRIPE_WEBHOOK_SECRET=whsec_xxxxx

text
7. Redeploy

### 4. Test Production Payment
1. Go to your store
2. Add item to cart
3. Proceed to checkout
4. Use test card: `4242 4242 4242 4242`
5. Check Stripe Dashboard → Payments

## Important Notes
- Never use test keys in production
- Keep webhook secret secure
- Monitor Stripe logs for errors