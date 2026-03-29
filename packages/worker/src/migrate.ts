import { runMigrations } from "graphile-worker";

const connectionString =
  process.env.DATABASE_URL ??
  "postgresql://postgres:password@localhost:5432/workflows";

await runMigrations({ connectionString });
