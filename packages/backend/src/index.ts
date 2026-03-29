import cors from "cors";
import express from "express";
import { sessionsRouter } from "./routes/sessions.js";

const PORT = Number(process.env.PORT ?? 3001);

const app = express();
app.use(
  cors({
    origin: ["http://localhost:5173", "http://127.0.0.1:5173"],
  }),
);
app.use(express.json({ limit: "1mb" }));

app.use("/api/sessions", sessionsRouter());

app.listen(PORT, () => {
  console.log(`Backend listening on http://localhost:${PORT}`);
});
