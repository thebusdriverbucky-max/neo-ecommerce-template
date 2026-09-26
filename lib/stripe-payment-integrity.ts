import type { Order } from "@prisma/client";
import type Stripe from "stripe";

import { normalizeCurrency, toMinorUnits } from "./money";

type PaymentOrder = Pick<
  Order,
  | "id"
  | "total"
  | "currency"
  | "stripeCheckoutSessionId"
  | "stripePaymentIntentId"
>;

export class StripePaymentIntegrityError extends Error {}

export function getStripeDeploymentId(): string {
  const deploymentId = process.env.STRIPE_DEPLOYMENT_ID?.trim();
  if (!deploymentId) {
    throw new StripePaymentIntegrityError(
      "STRIPE_DEPLOYMENT_ID is not configured for this deployment",
    );
  }
  return deploymentId;
}

export function isStripeMetadataForThisDeployment(
  metadata: Stripe.Metadata | null,
): boolean {
  return metadata?.deploymentId === getStripeDeploymentId();
}

function assertMetadata(
  metadata: Stripe.Metadata | null,
  order: PaymentOrder,
) {
  if (metadata?.deploymentId !== getStripeDeploymentId()) {
    throw new StripePaymentIntegrityError("Stripe object belongs to another deployment");
  }
  if (metadata.orderId !== order.id) {
    throw new StripePaymentIntegrityError("Stripe object does not reference this order");
  }
}

function assertAmountAndCurrency(
  amountMinor: number,
  currency: string,
  order: PaymentOrder,
) {
  if (amountMinor !== toMinorUnits(order.total, order.currency)) {
    throw new StripePaymentIntegrityError("Stripe amount does not match order total");
  }
  if (normalizeCurrency(currency) !== normalizeCurrency(order.currency)) {
    throw new StripePaymentIntegrityError("Stripe currency does not match order currency");
  }
}

export function assertCheckoutSessionMatchesOrder(
  session: Stripe.Checkout.Session,
  order: PaymentOrder,
) {
  assertMetadata(session.metadata, order);

  if (
    order.stripeCheckoutSessionId
    && order.stripeCheckoutSessionId !== session.id
  ) {
    throw new StripePaymentIntegrityError(
      "Checkout Session does not belong to this order",
    );
  }
  if (typeof session.amount_total !== "number" || !session.currency) {
    throw new StripePaymentIntegrityError(
      "Checkout Session is missing amount or currency",
    );
  }
  assertAmountAndCurrency(session.amount_total, session.currency, order);

  const paymentIntentId = typeof session.payment_intent === "string"
    ? session.payment_intent
    : session.payment_intent?.id;
  if (
    order.stripePaymentIntentId
    && paymentIntentId
    && order.stripePaymentIntentId !== paymentIntentId
  ) {
    throw new StripePaymentIntegrityError(
      "PaymentIntent does not belong to this order",
    );
  }
}

export function assertPaymentIntentMatchesOrder(
  paymentIntent: Stripe.PaymentIntent,
  order: PaymentOrder,
) {
  assertMetadata(paymentIntent.metadata, order);

  if (
    order.stripePaymentIntentId
    && order.stripePaymentIntentId !== paymentIntent.id
  ) {
    throw new StripePaymentIntegrityError(
      "PaymentIntent does not belong to this order",
    );
  }
  assertAmountAndCurrency(
    paymentIntent.amount_received,
    paymentIntent.currency,
    order,
  );
}

export function assertStripeIdentifiersOwnedByOrder(
  order: Pick<Order, "stripeCheckoutSessionId" | "stripePaymentIntentId">,
  identifiers: {
    checkoutSessionId?: string | null;
    paymentIntentId?: string | null;
  },
) {
  if (
    order.stripeCheckoutSessionId
    && identifiers.checkoutSessionId
    && order.stripeCheckoutSessionId !== identifiers.checkoutSessionId
  ) {
    throw new StripePaymentIntegrityError(
      "Checkout Session does not belong to this order",
    );
  }
  if (
    order.stripePaymentIntentId
    && identifiers.paymentIntentId
    && order.stripePaymentIntentId !== identifiers.paymentIntentId
  ) {
    throw new StripePaymentIntegrityError(
      "PaymentIntent does not belong to this order",
    );
  }
}
