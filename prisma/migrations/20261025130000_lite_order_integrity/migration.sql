-- E-commerce Lite: order integrity and settings.
-- Idempotent and additive, like the Lite catch-up migration, so it also
-- applies cleanly to a database the Full template has already migrated.

-- Orders and the addresses they reference are financial records. Deleting a
-- customer account must detach them instead of cascading the delete.
ALTER TABLE "Order" DROP CONSTRAINT IF EXISTS "Order_userId_fkey";
ALTER TABLE "Order" ADD CONSTRAINT "Order_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Address" DROP CONSTRAINT IF EXISTS "Address_userId_fkey";
ALTER TABLE "Address" ADD CONSTRAINT "Address_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Keyed hash of the trusted client IP for the unpaid-reservation cap.
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "checkoutIpHash" TEXT;
CREATE INDEX IF NOT EXISTS "Order_checkoutIpHash_status_createdAt_idx"
  ON "Order"("checkoutIpHash", "status", "createdAt");

-- NULL now means "free shipping disabled". Existing values are unchanged.
ALTER TABLE "StoreSettings" ALTER COLUMN "freeShippingThreshold" DROP NOT NULL;
