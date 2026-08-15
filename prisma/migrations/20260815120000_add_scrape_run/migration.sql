-- CreateTable
CREATE TABLE "ScrapeRun" (
    "id" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "success" BOOLEAN NOT NULL,
    "itemCount" INTEGER NOT NULL DEFAULT 0,
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ScrapeRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ScrapeRun_createdAt_idx" ON "ScrapeRun"("createdAt");
