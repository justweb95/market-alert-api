-- Izbor lokacije po gradu i precniku u kilometrima. Prazan niz gradova = cela
-- Srbija, pa postojeci signali zadrzavaju dosadasnje ponasanje (i dalje im vazi
-- stari izbor po regionima).
ALTER TABLE "Alert" ADD COLUMN "cities" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "Alert" ADD COLUMN "radiusKm" INTEGER;
