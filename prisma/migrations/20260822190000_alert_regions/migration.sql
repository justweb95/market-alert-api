-- Izbor regiona Srbije na signalu (mapa). Prazan niz = cela Srbija,
-- pa postojeci signali zadrzavaju dosadasnje ponasanje.
ALTER TABLE "Alert" ADD COLUMN "regions" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
