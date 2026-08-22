-- Filteri za vrstu goriva i tip karoserije na signalu.
-- Prazan niz znaci "nije bitno" - postojeci signali ostaju bez filtera.
ALTER TABLE "Alert" ADD COLUMN "fuelTypes" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "Alert" ADD COLUMN "bodyTypes" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
