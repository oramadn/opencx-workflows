import pg from "pg";

const connectionString =
  process.env.DATABASE_URL ??
  "postgresql://postgres:password@localhost:5432/workflows";

export const pool = new pg.Pool({ connectionString });
