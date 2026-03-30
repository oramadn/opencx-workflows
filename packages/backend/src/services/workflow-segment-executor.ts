import type { JobHelpers, TaskList } from "graphile-worker";
import { pool } from "../db.js";
import type { FlowEdgeDescriptor, FlowGraph, FlowNodeDescriptor, WorkflowEvent } from "../workflow-sdk.js";
import { parseDuration } from "./parse-duration.js";
import { runStepInSandbox } from "./workflow-e2b-runner.js";

// ---------------------------------------------------------------------------
// graphile-worker task list — imported by server boot
// ---------------------------------------------------------------------------

export const segmentTaskList: TaskList = {
  execute_workflow_segment: async (payload, helpers) => {
    const { runId } = payload as { runId: string };
    await executeSegment(runId, helpers);
  },
};

// ---------------------------------------------------------------------------
// Workflow run DB helpers
// ---------------------------------------------------------------------------

interface WorkflowRunRow {
  id: string;
  workflow_id: string;
  event: WorkflowEvent;
  context: Record<string, unknown>;
  resume_from: string | null;
  visited: string[];
  status: string;
}

interface WorkflowRow {
  flow_graph: FlowGraph;
}

async function loadRun(runId: string): Promise<WorkflowRunRow> {
  const { rows } = await pool.query<WorkflowRunRow>(
    `SELECT id, workflow_id, event, context, resume_from, visited, status
       FROM workflow_runs WHERE id = $1`,
    [runId],
  );
  if (rows.length === 0) throw new Error(`workflow_run ${runId} not found`);
  return rows[0]!;
}

async function loadFlowGraph(workflowId: string): Promise<FlowGraph> {
  const { rows } = await pool.query<WorkflowRow>(
    `SELECT flow_graph FROM workflows WHERE id = $1`,
    [workflowId],
  );
  if (rows.length === 0) throw new Error(`workflow ${workflowId} not found`);
  if (!rows[0]!.flow_graph) throw new Error(`workflow ${workflowId} has no flow_graph`);
  return rows[0]!.flow_graph;
}

async function updateRun(
  runId: string,
  fields: {
    context?: Record<string, unknown>;
    resume_from?: string | null;
    visited?: string[];
    status?: string;
    error?: string | null;
  },
): Promise<void> {
  const sets: string[] = ["updated_at = now()"];
  const vals: unknown[] = [];
  let idx = 1;

  if (fields.context !== undefined) {
    sets.push(`context = $${idx++}`);
    vals.push(JSON.stringify(fields.context));
  }
  if (fields.resume_from !== undefined) {
    sets.push(`resume_from = $${idx++}`);
    vals.push(fields.resume_from);
  }
  if (fields.visited !== undefined) {
    sets.push(`visited = $${idx++}`);
    vals.push(fields.visited);
  }
  if (fields.status !== undefined) {
    sets.push(`status = $${idx++}`);
    vals.push(fields.status);
  }
  if (fields.error !== undefined) {
    sets.push(`error = $${idx++}`);
    vals.push(fields.error);
  }

  vals.push(runId);
  await pool.query(
    `UPDATE workflow_runs SET ${sets.join(", ")} WHERE id = $${idx}`,
    vals,
  );
}

// ---------------------------------------------------------------------------
// Graph utilities (mirrors compose-workflow-code.ts helpers)
// ---------------------------------------------------------------------------

type AdjList = Map<string, { target: string; label?: string }[]>;

function buildAdjacencyList(edges: FlowEdgeDescriptor[]): AdjList {
  const adj: AdjList = new Map();
  for (const e of edges) {
    let list = adj.get(e.source);
    if (!list) {
      list = [];
      adj.set(e.source, list);
    }
    list.push({ target: e.target, label: e.label });
  }
  return adj;
}

function findRoots(nodes: FlowNodeDescriptor[], edges: FlowEdgeDescriptor[]): string[] {
  const targets = new Set(edges.map((e) => e.target));
  return nodes.filter((n) => !targets.has(n.id)).map((n) => n.id);
}

// ---------------------------------------------------------------------------
// Segment executor — the host-side graph walker
// ---------------------------------------------------------------------------

