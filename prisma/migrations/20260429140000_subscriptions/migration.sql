-- CreateEnum
CREATE TYPE "SubscriptionStatus" AS ENUM ('TRIAL', 'ACTIVE', 'PAUSED', 'EXPIRED', 'CANCELLED');

-- AlterTable: Add trialStartedAt to Device (backfill existing rows with createdAt)
ALTER TABLE "Device" ADD COLUMN "trialStartedAt" TIMESTAMP(3);
UPDATE "Device" SET "trialStartedAt" = "createdAt";

-- AlterTable: Add trialStartedAt to User (backfill existing rows with createdAt)
ALTER TABLE "User" ADD COLUMN "trialStartedAt" TIMESTAMP(3);
UPDATE "User" SET "trialStartedAt" = "createdAt";

-- CreateTable: Subscription
CREATE TABLE "Subscription" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tier" "PlanTier" NOT NULL,
    "status" "SubscriptionStatus" NOT NULL DEFAULT 'ACTIVE',
    "revenuecatId" TEXT,
    "productId" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "renewsAt" TIMESTAMP(3),
    "pausedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Subscription_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Subscription_userId_key" ON "Subscription"("userId");
CREATE INDEX "Subscription_revenuecatId_idx" ON "Subscription"("revenuecatId");

-- AddForeignKey
ALTER TABLE "Subscription" ADD CONSTRAINT "Subscription_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
