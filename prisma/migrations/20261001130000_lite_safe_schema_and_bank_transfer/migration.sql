-- E-commerce Lite schema catch-up.
-- This migration is deliberately additive so one PostgreSQL database can be
-- used while testing Full and Lite. It never removes Full/Stripe columns.

ALTER TYPE "OrderStatus" ADD VALUE IF NOT EXISTS 'PARTIALLY_REFUNDED';

ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "sessionVersion" INTEGER NOT NULL DEFAULT 0;
CREATE TABLE IF NOT EXISTS "OwnerSetup" (
  "id" TEXT PRIMARY KEY,
  "email" TEXT NOT NULL,
  "tokenHash" TEXT,
  "expiresAt" TIMESTAMP(3),
  "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completedAt" TIMESTAMP(3)
);

ALTER TABLE "Product"
  ADD COLUMN IF NOT EXISTS "currency" TEXT NOT NULL DEFAULT 'USD',
  ADD COLUMN IF NOT EXISTS "isArchived" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "images" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

ALTER TABLE "Address" ALTER COLUMN "userId" DROP NOT NULL;
ALTER TABLE "Order" ALTER COLUMN "userId" DROP NOT NULL;

ALTER TABLE "Order"
  ADD COLUMN IF NOT EXISTS "guestEmail" TEXT,
  ADD COLUMN IF NOT EXISTS "trackingNumber" TEXT,
  ADD COLUMN IF NOT EXISTS "discountAmount" DECIMAL(10,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "discountCode" TEXT,
  ADD COLUMN IF NOT EXISTS "checkoutRequestId" TEXT,
  ADD COLUMN IF NOT EXISTS "requestFingerprint" TEXT,
  ADD COLUMN IF NOT EXISTS "discountReleasedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "paymentIban" TEXT,
  ADD COLUMN IF NOT EXISTS "paymentBankName" TEXT,
  ADD COLUMN IF NOT EXISTS "paymentAccountName" TEXT,
  ADD COLUMN IF NOT EXISTS "paymentDetails" TEXT,
  ADD COLUMN IF NOT EXISTS "reservationExpiresAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "reservationExpiredAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "stockReleasedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "paymentConfirmedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "paymentConfirmedBy" TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS "Order_checkoutRequestId_key"
  ON "Order"("checkoutRequestId");
CREATE INDEX IF NOT EXISTS "Order_status_reservationExpiresAt_idx"
  ON "Order"("status", "reservationExpiresAt");

ALTER TABLE "Review"
  ADD COLUMN IF NOT EXISTS "title" TEXT,
  ALTER COLUMN "rating" SET DATA TYPE SMALLINT,
  ALTER COLUMN "comment" DROP NOT NULL;

-- Preserve legacy reviews: stop with an actionable error instead of deleting
-- duplicates or silently deploying a schema without its required unique index.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = current_schema()
      AND indexname = 'Review_productId_userId_key'
  ) THEN
    IF EXISTS (SELECT 1 FROM "Review" GROUP BY "productId", "userId" HAVING COUNT(*) > 1) THEN
      RAISE EXCEPTION 'Duplicate reviews require manual reconciliation before migration; no reviews were deleted.';
    END IF;
    CREATE UNIQUE INDEX "Review_productId_userId_key" ON "Review"("productId", "userId");
  END IF;
END $$;

ALTER TABLE "StoreSettings"
  ADD COLUMN IF NOT EXISTS "storeName" TEXT,
  ADD COLUMN IF NOT EXISTS "storeEmail" TEXT,
  ADD COLUMN IF NOT EXISTS "heroTitle" TEXT,
  ADD COLUMN IF NOT EXISTS "heroSubtitle" TEXT,
  ADD COLUMN IF NOT EXISTS "heroButtonText" TEXT,
  ADD COLUMN IF NOT EXISTS "ctaTitle" TEXT,
  ADD COLUMN IF NOT EXISTS "ctaSubtitle" TEXT,
  ADD COLUMN IF NOT EXISTS "ctaButtonText" TEXT,
  ADD COLUMN IF NOT EXISTS "footerCopyright" TEXT,
  ADD COLUMN IF NOT EXISTS "faviconUrl" TEXT,
  ADD COLUMN IF NOT EXISTS "ogImageUrl" TEXT,
  ADD COLUMN IF NOT EXISTS "siteLang" TEXT DEFAULT 'en',
  ADD COLUMN IF NOT EXISTS "paymentIban" TEXT,
  ADD COLUMN IF NOT EXISTS "paymentBankName" TEXT,
  ADD COLUMN IF NOT EXISTS "paymentAccountName" TEXT,
  ADD COLUMN IF NOT EXISTS "paymentDetails" TEXT;

CREATE TABLE IF NOT EXISTS "Wishlist" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "productId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Wishlist_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "Wishlist_userId_productId_key"
  ON "Wishlist"("userId", "productId");

DO $$
BEGIN
  IF to_regclass('"WishlistItem"') IS NOT NULL THEN
    INSERT INTO "Wishlist" ("id", "userId", "productId", "createdAt")
    SELECT "id", "userId", "productId", "createdAt" FROM "WishlistItem"
    ON CONFLICT DO NOTHING;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "Wishlist_userId_idx" ON "Wishlist"("userId");
CREATE INDEX IF NOT EXISTS "Wishlist_productId_idx" ON "Wishlist"("productId");
CREATE UNIQUE INDEX IF NOT EXISTS "Wishlist_userId_productId_key"
  ON "Wishlist"("userId", "productId");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Wishlist_userId_fkey' AND conrelid = '"Wishlist"'::regclass) THEN
    ALTER TABLE "Wishlist" ADD CONSTRAINT "Wishlist_userId_fkey"
      FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Wishlist_productId_fkey' AND conrelid = '"Wishlist"'::regclass) THEN
    ALTER TABLE "Wishlist" ADD CONSTRAINT "Wishlist_productId_fkey"
      FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "Coupon" (
  "id" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "description" TEXT,
  "type" TEXT NOT NULL DEFAULT 'percent',
  "value" DECIMAL(10,2) NOT NULL,
  "minAmount" DECIMAL(10,2) NOT NULL DEFAULT 0,
  "maxDiscount" DECIMAL(10,2),
  "usageLimit" INTEGER,
  "used" INTEGER NOT NULL DEFAULT 0,
  "expiresAt" TIMESTAMP(3),
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Coupon_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "Coupon_code_key" ON "Coupon"("code");
CREATE INDEX IF NOT EXISTS "Coupon_code_idx" ON "Coupon"("code");
CREATE INDEX IF NOT EXISTS "Coupon_isActive_idx" ON "Coupon"("isActive");

ALTER TABLE "DiscountCode"
  ADD COLUMN IF NOT EXISTS "minAmount" DECIMAL(10,2),
  ADD COLUMN IF NOT EXISTS "maxDiscount" DECIMAL(10,2),
  ADD COLUMN IF NOT EXISTS "usageLimit" INTEGER,
  ADD COLUMN IF NOT EXISTS "used" INTEGER NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS "InventoryAlert" (
  "id" TEXT NOT NULL,
  "productId" TEXT NOT NULL,
  "threshold" INTEGER NOT NULL DEFAULT 5,
  "lastAlertAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "InventoryAlert_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "InventoryAlert_productId_key"
  ON "InventoryAlert"("productId");
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'InventoryAlert_productId_fkey' AND conrelid = '"InventoryAlert"'::regclass) THEN
    ALTER TABLE "InventoryAlert" ADD CONSTRAINT "InventoryAlert_productId_fkey"
      FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
