import express, { type Request, type Response } from "express";
import { pool } from "../db.js";
import { generateWorkflow } from "../services/llm-generation.js";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isUuid(s: string): boolean {
  return UUID_RE.test(s);
}

type WorkflowRow = {
  id: string;
  name: string;
  trigger_events: string[];
  original_prompt: string;
  generated_code: string;
  is_active: boolean;
  created_at: Date;
  updated_at: Date;
};

function workflowToJson(row: WorkflowRow) {
  return {
    id: row.id,
    name: row.name,
    triggerEvents: row.trigger_events,
    originalPrompt: row.original_prompt,
    generatedCode: row.generated_code,
    isActive: row.is_active,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

export function workflowsRouter(): express.Router {
  const r = express.Router();

  r.get("/", async (_req: Request, res: Response) => {
    const { rows } = await pool.query<WorkflowRow>(
      `SELECT id, name, trigger_events, original_prompt, generated_code,
              is_active, created_at, updated_at
       FROM workflows
       ORDER BY updated_at DESC`,
    );
    res.json(rows.map(workflowToJson));
  });

  r.get("/:id", async (req: Request, res: Response) => {
    const id = req.params.id as string | undefined;
    if (!id || !isUuid(id)) {
      res.status(400).json({ error: "Invalid workflow id" });
      return;
    }

    const { rows, rowCount } = await pool.query<WorkflowRow>(
      `SELECT id, name, trigger_events, original_prompt, generated_code,
              is_active, created_at, updated_at
       FROM workflows WHERE id = $1`,
      [id],
    );

    if (rowCount === 0) {
      res.status(404).json({ error: "Workflow not found" });
      return;
    }

    res.json(workflowToJson(rows[0]!));
  });

  r.post("/generate", async (req: Request, res: Response) => {
    const prompt =
      typeof req.body?.prompt === "string" ? req.body.prompt.trim() : "";
    if (prompt.length === 0) {
      res.status(400).json({ error: "prompt is required" });
      return;
    }

    const workflowId =
      typeof req.body?.workflowId === "string" ? req.body.workflowId : null;

    if (workflowId && !isUuid(workflowId)) {
      res.status(400).json({ error: "Invalid workflowId" });
      return;
    }

    let existingTriggerEvents: string[] | undefined;
    let existingCode: string | undefined;

    if (workflowId) {
      const existing = await pool.query<WorkflowRow>(
        `SELECT trigger_events, generated_code FROM workflows WHERE id = $1`,
        [workflowId],
      );
      if (existing.rowCount === 0) {
        res.status(404).json({ error: "Workflow not found" });
        return;
      }
      existingTriggerEvents = existing.rows[0]!.trigger_events;
      existingCode = existing.rows[0]!.generated_code;
    }

    let result;
    try {
      result = await generateWorkflow({
        prompt,
        existingTriggerEvents,
        existingCode,
      });
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Generation failed";
      console.error("Workflow generation error:", err);
      res.status(502).json({ error: message });
      return;
    }

    const name = prompt.length > 80 ? prompt.slice(0, 77) + "..." : prompt;
    let row: WorkflowRow;

    if (workflowId) {
      const { rows } = await pool.query<WorkflowRow>(
        `UPDATE workflows
         SET trigger_events = $2, generated_code = $3, original_prompt = $4,
             updated_at = CURRENT_TIMESTAMP
         WHERE id = $1
         RETURNING id, name, trigger_events, original_prompt, generated_code,
                   is_active, created_at, updated_at`,
        [workflowId, result.trigger_events, result.code, prompt],
      );
      row = rows[0]!;
    } else {
      const { rows } = await pool.query<WorkflowRow>(
        `INSERT INTO workflows (name, trigger_events, original_prompt, generated_code)
         VALUES ($1, $2, $3, $4)
         RETURNING id, name, trigger_events, original_prompt, generated_code,
                   is_active, created_at, updated_at`,
        [name, result.trigger_events, prompt, result.code],
      );
      row = rows[0]!;
    }

    res.status(workflowId ? 200 : 201).json(workflowToJson(row));
  });

  return r;
}
