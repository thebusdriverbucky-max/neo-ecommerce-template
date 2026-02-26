-- AlterTable
ALTER TABLE "Address" ALTER COLUMN "userId" DROP NOT NULL;

-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "guestEmail" TEXT,
ALTER COLUMN "userId" DROP NOT NULL;
