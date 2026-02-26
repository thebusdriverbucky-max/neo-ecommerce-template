-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "orderNumber" TEXT;

-- CreateTable
CREATE TABLE "StoreSettings" (
    "id" TEXT NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "taxRate" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "shippingCost" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "enabledCountries" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StoreSettings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContentPage" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "isVisible" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ContentPage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ContentPage_slug_key" ON "ContentPage"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "Order_orderNumber_key" ON "Order"("orderNumber");
