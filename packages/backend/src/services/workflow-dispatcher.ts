import { makeWorkerUtils, type WorkerUtils } from "graphile-worker";
import { pool } from "../db.js";
import type { FlowGraph, TriggerType, WorkflowEvent } from "../workflow-sdk.js";
import { runWorkflowInSandbox } from "./workflow-e2b-runner.js";

const connectionString =
  process.env.DATABASE_URL ??
  "postgresql://postgres:password@localhost:5432/workflows";

let _workerUtils: WorkerUtils | null = null;
async function getWorkerUtils(): Promise<WorkerUtils> {
  if (!_workerUtils) {
    _workerUtils = await makeWorkerUtils({ connectionString });
  }
  return _workerUtils;
}

interface WorkflowMatch {
  id: string;
  name: string;
  generated_code: string;
  flow_graph: FlowGraph | null;
}

function hasDelayNodes(flowGraph: FlowGraph | null): boolean {
  if (!flowGraph) return false;
  return flowGraph.nodes.some((n) => n.type === "delay");
}

/**
 * Find active workflows subscribed to `triggerType` and execute each one.
 *
 * Workflows without delay nodes use the fast path (single E2B sandbox).
 * Workflows WITH delay nodes are routed through the segment executor
 * (graphile-worker) for durable, pausable execution.
 */
export async function dispatchTrigger(
  triggerType: TriggerType,
  event: WorkflowEvent,
): Promise<void> {
  const { rows } = await pool.query<WorkflowMatch>(
    `SELECT id, name, generated_code, flow_graph
       FROM workflows
      WHERE is_active = true
        AND trigger_events @> $1`,
    [`{${triggerType}}`],
  );

  if (rows.length === 0) {
    console.log(`[dispatch] ${triggerType}: no matching workflows`);
    return;
  }

  console.log(
    `[dispatch] ${triggerType}: running ${rows.length} workflow(s) — ${rows.map((w) => w.name).join(", ")}`,
  );

  const results = await Promise.allSettled(
    rows.map(async (w) => {
      if (hasDelayNodes(w.flow_graph)) {
        return dispatchDurable(w.id, w.name, event);
      }
      return dispatchImmediate(w, event);
    }),
  );

  for (let i = 0; i < results.length; i++) {
    const r = results[i]!;
    const w = rows[i]!;
    if (r.status === "rejected") {
      console.error(
        `[dispatch] workflow "${w.name}" (${w.id}) failed:`,
        r.reason,
      );
    }
  }
}

async function dispatchImmediate(
  w: WorkflowMatch,
  event: WorkflowEvent,
): Promise<void> {
  const result = await runWorkflowInSandbox(w.generated_code, event);
  console.log(
    `[dispatch] workflow "${w.name}" (${w.id}) exited ${result.exitCode}`,
  );
}

async function dispatchDurable(
  workflowId: string,
  workflowName: string,
  event: WorkflowEvent,
): Promise<void> {
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO workflow_runs (workflow_id, event)
     VALUES ($1, $2)
     RETURNING id`,
    [workflowId, JSON.stringify(event)],
  );

  const runId = rows[0]!.id;
  const utils = await getWorkerUtils();
  await utils.addJob("execute_workflow_segment", { runId });

  console.log(
    `[dispatch] workflow "${workflowName}" (${workflowId}) → durable run ${runId}`,
  );
}
