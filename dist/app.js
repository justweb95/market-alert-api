import express from "express";
import cors from "cors";
export const app = express();
app.use(cors());
app.use(express.json());
app.get("/api/health", (_req, res) => res.json({ ok: true }));
export function installErrorHandler() {
    app.use((error, _req, res, _next) => {
        const message = error instanceof Error ? error.message : "Nepoznata greska";
        console.error("[api] Unhandled error:", error);
        res.status(500).json({ error: message });
    });
}
//# sourceMappingURL=app.js.map