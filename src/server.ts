import "dotenv/config";
import { app } from "./app.js";

import { facebookPagesRouter } from "./features/facebookPages/facebookPages.routes.js";
import { kpPagesRouter } from "./features/kpPages/kpPages.routes.js";

const port = Number(process.env.PORT ?? 3000);

app.use("/api/facebook-pages", facebookPagesRouter);
app.use('/api/kp/', kpPagesRouter);


app.listen(port, "0.0.0.0", () => {
  console.log(`API listening on http://localhost:${port}`);
});


app.get("/health", (req, res) => {
  res.status(200).json({ status: "ok" });
});
