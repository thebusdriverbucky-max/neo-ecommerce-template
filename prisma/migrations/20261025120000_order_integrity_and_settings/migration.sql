-- Orders and the addresses they reference are financial records. Deleting a
-- customer account must detach them instead of cascading the delete.
-- DropForeignKey
ALTER TABLE "Address" DROP CONSTRAINT "Address_userId_fkey";

-- DropForeignKey
ALTER TABLE "Order" DROP CONSTRAINT "Order_userId_fkey";

-- Keyed hash of the trusted client IP for the unpaid-reservation cap.
-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "checkoutIpHash" TEXT;

-- NULL now means "free shipping disabled". Existing values are unchanged.
-- AlterTable
ALTER TABLE "StoreSettings" ALTER COLUMN "freeShippingThreshold" DROP NOT NULL;

-- CreateTable
CREATE TABLE "OrderNumberCounter" (
    "year" INTEGER NOT NULL,
    "value" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OrderNumberCounter_pkey" PRIMARY KEY ("year")
);

-- Continue every year's sequence from the highest existing order number
-- (format #YYYY-NNNNNN), so numbering never restarts after the upgrade.
INSERT INTO "OrderNumberCounter" ("year", "value", "updatedAt")
SELECT
    CAST(substring("orderNumber" FROM '^#([0-9]{4})-') AS INTEGER),
    MAX(CAST(substring("orderNumber" FROM '^#[0-9]{4}-([0-9]{1,9})$') AS INTEGER)),
    CURRENT_TIMESTAMP
FROM "Order"
WHERE "orderNumber" ~ '^#[0-9]{4}-[0-9]{1,9}$'
GROUP BY 1;

-- CreateIndex
CREATE INDEX "Order_checkoutIpHash_status_createdAt_idx" ON "Order"("checkoutIpHash", "status", "createdAt");

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Address" ADD CONSTRAINT "Address_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
