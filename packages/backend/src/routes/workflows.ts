import express, { type Request, type Response } from "express";
import { z } from "zod";
import { pool } from "../db.js";
import { composeWorkflowCode } from "../services/compose-workflow-code.js";
import {
  findUnknownToolCalls,
  generateWorkflow,
} from "../services/llm-generation.js";
import { validateStepCode } from "../services/validate-step-code.js";
import { runWorkflowInSandbox } from "../services/workflow-e2b-runner.js";
import type { FlowGraph, WorkflowEvent } from "../workflow-sdk.js";

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
  flow_graph: FlowGraph | null;
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
    flowGraph: row.flow_graph,
    isActive: row.is_active,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

export function workflowsRouter(): express.Router {
  const r = express.Router();

  const WORKFLOW_COLS = `id, name, trigger_events, original_prompt, generated_code,
              flow_graph, is_active, created_at, updated_at`;

  r.get("/", async (_req: Request, res: Response) => {
    const { rows } = await pool.query<WorkflowRow>(
      `SELECT ${WORKFLOW_COLS} FROM workflows ORDER BY updated_at DESC`,
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
      `SELECT ${WORKFLOW_COLS} FROM workflows WHERE id = $1`,
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
    let existingFlowGraph: FlowGraph | undefined;

    if (workflowId) {
      const existing = await pool.query<WorkflowRow>(
        `SELECT trigger_events, flow_graph FROM workflows WHERE id = $1`,
        [workflowId],
      );
      if (existing.rowCount === 0) {
        res.status(404).json({ error: "Workflow not found" });
        return;
      }
      existingTriggerEvents = existing.rows[0]!.trigger_events;
      existingFlowGraph = existing.rows[0]!.flow_graph ?? undefined;
    }

    let outcome;
    try {
      outcome = await generateWorkflow({
        prompt,
        existingTriggerEvents,
        existingFlowGraph,
      });
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Generation failed";
      console.error("Workflow generation error:", err);
      res.status(502).json({ error: message });
      return;
    }

    if (outcome.status === "rejected") {
      res.status(422).json({
        error: outcome.reason,
        unsupportedCapabilities: outcome.unsupported ?? [],
      });
      return;
    }

    let row: WorkflowRow;

    const flowGraphJson = JSON.stringify(outcome.flow);
    const composedCode = composeWorkflowCode(outcome.flow);

    if (workflowId) {
      const { rows } = await pool.query<WorkflowRow>(
        `UPDATE workflows
         SET trigger_events = $2, generated_code = $3, original_prompt = $4,
             flow_graph = $5, updated_at = CURRENT_TIMESTAMP
         WHERE id = $1
         RETURNING ${WORKFLOW_COLS}`,
        [workflowId, outcome.trigger_events, composedCode, prompt, flowGraphJson],
      );
      row = rows[0]!;
    } else {
      const nextNum = await pool
        .query<{ n: string }>(
          `SELECT COALESCE(MAX((REGEXP_MATCH(name, '^Untitled-(\\d+)$'))[1]::int), 0) + 1 AS n
           FROM workflows WHERE name ~ '^Untitled-\\d+$'`,
        )
        .then((r) => Number(r.rows[0]!.n));
      const name = `Untitled-${nextNum}`;

      const { rows } = await pool.query<WorkflowRow>(
        `INSERT INTO workflows (name, trigger_events, original_prompt, generated_code, flow_graph)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING ${WORKFLOW_COLS}`,
        [name, outcome.trigger_events, prompt, composedCode, flowGraphJson],
      );
      row = rows[0]!;
    }

    res.status(workflowId ? 200 : 201).json(workflowToJson(row));
  });

  const SessionClosedEventSchema = z.object({
    triggerType: z.literal("onSessionClosed"),
    sessionId: z.string().min(1),
    customerName: z.string().min(1),
    customerEmail: z.string().min(1),
    sentiment: z.enum(["happy", "neutral", "angry"]),
    createdAt: z.string().min(1),
  });

  const SessionOpenedEventSchema = z.object({
    triggerType: z.literal("onSessionOpened"),
    sessionId: z.string().min(1),
    customerName: z.string().min(1),
    customerEmail: z.string().min(1),
    createdAt: z.string().min(1),
  });

  const WorkflowEventSchema = z.discriminatedUnion("triggerType", [
    SessionClosedEventSchema,
    SessionOpenedEventSchema,
  ]);

  r.patch("/:id/active", async (req: Request, res: Response) => {
    const id = req.params.id as string | undefined;
    if (!id || !isUuid(id)) {
      res.status(400).json({ error: "Invalid workflow id" });
      return;
    }

    const { isActive } = req.body ?? {};
    if (typeof isActive !== "boolean") {
      res.status(400).json({ error: "isActive must be a boolean" });
      return;
    }

    const { rows, rowCount } = await pool.query<WorkflowRow>(
      `UPDATE workflows
       SET is_active = $2, updated_at = CURRENT_TIMESTAMP
       WHERE id = $1
       RETURNING ${WORKFLOW_COLS}`,
      [id, isActive],
    );

    if (rowCount === 0) {
      res.status(404).json({ error: "Workflow not found" });
      return;
    }

    res.json(workflowToJson(rows[0]!));
  });

  r.patch("/:id/name", async (req: Request, res: Response) => {
    const id = req.params.id as string | undefined;
    if (!id || !isUuid(id)) {
      res.status(400).json({ error: "Invalid workflow id" });
      return;
    }

    const name =
      typeof req.body?.name === "string" ? req.body.name.trim() : "";
    if (name.length === 0) {
      res.status(400).json({ error: "name must be a non-empty string" });
      return;
    }
    if (name.length > 255) {
      res.status(400).json({ error: "name must be at most 255 characters" });
      return;
    }

    const { rows, rowCount } = await pool.query<WorkflowRow>(
      `UPDATE workflows
       SET name = $2, updated_at = CURRENT_TIMESTAMP
       WHERE id = $1
       RETURNING ${WORKFLOW_COLS}`,
      [id, name],
    );

    if (rowCount === 0) {
      res.status(404).json({ error: "Workflow not found" });
      return;
    }

    res.json(workflowToJson(rows[0]!));
  });

  r.patch("/:id/nodes/:nodeId/code", async (req: Request, res: Response) => {
    const id = req.params.id as string | undefined;
    const nodeId = req.params.nodeId as string | undefined;

    if (!id || !isUuid(id)) {
      res.status(400).json({ error: "Invalid workflow id" });
      return;
    }
    if (!nodeId || nodeId.trim().length === 0) {
      res.status(400).json({ error: "Invalid node id" });
      return;
    }

    const code =
      typeof req.body?.code === "string" ? req.body.code : undefined;
    if (code === undefined) {
      res.status(400).json({ error: "code is required" });
      return;
    }

    const { rows, rowCount } = await pool.query<WorkflowRow>(
      `SELECT ${WORKFLOW_COLS} FROM workflows WHERE id = $1`,
      [id],
    );
    if (rowCount === 0) {
      res.status(404).json({ error: "Workflow not found" });
      return;
    }

    const row = rows[0]!;
    const flowGraph: FlowGraph | null = row.flow_graph;
    if (!flowGraph) {
      res.status(422).json({ error: "Workflow has no flow graph" });
      return;
    }

    const node = flowGraph.nodes.find((n) => n.id === nodeId);
    if (!node) {
      res.status(404).json({ error: `Node "${nodeId}" not found in flow graph` });
      return;
    }
    if (node.type === "trigger") {
      res.status(422).json({ error: "Trigger nodes do not have editable code" });
      return;
    }

    const syntax = validateStepCode(code, node.type as "action" | "condition");
    if (!syntax.valid) {
      res.status(422).json({
        error: `Syntax error: ${syntax.message}`,
        line: syntax.line,
        column: syntax.column,
      });
      return;
    }

    const unknownMethods = findUnknownToolCalls(code);
    if (unknownMethods.length > 0) {
      res.status(422).json({
        error: `Code references unknown tools: ${unknownMethods.map((m) => `tools.${m}`).join(", ")}`,
      });
      return;
    }

    node.code = code;
    const composedCode = composeWorkflowCode(flowGraph);
    const flowGraphJson = JSON.stringify(flowGraph);

    const { rows: updated } = await pool.query<WorkflowRow>(
      `UPDATE workflows
       SET flow_graph = $2, generated_code = $3, updated_at = CURRENT_TIMESTAMP
       WHERE id = $1
       RETURNING ${WORKFLOW_COLS}`,
      [id, flowGraphJson, composedCode],
    );

    res.json(workflowToJson(updated[0]!));
  });

  r.post("/:id/run-test", async (req: Request, res: Response) => {
    const id = req.params.id as string | undefined;
    if (!id || !isUuid(id)) {
      res.status(400).json({ error: "Invalid workflow id" });
      return;
    }

    const { rows, rowCount } = await pool.query<WorkflowRow>(
      `SELECT generated_code, trigger_events FROM workflows WHERE id = $1`,
      [id],
    );
    if (rowCount === 0) {
      res.status(404).json({ error: "Workflow not found" });
      return;
    }

    const parsed = WorkflowEventSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        error: "Invalid event payload",
        details: parsed.error.issues,
      });
      return;
    }

    const event = parsed.data as WorkflowEvent;
    const workflow = rows[0]!;

    if (!workflow.trigger_events.includes(event.triggerType)) {
      res.status(400).json({
        error: `Workflow does not subscribe to trigger "${event.triggerType}". Subscribed: ${workflow.trigger_events.join(", ")}`,
      });
      return;
    }

    try {
      const result = await runWorkflowInSandbox(
        workflow.generated_code,
        event,
      );
      res.json(result);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Sandbox execution failed";
      console.error("Workflow run-test error:", err);
      res.status(502).json({ error: message });
    }
  });

  return r;
}
