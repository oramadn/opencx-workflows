import { run } from "graphile-worker";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

const connectionString =
  process.env.DATABASE_URL ??
  "postgresql://postgres:password@localhost:5432/workflows";

const runner = await run({
  connectionString,
  taskDirectory: join(__dirname, "tasks"),
});

const shutdown = async () => {
  await runner.stop();
  process.exit(0);
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
