import pg from "pg";

const connectionString =
  process.env.DATABASE_URL ??
  "postgresql://postgres:12345@localhost:5432/workflows";

export const pool = new pg.Pool({ connectionString });
