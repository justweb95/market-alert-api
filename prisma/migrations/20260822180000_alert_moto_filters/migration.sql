-- Pod-filteri za motocikle: tip motora i kubikaza.
-- Prazan niz / NULL znaci "nije bitno" - postojeci signali ostaju bez filtera.
ALTER TABLE "Alert" ADD COLUMN "motoTypes" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "Alert" ADD COLUMN "ccmFrom" INTEGER;
ALTER TABLE "Alert" ADD COLUMN "ccmTo" INTEGER;
