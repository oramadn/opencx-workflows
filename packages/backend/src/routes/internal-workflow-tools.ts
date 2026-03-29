import express, { type Request, type Response } from "express";
import { z } from "zod";
import { pool } from "../db.js";
import { buildQuery } from "../services/query-builder.js";
import {
  type SessionRow,
  type MessageRow,
  sessionToJson,
  messageToJson,
} from "../lib/row-mappers.js";

const MAX_LIMIT = 500;
const MAX_WHERE_CLAUSES = 10;

const WhereConditionSchema = z.object({
  field: z.string(),
  op: z.enum(["eq", "neq", "in", "gt", "lt", "gte", "lte", "like"]),
  value: z.unknown(),
});

const QueryOptionsSchema = z
  .object({
    where: z.array(WhereConditionSchema).max(MAX_WHERE_CLAUSES).optional(),
    limit: z.number().int().min(1).max(MAX_LIMIT).optional(),
    orderBy: z
      .object({
        field: z.string(),
        direction: z.enum(["asc", "desc"]).optional(),
      })
      .optional(),
  })
  .optional();

const BodySchema = z.object({
  resource: z.enum(["sessions", "session_messages"]),
  options: QueryOptionsSchema,
});

export function internalWorkflowToolsRouter(): express.Router {
  const r = express.Router();

  r.post("/query", async (req: Request, res: Response) => {
    const secret = process.env.WORKFLOW_TOOLS_SECRET;
    if (!secret) {
      res.status(503).json({ error: "Workflow tools endpoint is not configured" });
      return;
    }

    const auth = req.headers.authorization;
    if (!auth || auth !== `Bearer ${secret}`) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    const parsed = BodySchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid request body", details: parsed.error.issues });
      return;
    }

    const { resource, options } = parsed.data;

    const cappedOptions = options
      ? { ...options, limit: Math.min(options.limit ?? MAX_LIMIT, MAX_LIMIT) }
      : { limit: MAX_LIMIT };

    let built;
    try {
      built = buildQuery(resource, cappedOptions);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Query build failed";
      res.status(400).json({ error: message });
      return;
    }

    const { rows } = await pool.query(built.text, built.values);

    if (resource === "sessions") {
      res.json((rows as SessionRow[]).map(sessionToJson));
    } else {
      res.json((rows as MessageRow[]).map(messageToJson));
    }
  });

  return r;
}
