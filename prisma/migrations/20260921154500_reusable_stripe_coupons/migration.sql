CREATE TABLE IF NOT EXISTS "StripeCoupon" (
  "id" TEXT NOT NULL,
  "discountCodeId" TEXT NOT NULL,
  "stripeCouponId" TEXT NOT NULL,
  "currency" TEXT NOT NULL,
  "amountMinor" INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "StripeCoupon_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "StripeCoupon_stripeCouponId_key"
  ON "StripeCoupon"("stripeCouponId");
CREATE UNIQUE INDEX IF NOT EXISTS "StripeCoupon_discountCodeId_currency_amountMinor_key"
  ON "StripeCoupon"("discountCodeId", "currency", "amountMinor");
CREATE INDEX IF NOT EXISTS "StripeCoupon_discountCodeId_idx"
  ON "StripeCoupon"("discountCodeId");

ALTER TABLE "StripeCoupon"
  ADD CONSTRAINT "StripeCoupon_discountCodeId_fkey"
  FOREIGN KEY ("discountCodeId") REFERENCES "DiscountCode"("id") ON DELETE CASCADE ON UPDATE CASCADE;
