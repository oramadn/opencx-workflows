import cors from "cors";
import express from "express";
import { run as runWorker } from "graphile-worker";
import { internalWorkflowToolsRouter } from "./routes/internal-workflow-tools.js";
import { sessionsRouter } from "./routes/sessions.js";
import { workflowsRouter } from "./routes/workflows.js";
import { segmentTaskList } from "./services/workflow-segment-executor.js";

const PORT = Number(process.env.PORT ?? 3001);
const connectionString =
  process.env.DATABASE_URL ??
  "postgresql://postgres:password@localhost:5432/workflows";

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

app.listen(PORT, async () => {
  console.log(`Backend listening on http://localhost:${PORT}`);

  try {
    const runner = await runWorker({
      connectionString,
      concurrency: 5,
      noHandleSignals: true,
      noPreparedStatements: false,
      taskList: segmentTaskList,
    });
    console.log("graphile-worker started (workflow segment executor)");

    const shutdown = () => {
      runner.stop().catch(console.error);
    };
    process.on("SIGTERM", shutdown);
    process.on("SIGINT", shutdown);
  } catch (err) {
    console.error("Failed to start graphile-worker:", err);
  }
});
