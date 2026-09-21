ALTER TABLE "Order"
  ADD COLUMN IF NOT EXISTS "checkoutRequestId" TEXT;

ALTER TABLE "DiscountCode"
  ADD COLUMN IF NOT EXISTS "stripeCouponId" TEXT;

ALTER TABLE "StripeRefund"
  ADD COLUMN IF NOT EXISTS "stripeCreatedAt" TIMESTAMP(3);

CREATE UNIQUE INDEX IF NOT EXISTS "Order_checkoutRequestId_key"
  ON "Order"("checkoutRequestId");
CREATE UNIQUE INDEX IF NOT EXISTS "DiscountCode_stripeCouponId_key"
  ON "DiscountCode"("stripeCouponId");
