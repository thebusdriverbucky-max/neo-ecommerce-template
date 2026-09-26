-- Add the gallery field represented in schema.prisma but missing from the
-- versioned migration history. Existing products receive an empty gallery.
ALTER TABLE "Product"
ADD COLUMN "images" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

-- The default above backfills existing rows during an upgrade. New writes must
-- still provide the field, matching the Prisma schema contract.
ALTER TABLE "Product"
ALTER COLUMN "images" DROP DEFAULT;
