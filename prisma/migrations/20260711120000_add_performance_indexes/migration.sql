-- CreateIndex
CREATE INDEX IF NOT EXISTS "Alert_isActive_idx" ON "Alert"("isActive");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Alert_category_idx" ON "Alert"("category");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Alert_isActive_category_idx" ON "Alert"("isActive", "category");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Alert_createdAt_idx" ON "Alert"("createdAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Notification_alertId_idx" ON "Notification"("alertId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Notification_listingId_idx" ON "Notification"("listingId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Notification_alertId_listingId_idx" ON "Notification"("alertId", "listingId");
