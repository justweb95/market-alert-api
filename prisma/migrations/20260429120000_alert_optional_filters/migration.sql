-- Make price optional so ALL-category alerts can work as keyword-only filters.
ALTER TABLE "Alert" ALTER COLUMN "priceMax" DROP NOT NULL;

-- Optional advanced filters
ALTER TABLE "Alert"
  ADD COLUMN "propertyType" TEXT,
  ADD COLUMN "yearFrom" INTEGER,
  ADD COLUMN "yearTo" INTEGER,
  ADD COLUMN "kmFrom" INTEGER,
  ADD COLUMN "kmTo" INTEGER;
