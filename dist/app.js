import express from "express";
import cors from "cors";
export const app = express();
app.set("trust proxy", 1);
app.use(cors());
app.use(express.json());
app.get("/api/health", (_req, res) => res.json({ ok: true }));
export function installErrorHandler() {
    app.use((error, _req, res, next) => {
        // Puna greska (moguce tehnicka, na engleskom, iz Prisma/BullMQ/itd.) ide samo u
        // server log — korisniku se nikad ne salje sirova interna poruka, uvek
        // citljiva srpska poruka. Ovo je poslednja linija odbrane za bagove koje
        // route-specificni try/catch nije uhvatio.
        console.error("[api] Unhandled error:", error);
        // Ako je response vec poceo da se salje (npr. streaming), Express dokumentacija
        // trazi da se delegira default handler-u umesto rucnog pisanja u res.
        if (res.headersSent)
            return next(error);
        res.status(500).json({ error: "Doslo je do greske na serveru. Pokusaj ponovo za par trenutaka." });
    });
}
//# sourceMappingURL=app.js.map