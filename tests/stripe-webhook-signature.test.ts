import assert from "node:assert/strict";
import test from "node:test";
import Stripe from "stripe";

import { constructStripeWebhookEvent } from "../lib/stripe-webhook-signature";

const stripe = new Stripe("sk_test_local_signature_verification", {
  typescript: true,
});
const secret = "whsec_local_signature_verification";
const payload = JSON.stringify({
  id: "evt_local_signature_verification",
  object: "event",
  type: "payment_intent.succeeded",
  data: { object: { id: "pi_local_signature_verification" } },
});

test("accepts an authentic Stripe signature over the exact raw payload", () => {
  const signature = stripe.webhooks.generateTestHeaderString({ payload, secret });

  const event = constructStripeWebhookEvent(stripe, payload, signature, secret);

  assert.equal(event.id, "evt_local_signature_verification");
  assert.equal(event.type, "payment_intent.succeeded");
});

test("rejects a modified payload, wrong secret, and missing signature", () => {
  const signature = stripe.webhooks.generateTestHeaderString({ payload, secret });

  assert.throws(() =>
    constructStripeWebhookEvent(stripe, `${payload} `, signature, secret),
  );
  assert.throws(() =>
    constructStripeWebhookEvent(stripe, payload, signature, "whsec_wrong"),
  );
  assert.throws(() => constructStripeWebhookEvent(stripe, payload, "", secret));
});
