import { pool } from "../db.js";
import type { TriggerType, WorkflowEvent } from "../workflow-sdk.js";
import { runWorkflowInSandbox } from "./workflow-e2b-runner.js";

interface WorkflowMatch {
  id: string;
  name: string;
  generated_code: string;
}

/**
 * Find active workflows subscribed to `triggerType` and execute each one
 * concurrently inside an E2B sandbox.  Best-effort: individual failures are
 * logged but never propagated to the caller.
 */
export async function dispatchTrigger(
  triggerType: TriggerType,
  event: WorkflowEvent,
): Promise<void> {
  const { rows } = await pool.query<WorkflowMatch>(
    `SELECT id, name, generated_code
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
    rows.map((w) => runWorkflowInSandbox(w.generated_code, event)),
  );

  for (let i = 0; i < results.length; i++) {
    const r = results[i]!;
    const w = rows[i]!;
    if (r.status === "fulfilled") {
      console.log(
        `[dispatch] workflow "${w.name}" (${w.id}) exited ${r.value.exitCode}`,
      );
    } else {
      console.error(
        `[dispatch] workflow "${w.name}" (${w.id}) failed:`,
        r.reason,
      );
    }
  }
}
