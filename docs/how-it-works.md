# How the Workflow Builder Works

A plain-language walkthrough of code generation and execution. For the full technical reference, see [workflow-builder.md](workflow-builder.md).

---

## How code is generated

It's **one shot from the LLM, but not as a single blob of code**.

The LLM returns a **flow graph** — a JSON structure with nodes and edges. Each node carries its own code snippet in a `code` field. So for a prompt like *"When an angry session closes, fetch messages and send a Slack alert"*, the LLM returns something like:

```json
{
  "status": "ok",
  "trigger_events": ["onSessionClosed"],
  "flow": {
    "nodes": [
      { "id": "trigger-1", "type": "trigger", "label": "Session Closed" },
      { "id": "condition-1", "type": "condition", "label": "Is angry?", "code": "event.sentiment === 'angry'" },
      { "id": "action-1", "type": "action", "label": "Fetch messages", "code": "context.msgs = await tools.getMessages(...);" },
      { "id": "action-2", "type": "action", "label": "Send Slack", "code": "await tools.sendSlackChannelMessage(...);" }
    ],
    "edges": [
      { "source": "trigger-1", "target": "condition-1" },
      { "source": "condition-1", "target": "action-1", "label": "Yes" },
      { "source": "action-1", "target": "action-2" }
    ]
  }
}
```

The backend then does two things with this:

1. **Saves the flow graph as-is** to `workflows.flow_graph` (JSONB column). This is the **source of truth** — the per-node code snippets live here.
2. **Runs `composeWorkflowCode(flowGraph)`** which walks the graph in topological order and stitches the per-node snippets into a single `run(event, tools)` function. This composed string is saved to `workflows.generated_code` — it's a **derived artifact**, regenerated any time a node changes.

The frontend doesn't break anything down. It receives the flow graph directly and renders each node on the React Flow canvas. When you click a node, the side panel shows that node's `code` field from the graph. When you edit and save, the backend updates that node's code in the flow graph and recomposes the full `generated_code`.

**Summary: the LLM generates per-node code in one call, the backend assembles it into a runnable function, both are stored, and the flow graph is what matters.**

---

## How execution works: no delays vs. delays

### Workflows without delays (fast path)

Everything happens in one shot:

```
Event fires (e.g. session closes)
  │
  ▼
dispatchTrigger("onSessionClosed", event)
  │
  ▼
Query: find all active workflows subscribed to onSessionClosed
  │
  ▼
For each matching workflow:
  │
  ▼
Take the composed generated_code (the full run() function)
  │
  ▼
Spin up an E2B sandbox (ephemeral Linux container, 30s lifetime)
  │  - Write workflow-harness.mjs (our trusted code)
  │  - Write workflow.mjs (the AI-generated composed code)
  │  - Set env vars: WORKFLOW_EVENT_JSON, API keys, etc.
  │
  ▼
Run: node workflow-harness.mjs
  │  - Harness parses the event
  │  - Harness builds the tools object (real Slack/email calls or stubs)
  │  - Harness calls run(event, tools)
  │  - The entire flow executes top to bottom in one go
  │
  ▼
Sandbox returns stdout/stderr/exit code, then dies
```

One sandbox, one execution, done. The composed code runs like a normal async function — conditions are `if` statements, actions are `await` calls, everything sequential.

### Workflows with delays (durable path)

When the flow graph contains a delay node, the composed code can't run in one shot because a single sandbox can't survive a 5-minute pause. So instead of running composed code, the **host walks the graph node-by-node**:

```
Event fires (e.g. session closes)
  │
  ▼
dispatchTrigger("onSessionClosed", event)
  │
  ▼
Detect: this workflow's flow graph has delay nodes
  │
  ▼
INSERT a workflow_runs row:
  { workflow_id, event, context: {}, visited: [], status: "running" }
  │
  ▼
Enqueue graphile-worker job: execute_workflow_segment({ runId })
  │
  ▼
─── Job picks up immediately ───
  │
  ▼
Segment executor loads the run state + flow graph from Postgres
  │
  ▼
Walk the graph starting from trigger node(s):

  trigger-1 → skip (no code), move to children
      │
      ▼
  condition-1 → evaluate "event.sentiment === 'angry'" on the host
      │           result: true → follow "Yes" edge
      ▼
  action-1 → spin up E2B sandbox, run JUST this node's code snippet
      │        with the current event + context
      │        parse updated context from sandbox stdout
      │        merge into local context
      ▼
  delay-1 ("5m") → STOP WALKING
      │
      ▼
  Save state to workflow_runs:
    { context: {...}, visited: [trigger-1, condition-1, action-1, delay-1],
      resume_from: "action-2", status: "delayed" }
      │
      ▼
  Enqueue graphile-worker job:
    execute_workflow_segment({ runId }, { runAt: now + 5 minutes })
      │
      ▼
  ─── Nothing happens for 5 minutes ───
      │
      ▼
  Job fires. Segment executor loads saved state from workflow_runs.
      │
      ▼
  Resume walking from "action-2" (skipping all visited nodes):

  action-2 → spin up E2B sandbox, run this node's code with saved context
      │
      ▼
  No more nodes → update workflow_runs: status = "completed"
```

### Key differences at a glance

| | No delays | With delays |
|---|---|---|
| **What runs in E2B** | The entire composed `run()` function, one sandbox | Individual action nodes, one sandbox per action |
| **Who orchestrates** | The sandbox runs everything sequentially | The host walks the graph, calling E2B for each action |
| **State persistence** | None needed — one shot | `workflow_runs` table saves context, visited nodes, resume point |
| **How delays work** | N/A | Host saves progress, graphile-worker schedules a future job, executor resumes |
| **Sandbox count** | 1 per workflow | 1 per action node (spread across time) |
| **Test endpoint** | Same — runs composed code with `setTimeout` for delays (instant, not durable) | Same |

The test endpoint (`POST /:id/run-test`) always uses the fast path regardless — delays become `setTimeout` in the composed code so you get instant feedback without waiting.
