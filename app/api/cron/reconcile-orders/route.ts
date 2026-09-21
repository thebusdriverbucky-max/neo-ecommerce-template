import { db } from "@/lib/db";
import { stripe } from "@/lib/stripe";
import { confirmOrder, handleOrderCancellation } from "@/lib/order-confirmation";
import { isAuthorizedCronRequest } from "@/lib/cron-auth";
import { logger } from "@/lib/logger";
import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const WEBHOOK_GRACE_MS = 10 * 60 * 1000;
const NO_SESSION_GRACE_MS = 45 * 60 * 1000;
const MAX_PENDING_ORDERS_PER_RUN = 100;
const MAX_STRIPE_SESSION_PAGES = 10;

type PendingOrder = {
  id: string;
  createdAt: Date;
  stripeCheckoutSessionId: string | null;
  stripePaymentIntentId: string | null;
};

type SessionLookup = {
  sessionsByOrderId: Map<string, Stripe.Checkout.Session>;
  complete: boolean;
};

function getStripeErrorCode(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null || !("code" in error)) return undefined;
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" ? code : undefined;
}

async function findOrphanedCheckoutSessions(
  orders: PendingOrder[],
): Promise<SessionLookup> {
  const ordersWithoutSession = orders.filter((order) => !order.stripeCheckoutSessionId);
  if (ordersWithoutSession.length === 0) {
    return { sessionsByOrderId: new Map(), complete: true };
  }

  const oldestOrder = ordersWithoutSession.reduce(
    (oldest, order) => order.createdAt < oldest ? order.createdAt : oldest,
    ordersWithoutSession[0].createdAt,
  );
  const sessionsByOrderId = new Map<string, Stripe.Checkout.Session>();
  const orderIds = new Set(ordersWithoutSession.map((order) => order.id));
  let startingAfter: string | undefined;

  for (let pageNumber = 0; pageNumber < MAX_STRIPE_SESSION_PAGES; pageNumber += 1) {
    const page = await stripe.checkout.sessions.list({
      limit: 100,
      created: { gte: Math.floor(oldestOrder.getTime() / 1000) },
      ...(startingAfter ? { starting_after: startingAfter } : {}),
    });

    for (const session of page.data) {
      const orderId = session.metadata?.orderId;
      if (orderId && orderIds.has(orderId)) {
        sessionsByOrderId.set(orderId, session);
      }
    }

    if (!page.has_more || page.data.length === 0) {
      return { sessionsByOrderId, complete: true };
    }

    startingAfter = page.data[page.data.length - 1]?.id;
    if (!startingAfter) break;
  }

  // We cannot safely cancel an orphaned order if Stripe pagination was not
  // exhausted: a matching paid session may be on a later page.
  return { sessionsByOrderId, complete: false };
}

export async function GET(request: NextRequest) {
  if (!isAuthorizedCronRequest(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const now = Date.now();
  const webhookCutoff = new Date(now - WEBHOOK_GRACE_MS);
  const noSessionCutoff = new Date(now - NO_SESSION_GRACE_MS);

  try {
    const pendingOrders = await db.order.findMany({
      where: {
        status: "PENDING",
        createdAt: { lt: webhookCutoff },
      },
      select: {
        id: true,
        createdAt: true,
        stripeCheckoutSessionId: true,
        stripePaymentIntentId: true,
      },
      orderBy: { createdAt: "asc" },
      take: MAX_PENDING_ORDERS_PER_RUN,
    });

    const sessionLookup = await findOrphanedCheckoutSessions(pendingOrders);
    let storeSettings: unknown;
    let settingsLoaded = false;
    const summary = {
      scanned: pendingOrders.length,
      confirmed: 0,
      cancelled: 0,
      unchanged: 0,
      failed: 0,
    };

    const getStoreSettings = async () => {
      if (!settingsLoaded) {
        storeSettings = await db.storeSettings.findFirst();
        settingsLoaded = true;
      }
      return storeSettings;
    };

    for (const order of pendingOrders) {
      try {
        let checkoutSessionId = order.stripeCheckoutSessionId;
        let paymentIntentId = order.stripePaymentIntentId;
        let checkoutSession: Stripe.Checkout.Session | null = null;

        if (!checkoutSessionId) {
          checkoutSession = sessionLookup.sessionsByOrderId.get(order.id) || null;
          if (checkoutSession) {
            checkoutSessionId = checkoutSession.id;
            paymentIntentId = typeof checkoutSession.payment_intent === "string"
              ? checkoutSession.payment_intent
              : paymentIntentId;

            await db.order.updateMany({
              where: { id: order.id, status: "PENDING", stripeCheckoutSessionId: null },
              data: {
                stripeCheckoutSessionId: checkoutSessionId,
                stripePaymentIntentId: paymentIntentId,
              },
            });
          }
        }

        if (checkoutSessionId) {
          checkoutSession = checkoutSession || await stripe.checkout.sessions.retrieve(checkoutSessionId);

          if (checkoutSession.payment_status === "paid") {
            await confirmOrder(order.id, {
              paymentIntentId: typeof checkoutSession.payment_intent === "string"
                ? checkoutSession.payment_intent
                : paymentIntentId,
              checkoutSessionId: checkoutSession.id,
            }, await getStoreSettings());
            summary.confirmed += 1;
            continue;
          }

          if (checkoutSession.status === "expired") {
            if (await handleOrderCancellation(order.id)) summary.cancelled += 1;
            else summary.unchanged += 1;
            continue;
          }

          summary.unchanged += 1;
          continue;
        }

        if (paymentIntentId) {
          const paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId);
          if (paymentIntent.status === "succeeded") {
            await confirmOrder(order.id, { paymentIntentId }, await getStoreSettings());
            summary.confirmed += 1;
            continue;
          }
        }

        if (order.createdAt < noSessionCutoff && sessionLookup.complete) {
          if (await handleOrderCancellation(order.id)) summary.cancelled += 1;
          else summary.unchanged += 1;
        } else {
          summary.unchanged += 1;
        }
      } catch (error) {
        // A Stripe API error is not proof that the order was abandoned. Leave
        // it pending for the next run and alert through structured logs.
        summary.failed += 1;
        logger.error("Order reconciliation failed", {
          orderId: order.id,
          code: getStripeErrorCode(error),
        });
      }
    }

    logger.info("Order reconciliation completed", summary);
    return NextResponse.json(summary);
  } catch (error) {
    logger.error("Order reconciliation job failed", { code: getStripeErrorCode(error) });
    return NextResponse.json({ error: "Reconciliation failed" }, { status: 500 });
  }
}
