import assert from "node:assert/strict";
import test from "node:test";

import { Prisma } from "@prisma/client";
import type Stripe from "stripe";

import {
  assertCheckoutSessionMatchesOrder,
  assertPaymentIntentMatchesOrder,
  assertStripeIdentifiersOwnedByOrder,
} from "../lib/stripe-payment-integrity";

process.env.STRIPE_DEPLOYMENT_ID = "store-test";

const order = {
  id: "order-1",
  total: new Prisma.Decimal("42.50"),
  currency: "EUR",
  stripeCheckoutSessionId: "cs_1",
  stripePaymentIntentId: "pi_1",
};

function checkoutSession(
  overrides: Partial<Stripe.Checkout.Session> = {},
): Stripe.Checkout.Session {
  return {
    id: "cs_1",
    object: "checkout.session",
    amount_total: 4_250,
    currency: "eur",
    payment_intent: "pi_1",
    metadata: { orderId: "order-1", deploymentId: "store-test" },
    ...overrides,
  } as Stripe.Checkout.Session;
}

function paymentIntent(
  overrides: Partial<Stripe.PaymentIntent> = {},
): Stripe.PaymentIntent {
  return {
    id: "pi_1",
    object: "payment_intent",
    amount_received: 4_250,
    currency: "eur",
    metadata: { orderId: "order-1", deploymentId: "store-test" },
    ...overrides,
  } as Stripe.PaymentIntent;
}

test("accepts Stripe objects bound to the expected order and deployment", () => {
  assert.doesNotThrow(() => assertCheckoutSessionMatchesOrder(checkoutSession(), order));
  assert.doesNotThrow(() => assertPaymentIntentMatchesOrder(paymentIntent(), order));
});

test("rejects mismatched order, deployment, amount, currency, and identifiers", () => {
  assert.throws(() => assertCheckoutSessionMatchesOrder(checkoutSession({
    metadata: { orderId: "order-2", deploymentId: "store-test" },
  }), order), /reference this order/);
  assert.throws(() => assertCheckoutSessionMatchesOrder(checkoutSession({
    metadata: { orderId: "order-1", deploymentId: "another-store" },
  }), order), /another deployment/);
  assert.throws(() => assertCheckoutSessionMatchesOrder(checkoutSession({
    amount_total: 4_249,
  }), order), /amount/);
  assert.throws(() => assertPaymentIntentMatchesOrder(paymentIntent({
    currency: "usd",
  }), order), /currency/);
  assert.throws(() => assertPaymentIntentMatchesOrder(paymentIntent({
    id: "pi_other",
  }), order), /does not belong/);
});

test("rejects replacing Stripe identifiers already owned by an order", () => {
  assert.throws(() => assertStripeIdentifiersOwnedByOrder(order, {
    checkoutSessionId: "cs_other",
  }), /Checkout Session/);
  assert.throws(() => assertStripeIdentifiersOwnedByOrder(order, {
    paymentIntentId: "pi_other",
  }), /PaymentIntent/);
});
