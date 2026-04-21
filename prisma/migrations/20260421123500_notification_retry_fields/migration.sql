DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_type t
    JOIN pg_enum e ON t.oid = e.enumtypid
    WHERE t.typname = 'NotificationStatus'
      AND e.enumlabel = 'FAILED'
  ) THEN
    ALTER TYPE "NotificationStatus" ADD VALUE 'FAILED';
  END IF;
END $$;

ALTER TABLE "Notification"
  ADD COLUMN IF NOT EXISTS "retries" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "lastError" TEXT,
  ADD COLUMN IF NOT EXISTS "sentAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "failedAt" TIMESTAMP(3);

CREATE INDEX IF NOT EXISTS "Notification_deviceId_status_idx"
  ON "Notification"("deviceId", "status");

CREATE INDEX IF NOT EXISTS "Notification_createdAt_idx"
  ON "Notification"("createdAt");
