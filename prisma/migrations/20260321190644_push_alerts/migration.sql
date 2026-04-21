-- AlterEnum
ALTER TYPE "Platform" ADD VALUE 'WEB';

-- CreateIndex
CREATE INDEX "Listing_createdAt_idx" ON "Listing"("createdAt");