/**
 * Walk the flow graph for a single workflow run.  Executes action nodes in
 * E2B, evaluates conditions on the host, and suspends at delay nodes by
 * scheduling a future graphile-worker job.
 */
async function executeSegment(
  runId: string,
  helpers: JobHelpers,
): Promise<void> {
  const run = await loadRun(runId);
  if (run.status !== "running" && run.status !== "delayed") {
    helpers.logger.info(`run ${runId} status=${run.status}, skipping`);
    return;
  }

  await updateRun(runId, { status: "running" });

  const flowGraph = await loadFlowGraph(run.workflow_id);
  const nodeMap = new Map<string, FlowNodeDescriptor>();
  for (const n of flowGraph.nodes) nodeMap.set(n.id, n);
  const childrenOf = buildAdjacencyList(flowGraph.edges);

  const visited = new Set(run.visited);
  const context = { ...run.context };
  const event = run.event;

  // If resuming after a delay, start from the resume node.
  // Otherwise start from graph roots.
  const startNodes = run.resume_from
    ? [run.resume_from]
    : findRoots(flowGraph.nodes, flowGraph.edges);

  // A delay suspension sets this to signal we should stop walking.
  let suspended = false;

  async function walkNode(nodeId: string): Promise<void> {
    if (suspended) return;
    if (visited.has(nodeId)) return;
    visited.add(nodeId);

    const node = nodeMap.get(nodeId);
    if (!node) return;

    const children = childrenOf.get(nodeId) ?? [];

    if (node.type === "trigger") {
      for (const child of children) {
        await walkNode(child.target);
        if (suspended) return;
      }
      return;
    }

    if (node.type === "delay") {
      const delayMs = parseDuration(node.code ?? "0");

      // Persist current state and schedule future resumption.
      // The delay node's children are where we resume.
      const childIds = children.map((c) => c.target);
      // We store the first child as resume_from.  If the delay has multiple
      // children they'll be reached naturally from the resume point via the
      // adjacency list since the delay node itself will be in `visited`.
      await updateRun(runId, {
        context,
        visited: [...visited],
        resume_from: childIds[0] ?? null,
        status: "delayed",
      });

      await helpers.addJob(
        "execute_workflow_segment",
        { runId },
        { runAt: new Date(Date.now() + delayMs) },
      );

      helpers.logger.info(
        `run ${runId} delayed ${node.code} (${delayMs}ms), resume from ${childIds[0] ?? "none"}`,
      );
      suspended = true;
      return;
    }

    if (node.type === "condition") {
      const code = (node.code ?? "true").trim();
      let result: boolean;
      try {
        const fn = new Function("event", "context", `return Boolean(${code})`);
        result = fn(event, context) as boolean;
      } catch (err) {
        helpers.logger.error(`condition eval failed for ${node.id}: ${err}`);
        result = false;
      }

      const branch = result ? "yes" : "no";
      const targets = children.filter(
        (c) => c.label?.toLowerCase() === branch,
      );
      for (const child of targets) {
        await walkNode(child.target);
        if (suspended) return;
      }
      return;
    }

    // action node — execute in E2B
    if (node.type === "action") {
      const stepCode = node.code ?? "";
      helpers.logger.info(`run ${runId} executing action ${node.id}`);

      const result = await runStepInSandbox(stepCode, event, context);

      if (result.exitCode !== 0) {
        throw new Error(
          `action ${node.id} failed (exit ${result.exitCode}): ${result.stderr}`,
        );
      }

      // Merge context updates from the sandbox
      Object.assign(context, result.context);

      for (const child of children) {
        await walkNode(child.target);
        if (suspended) return;
      }
    }
  }

  try {
    for (const startId of startNodes) {
      await walkNode(startId);
      if (suspended) return;
    }

    // Graph fully walked without hitting a delay
    await updateRun(runId, {
      context,
      visited: [...visited],
      resume_from: null,
      status: "completed",
    });
    helpers.logger.info(`run ${runId} completed`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await updateRun(runId, {
      context,
      visited: [...visited],
      status: "failed",
      error: message,
    });
    // Re-throw so graphile-worker can retry
    throw err;
  }
}
