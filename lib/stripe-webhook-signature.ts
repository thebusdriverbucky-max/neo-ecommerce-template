import type Stripe from "stripe";

export function constructStripeWebhookEvent(
  stripe: Stripe,
  payload: string,
  signature: string,
  secret: string,
): Stripe.Event {
  return stripe.webhooks.constructEvent(payload, signature, secret);
}
