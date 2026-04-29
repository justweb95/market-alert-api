-- AlterEnum
ALTER TYPE "NotificationStatus" ADD VALUE 'FAILED';

-- AlterTable
ALTER TABLE "Notification"
ADD COLUMN "retries" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "lastError" TEXT,
ADD COLUMN "sentAt" TIMESTAMP(3),
ADD COLUMN "failedAt" TIMESTAMP(3);
