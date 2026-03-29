import cors from "cors";
import express from "express";
import { internalWorkflowToolsRouter } from "./routes/internal-workflow-tools.js";
import { sessionsRouter } from "./routes/sessions.js";
import { workflowsRouter } from "./routes/workflows.js";

const PORT = Number(process.env.PORT ?? 3001);

const app = express();
app.use(
  cors({
    origin: ["http://localhost:5173", "http://127.0.0.1:5173"],
  }),
);
app.use(express.json({ limit: "1mb" }));

app.use("/api/sessions", sessionsRouter());
app.use("/api/workflows", workflowsRouter());
app.use("/api/internal/workflow-tools", internalWorkflowToolsRouter());

app.listen(PORT, () => {
  console.log(`Backend listening on http://localhost:${PORT}`);
});
