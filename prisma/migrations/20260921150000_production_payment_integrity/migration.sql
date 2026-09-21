-- Separate Stripe identifiers and retain values written by older builds.
ALTER TABLE "Order"
  ADD COLUMN IF NOT EXISTS "discountAmount" DECIMAL(10,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "stripeCheckoutSessionId" TEXT,
  ADD COLUMN IF NOT EXISTS "guestAccessTokenHash" TEXT,
  ADD COLUMN IF NOT EXISTS "guestAccessTokenExpiresAt" TIMESTAMP(3);

UPDATE "Order"
SET
  "stripeCheckoutSessionId" = "stripePaymentIntentId",
  "stripePaymentIntentId" = NULL
WHERE "stripePaymentIntentId" LIKE 'cs_%'
  AND "stripeCheckoutSessionId" IS NULL;

WITH duplicate_payment_intents AS (
  SELECT id, ROW_NUMBER() OVER (
    PARTITION BY "stripePaymentIntentId" ORDER BY "createdAt", id
  ) AS row_number
  FROM "Order"
  WHERE "stripePaymentIntentId" IS NOT NULL
)
UPDATE "Order" AS orders
SET "stripePaymentIntentId" = NULL
FROM duplicate_payment_intents AS duplicates
WHERE orders.id = duplicates.id AND duplicates.row_number > 1;

WITH duplicate_checkout_sessions AS (
  SELECT id, ROW_NUMBER() OVER (
    PARTITION BY "stripeCheckoutSessionId" ORDER BY "createdAt", id
  ) AS row_number
  FROM "Order"
  WHERE "stripeCheckoutSessionId" IS NOT NULL
)
UPDATE "Order" AS orders
SET "stripeCheckoutSessionId" = NULL
FROM duplicate_checkout_sessions AS duplicates
WHERE orders.id = duplicates.id AND duplicates.row_number > 1;

CREATE UNIQUE INDEX IF NOT EXISTS "Order_stripeCheckoutSessionId_key"
  ON "Order"("stripeCheckoutSessionId");
CREATE UNIQUE INDEX IF NOT EXISTS "Order_stripePaymentIntentId_key"
  ON "Order"("stripePaymentIntentId");
CREATE UNIQUE INDEX IF NOT EXISTS "Order_guestAccessTokenHash_key"
  ON "Order"("guestAccessTokenHash");

CREATE TABLE IF NOT EXISTS "StripeEvent" (
  "id" TEXT NOT NULL,
  "eventId" TEXT NOT NULL,
  "type" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'PROCESSING',
  "error" TEXT,
  "processedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "StripeEvent_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "StripeEvent_eventId_key"
  ON "StripeEvent"("eventId");
CREATE INDEX IF NOT EXISTS "StripeEvent_status_createdAt_idx"
  ON "StripeEvent"("status", "createdAt");

CREATE TABLE IF NOT EXISTS "StripeRefund" (
  "id" TEXT NOT NULL,
  "orderId" TEXT NOT NULL,
  "stripeRefundId" TEXT NOT NULL,
  "paymentIntentId" TEXT NOT NULL,
  "amount" DECIMAL(10,2) NOT NULL,
  "amountMinor" INTEGER NOT NULL,
  "currency" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "StripeRefund_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "StripeRefund_stripeRefundId_key"
  ON "StripeRefund"("stripeRefundId");
CREATE INDEX IF NOT EXISTS "StripeRefund_orderId_idx"
  ON "StripeRefund"("orderId");
CREATE INDEX IF NOT EXISTS "StripeRefund_paymentIntentId_idx"
  ON "StripeRefund"("paymentIntentId");

ALTER TABLE "StripeRefund"
  ADD CONSTRAINT "StripeRefund_orderId_fkey"
  FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;
