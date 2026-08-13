-- Catches up migration history with a column type change that was previously
-- applied to the dev database via `prisma db push` but never captured in a migration.
-- (Device.trialStartedAt / User.trialStartedAt are already covered by the
-- already-committed 20260429140000_subscriptions migration.)

-- AlterTable
ALTER TABLE "Listing" ALTER COLUMN "price" TYPE DOUBLE PRECISION;
