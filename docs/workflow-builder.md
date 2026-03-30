# Workflow Builder (Agentic Builder)

This document describes the **workflow builder** feature: an LLM-powered generation pipeline where a user's natural language prompt is translated into deterministic, sandboxed JavaScript that reacts to application events.

Use this file for product and technical context when changing the builder UI, generation service, SDK contracts, or workflow execution.

## Core philosophy

- **Broad trigger + smart code.** We use broad domain events (`onSessionClosed`, `onSessionOpened`) and rely on the AI to generate condition-checking logic inside the code, rather than creating highly specific database triggers.
- **SDK nouns over DB access.** The AI never has direct database access. It calls strongly typed, generic API wrappers (`tools.getSessions`, `tools.getMessages`) from inside a sandbox.
- **Context-aware iteration.** The LLM always receives the current state of an existing workflow before generating the next iteration, so the user can refine rather than start from scratch.

## Two lifecycles

1. **Creation** (this feature): a user prompt + the SDK types go into an LLM, which outputs structured JSON containing trigger events and executable JavaScript.
2. **Execution** (Phase 3): application events fire, matching workflows are looked up, and the generated code runs inside an **[E2B](https://e2b.dev/)** cloud sandbox (Hobby tier for this prototype). A **trusted harness** (our code) invokes the LLM’s `run(event, tools)` and supplies the `tools` object; E2B only provides the isolated runtime.

## Architecture overview

```
User prompt
    │
    ▼
┌──────────────────────────┐
│  POST /api/workflows/    │
│       generate           │
│  (workflows router)      │
└─────────┬────────────────┘
          │ fetch existing workflow state (if workflowId provided)
          │ pass prompt + SDK source + existing code to LLM
          ▼
┌──────────────────────────┐
│  LLM Generation Service  │
│  (llm-generation.ts)     │
│  - builds system prompt  │
│  - injects workflow-sdk  │
│    raw text as "compiler │
│    instructions"         │
│  - calls OpenAI gpt-4o   │
│  - validates response    │
│    with Zod              │
└─────────┬────────────────┘
          │ { trigger_events, flow: { nodes (with per-node code), edges } }
          ▼
┌──────────────────────────┐
│  Composition Engine      │
│  composeWorkflowCode()   │
│  (derives generated_code │
│   from per-node code)    │
└─────────┬────────────────┘
          │ flow_graph + composed generated_code
          ▼
┌──────────────────────────┐
│  Postgres (workflows)    │
│  INSERT or UPDATE row    │
│  (flow_graph JSONB col)  │
└─────────┬────────────────┘
          │ full workflow record
          ▼
┌──────────────────────────┐
│  Builder UI              │
│  React Flow canvas +     │
│  chat bar + info panel   │
└──────────────────────────┘
```

## The WorkflowEvent

The **host application** (Node.js backend) creates the event payload. The AI does not invent or modify the event structure.

A `WorkflowEvent` is a fixed, standardized snapshot of data representing what just happened in the app. The AI-generated code receives it as a read-only argument and writes conditional logic against its properties.

Current event types:

| Event | Key properties |
|-------|----------------|
| `SessionClosedEvent` | `triggerType`, `sessionId`, `customerName`, `customerEmail`, `sentiment`, `createdAt` |
| `SessionOpenedEvent` | `triggerType`, `sessionId`, `customerName`, `customerEmail`, `createdAt` |

The `triggerType` field is the discriminant for the union type `WorkflowEvent`.

## The WorkflowTools (SDK)

The generated code may **only** call functions from the `tools` object passed as the second argument to `run`. In the LLM prompt we call this “injected” because, at runtime, **our harness** must build that object and pass it in—**E2B does not magically provide `WorkflowTools`.**

### Execution runtime (E2B) and how `tools` actually work

**What E2B does:** Runs arbitrary processes (e.g. **Node**) in an isolated Linux environment. Your backend creates a sandbox (via the E2B SDK), writes files into it (harness + generated `workflow.mjs`), and runs something like `node workflow-harness.mjs`.

**What E2B does *not* do:** It does not know about `sendSlackChannelMessage`, Postgres, or your SDK. There is no special “register tools with E2B” API for this use case.

**Where `tools` come from:** Only from **trusted code** that ships with your app—the **workflow harness** (same idea as before, only the isolation provider is E2B instead of a self-hosted agent). The harness:

1. Parses the real `WorkflowEvent` (e.g. from env or stdin).
2. Constructs a plain JavaScript object `tools` whose methods implement the `WorkflowTools` contract.
3. Dynamically loads the LLM-generated module and calls `await defaultExport(event, tools)`.

**Milestone (current direction):** Implement `sendEmail`, `sendSlackChannelMessage`, `getSessions`, and `getMessages` **inside the harness** as stubs (e.g. `console.log` for actions, fixed mock arrays for data). No host round-trip yet—cheap to run and enough to prove execution in E2B.

**Later increment (real integrations):** Keep the **same** generated code shape (`tools.sendSlackChannelMessage(...)`). Change **only the harness implementations**: e.g. `sendSlackChannelMessage` uses `fetch` (or the E2B SDK) to call a **small, authenticated HTTP API on your backend** that performs Slack/email/DB with your secrets. The **generated** workflow code still must **not** use `fetch` (per LLM constraints); only **trusted** harness code performs network I/O on its behalf. That preserves the security story: user code never holds API keys or raw DB access.

### Data tools (generic query pattern)

Both data tools accept the same `QueryOptions` shape, making the pattern scalable to future nouns without new filter types:

```typescript
interface WhereCondition {
  field: string;
  op: 'eq' | 'neq' | 'in' | 'gt' | 'lt' | 'gte' | 'lte' | 'like';
  value: unknown;
}

interface QueryOptions {
  where?: WhereCondition[];
  limit?: number;
  orderBy?: { field: string; direction?: 'asc' | 'desc' };
}
```

| Tool | Returns | Queryable fields |
|------|---------|------------------|
| `tools.getSessions(options?)` | `SessionResult[]` | `id`, `customerName`, `customerEmail`, `status`, `sentiment`, `createdAt`, `updatedAt` |
| `tools.getMessages(options?)` | `MessageResult[]` | `id`, `sessionId`, `authorRole`, `body`, `createdAt` |

### Action tools

| Tool | Purpose |
|------|---------|
| `tools.sendEmail(to, subject, body)` | Send an email alert |
| `tools.sendSlackChannelMessage(channel, message)` | Post to a Slack channel |

### Adding a new noun

1. Define a result interface in `workflow-sdk.ts` (e.g. `TicketResult`).
2. Register the table + field whitelist in `query-builder.ts`.
3. Add the function to the `WorkflowTools` interface.
4. Implement it in `mock-tools.ts` for local/dev use, and implement the same surface on the **E2B harness** `tools` object for sandboxed execution (stubs first, then host-backed HTTP).

## Generated code contract

### Step-code architecture (per-node code)

The LLM no longer generates a monolithic `run()` function. Instead, each non-trigger node in the flow graph carries its own `code` field:

- **Trigger nodes:** No `code` — they represent event subscriptions.
- **Action nodes:** `code` is the step body (tool calls, data preparation, context assignments).
- **Condition nodes:** `code` is a boolean expression (e.g. `event.sentiment === 'angry'`).
- **Delay nodes:** `code` is a duration string (e.g. `"5m"`, `"1h"`, `"30s"`, `"1d"`). The runtime durably pauses execution for that duration using graphile-worker job scheduling.

The per-node code fields in `flow_graph` are the **source of truth**. The `generated_code` column is a **derived artifact** produced deterministically by the composition engine (`composeWorkflowCode()`).

### Inter-step data flow: the `context` convention

Steps share data via a `context` object provided by the runtime:
- To pass data to a later step: `context.messages = await tools.getMessages(...);`
- To read data from an earlier step: `context.messages`
- Local variables (`const`/`let`) within a step stay scoped to that step's IIFE.
- `event`, `tools`, and `context` are available in every step.

### Composition engine

`packages/backend/src/services/compose-workflow-code.ts`

A pure, deterministic function `composeWorkflowCode(flowGraph: FlowGraph): string` that:
1. Topologically sorts nodes using Kahn's algorithm.
2. Skips trigger nodes (no executable code).
3. Wraps each action node's code in `await (async () => { ... })();` with a comment header.
4. For condition nodes, emits `if (<code>) { ... } else { ... }` using "Yes"/"No" edge labels.
5. For delay nodes, emits `await new Promise(r => setTimeout(r, <ms>));` (for test/preview — real execution uses graphile-worker).
6. Wraps everything in `export default async function run(event, tools) { const context = {}; ... }`.

This function is called:
- After LLM generation (in `POST /generate`)
- After user edits a node's code (in `PATCH /api/workflows/:id/nodes/:nodeId/code`)

### Composed output example

```javascript
export default async function run(event, tools) {
  const context = {};

  // Step: action-1 — Fetch last 3 messages
  await (async () => {
    context.messages = await tools.getMessages({
      where: [{ field: 'sessionId', op: 'eq', value: event.sessionId }],
      orderBy: { field: 'createdAt', direction: 'desc' },
      limit: 3
    });
  })();

  // Step: action-2 — Send Slack message
  await (async () => {
    const body = context.messages
      .map(m => `${m.authorRole}: ${m.body}`).join('\n');
    await tools.sendSlackChannelMessage('workflows',
      `Session opened for ${event.customerName}.\nLast 3 messages:\n${body}`
    );
  })();
}
```

### Per-step code constraints

Enforced via the system prompt (for step code only):
- No `require()`, `import`, `fetch()`, `eval()`, `Function()`, `setTimeout`/`setInterval`.
- No access to `process`, `Buffer`, `__dirname`, `__filename`, or `window`.
- Must not declare variables named `event`, `tools`, or `context`.
- Must not include the `export default async function run` wrapper.

The **harness** is not generated by the LLM; it may use Node APIs and (when you add it) `fetch` to reach your backend for real tool implementations.

## Flow graph (visual representation)

Alongside the executable code, the LLM also generates a **flow graph descriptor** (`flow`) that describes the workflow's logical structure as a directed acyclic graph. This graph is rendered on the frontend using **[React Flow](https://reactflow.dev/)** with automatic layout via **dagre**.

### Flow graph shape

```typescript
interface FlowNodeDescriptor {
  id: string;
  type: "trigger" | "condition" | "action" | "delay";
  label: string;
  code?: string;           // per-step code (action/condition/delay); absent for triggers
  metadata?: Record<string, unknown>;
}

interface FlowEdgeDescriptor {
  source: string;
  target: string;
  label?: string; // e.g. "Yes", "No"
}

interface FlowGraph {
  nodes: FlowNodeDescriptor[];
  edges: FlowEdgeDescriptor[];
}
```

### Node types

| Type | Purpose | Visual style |
|------|---------|-------------|
| `trigger` | Entry point for a subscribed event | Green border, lightning icon |
| `condition` | Branching decision (if/else on event or query data) | Amber border, branch icon |
| `action` | Tool call or side effect | Blue border, play icon |
| `delay` | Durable pause for a specified duration | Violet border, clock icon |

### Storage and generation

- The flow graph (with per-node `code` fields) is stored in `workflows.flow_graph` (`JSONB`, nullable for backward compatibility).
- Per-node code fields are the **source of truth**; `generated_code` is derived by `composeWorkflowCode()`.
- The LLM system prompt instructs the model to generate `flow` with per-node step code inside the `"ok"` response alongside `trigger_events`.
- On update, the existing flow graph (with step code) is passed back to the LLM so it can maintain consistency.
- The Zod schema validates that every non-trigger node has a non-empty `code` field.
- A post-parse guard runs `findUnknownToolCalls()` on each node's code individually.

## Trigger system

A workflow can subscribe to **multiple** broad triggers via the `trigger_events` column (`TEXT[]` with a GIN index). When an event fires (Phase 3), the dispatch query will be:

```sql
SELECT * FROM workflows
WHERE trigger_events @> ARRAY['onSessionClosed']
  AND is_active = true;
```

This finds every active workflow whose trigger list contains the fired event.

## Data model

Defined in `docker/postgres/init/01-schema.sql` + `03-flow-graph.sql`:

| Column | Type | Notes |
|--------|------|-------|
| `id` | UUID | PK, auto-generated |
| `name` | VARCHAR(255) | Derived from the first prompt (first ~80 chars) |
| `trigger_events` | TEXT[] | Array of trigger names, e.g. `{onSessionClosed,onSessionOpened}` |
| `original_prompt` | TEXT | The latest prompt used for generation |
| `generated_code` | TEXT | The LLM-generated JavaScript |
| `flow_graph` | JSONB | Visual node/edge graph for the React Flow canvas (nullable for backward compat) |
| `is_active` | BOOLEAN | Default `true` |
| `created_at` | TIMESTAMPTZ | |
| `updated_at` | TIMESTAMPTZ | |

Index: `idx_workflows_trigger_events` GIN on `trigger_events` where `is_active = true`.

## REST API

Base path: **`/api/workflows`** (JSON). Backend: `packages/backend/src/routes/workflows.ts`.

| Method | Path | Body | Notes |
|--------|------|------|-------|
| `GET` | `/api/workflows` | -- | List all workflows, newest first |
| `GET` | `/api/workflows/:id` | -- | Full workflow record including `generatedCode` |
| `POST` | `/api/workflows/generate` | `{ prompt, workflowId? }` | Generate new or refine existing workflow. Returns `422` with `{ error, unsupportedCapabilities }` if the prompt requires triggers or tools that do not exist in the SDK. |
| `PATCH` | `/api/workflows/:id/nodes/:nodeId/code` | `{ code: string }` | Update a single node's step code in the flow graph. Recomposes `generated_code`. Returns `422` if unknown tools are referenced or node is a trigger. |
| `PATCH` | `/api/workflows/:id/nodes/:nodeId/label` | `{ label: string }` | Rename a node's label in the flow graph. Recomposes `generated_code` (step comments update). |
| `POST` | `/api/workflows/:id/run-test` | `WorkflowEvent` (JSON) | Execute workflow in E2B sandbox with a sample event. Returns `{ exitCode, stdout, stderr }`. |

### POST /generate flow

1. Validate `prompt` (required, non-empty string).
2. If `workflowId` provided, fetch existing `trigger_events`, `generated_code`, and `flow_graph` from DB (404 if not found).
3. Build system prompt: role/constraints + raw `workflow-sdk.ts` source + optional existing state (including flow graph). The prompt explicitly lists allowed triggers (`VALID_TRIGGERS`) and tool methods (`VALID_TOOL_METHODS`) and instructs the LLM to return a `status: "rejected"` response for unsupported capabilities instead of inventing triggers or tools.
4. Call OpenAI `gpt-4o` with `response_format: json_object`, temperature `0.2`.
5. Parse LLM output with a Zod discriminated union on `status`:
   - `"ok"` — `trigger_events: string[]`, `flow: FlowGraph` (with per-node `code` fields). A Zod refinement validates non-trigger nodes have non-empty `code`. A post-parse guard scans each node's `code` for `tools.<method>` calls not in `VALID_TOOL_METHODS` (defense against hallucinations).
   - `"rejected"` — `reason: string`, optional `unsupported: string[]`.
6. If rejected (by LLM or by post-parse guard): return `422` with `{ error: string, unsupportedCapabilities: string[] }`. No DB write.
7. Call `composeWorkflowCode(flow)` to produce the derived `generated_code` string.
8. INSERT (new) or UPDATE (existing) the `workflows` row, persisting both `flow_graph` (with per-node code) and `generated_code` (composed).
9. Return the full workflow record (includes `flowGraph` and `generatedCode`).

On generation error, returns `502` with `{ error: string }`.

### POST /:id/run-test flow

1. Validate `id` (UUID) and load the workflow from DB (404 if not found).
2. Validate body with a Zod discriminated union matching `WorkflowEvent` (`triggerType` is the discriminant).
3. Verify the workflow subscribes to the event's `triggerType` (400 if not).
4. Call `runWorkflowInSandbox(generatedCode, event)` — creates an E2B sandbox, writes the harness + workflow file, runs `node`, returns stdout/stderr/exit code.
5. Return `{ exitCode, stdout, stderr }` (200), or `502` on sandbox error.

## LLM generation service

`packages/backend/src/services/llm-generation.ts`

- Reads `workflow-sdk.ts` as raw text at module load and injects it into every system prompt.
- OpenAI client is lazily initialized (backend starts fine without a valid API key; errors surface only on generation).
- System prompt switches between "create" and "update" mode based on whether existing state is provided.
- In update mode, the LLM is told to preserve existing logic unless the user explicitly asks to change it, and receives the current flow graph alongside the code.
- The system prompt enumerates the exact allowed triggers and tool methods. If the user's request requires anything else, the LLM must return `{ "status": "rejected", "reason": "...", "unsupported": [...] }` instead of generating code.
- The system prompt includes detailed instructions for the `flow` graph: node types (`trigger`, `condition`, `action`), edge semantics, ID conventions, and the requirement that the graph mirrors the code's logical structure.

## Query builder

`packages/backend/src/services/query-builder.ts`

A generic engine that converts `QueryOptions` into parameterized SQL:
- Validates fields against a per-resource whitelist (security boundary).
- Maps camelCase SDK field names to snake_case DB columns.
- Builds `WHERE` clauses with parameterized values (`$1`, `$2`, ...).
- Handles `in` operator via Postgres `= ANY($n)`.
- Currently used by mock tools; will be used by real host-backed tools when the E2B harness calls into the API (or equivalent) for production data access.

## Mock tools

`packages/backend/src/services/mock-tools.ts`

- `createMockTools()` returns a fresh `WorkflowTools` object per invocation.
- Data tools log the received `QueryOptions` to console and return static mock data.
- Action tools log `[MOCK]` messages.
- Parallels the **stub** `tools` implementations in the E2B workflow harness until real host-backed tools exist.

## Frontend

### Layout

| Area | Location |
|------|----------|
| Workflows list page | `packages/frontend/src/pages/workflows-list-page.tsx` |
| Builder page | `packages/frontend/src/pages/workflow-builder-page.tsx` |
| React Flow canvas | `packages/frontend/src/components/workflow/canvas/workflow-canvas.tsx` |
| Custom nodes | `packages/frontend/src/components/workflow/canvas/nodes/{trigger,condition,action}-node.tsx` |
| Auto-layout hook | `packages/frontend/src/components/workflow/canvas/use-auto-layout.ts` |
| Chat bar | `packages/frontend/src/components/workflow/chat-bar.tsx` |
| Side panel (tabbed, CodeMirror) | `packages/frontend/src/components/workflow/side-panel.tsx` |
| Code viewer (shiki) | `packages/frontend/src/components/workflow/code-viewer.tsx` |
| Prompt panel (legacy) | `packages/frontend/src/components/workflow/prompt-panel.tsx` |
| Run test panel | `packages/frontend/src/components/workflow/run-test-panel.tsx` |
| API client | `packages/frontend/src/api/workflows.ts` |
| DTO types | `packages/frontend/src/types/workflow.ts` |
| Routes | `packages/frontend/src/App.tsx` |

### Routes

| Path | Component | Mode |
|------|-----------|------|
| `/workflows` | `WorkflowsListPage` | List all workflows |
| `/workflows/new` | `WorkflowBuilderPage` | Create mode (empty state) |
| `/workflows/:id` | `WorkflowBuilderPage` | Edit mode (loads existing) |

### Builder UI

Three-zone layout: **React Flow canvas** (main area with floating chat bar), **node code panel** (right sidebar).

```
+-------------------------------------------+--------------+
|                                            |              |
|          React Flow Canvas                 |   Node Code  |
|          (trigger/condition/action nodes)  |   Panel      |
|          [click to select]                 |  (CodeMirror) |
|                                            |              |
+-------------------------------------------+              |
|  Chat bar (history + input)                |              |
+-------------------------------------------+--------------+
```

- **Canvas:** Renders the `flowGraph` from the workflow record using `@xyflow/react`. Node positions are computed automatically by **dagre** (top-to-bottom). Three custom node types: trigger (green), condition (amber), action (blue). Nodes are selectable — clicking highlights the node and populates the code panel.
- **Chat bar:** Bottom input area with scrollable message history. Replaces the legacy full-height prompt panel. Enter submits, Shift+Enter for newlines.
- **Side panel:** Right sidebar (hidden on small screens) with two tabs that adapt to selection context. **No selection:** "Workflow" tab shows name (editable), triggers, status; "Code" tab shows the full composed `generatedCode` read-only. **Node selected:** "Details" tab shows node label (editable via `PATCH /:id/nodes/:nodeId/label`), type, and ID; "Code" tab shows the node's step code in a CodeMirror 6 editor with syntax linting and a Save button.
- **Create mode:** empty canvas with placeholder text, first prompt creates the workflow. After generation, the URL is replaced with `/workflows/:id` for subsequent refinements.
- **Edit mode:** fetches existing workflow on mount, populates canvas from `flowGraph`, user continues refining.
- **Prompt history:** ephemeral React state (not persisted to DB). Shows previous prompts as chat-like bubbles.
- **Loading state:** translucent overlay on the canvas + "Generating workflow..." in the chat bar.
- **Error state:** red banner between canvas and chat bar if generation fails, or full-page error if the workflow can't be loaded.

### Legacy components (kept, not actively used in builder)

- **Code viewer:** `shiki`-powered syntax highlighter. Superseded by the per-node CodeMirror editor in the node code panel but kept for reference.
- **Prompt panel:** Original full-height prompt panel. Superseded by `ChatBar` but kept for reference.

## Environment

| Variable | Required | Purpose |
|----------|----------|---------|
| `OPENAI_API_KEY` | Yes (for generation) | OpenAI API key. Backend starts without it but generation calls will fail. |
| `E2B_API_KEY` | When executing workflows in E2B | API key from [e2b.dev](https://e2b.dev/) (Hobby includes credits). Used by the backend to spawn sandboxes and run the harness + generated code. |
| `RESEND_API_KEY` | For real `sendEmail` | API key from [resend.com](https://resend.com/). Forwarded into the E2B sandbox so the harness can call the Resend REST API. Falls back to a console.log stub when absent. |
| `RESEND_FROM_EMAIL` | No (default: `onboarding@resend.dev`) | Sender address for emails. Defaults to Resend's built-in test sender. |
| `SLACK_BOT_TOKEN` | For real `sendSlackChannelMessage` | Bot User OAuth Token (`xoxb-...`) from [api.slack.com/apps](https://api.slack.com/apps). Forwarded into the E2B sandbox so the harness can call `chat.postMessage`. Falls back to a console.log stub when absent. The bot must have the `chat:write` scope and be invited to the target channel. |
| `WORKFLOW_TOOLS_BASE_URL` | For real `getSessions` / `getMessages` | Publicly reachable URL of the Express backend. E2B sandboxes cannot reach `localhost`; use a tunnel (e.g. `ngrok http 3001` or `cloudflared tunnel`) or a deployed URL. The harness calls `POST /api/internal/workflow-tools/query` on this host. Without it, data tools return mock arrays. |
| `WORKFLOW_TOOLS_SECRET` | For real `getSessions` / `getMessages` | Shared bearer-token secret that authenticates harness-to-host data queries. Generate with e.g. `openssl rand -hex 32`. |

The backend loads `.env` via `--env-file=.env` in the `tsx` dev/start scripts.

## Durable delay execution

Workflows that contain **delay nodes** use a segment-based execution model instead of a single E2B sandbox call:

1. **`dispatchTrigger()`** checks whether the workflow's flow graph contains any delay nodes.
2. If no delays, the existing fast path applies (compose full code → single E2B call).
3. If delays are present, a `workflow_runs` row is inserted and a `execute_workflow_segment` **graphile-worker** job is enqueued.
4. The **segment executor** (`workflow-segment-executor.ts`) walks the graph node-by-node on the host:
   - **Trigger nodes** are skipped.
   - **Action nodes** execute in E2B via `runStepInSandbox()` (per-step harness).
   - **Condition nodes** are evaluated on the host.
   - **Delay nodes** persist current state to `workflow_runs` and schedule a future job with `runAt = now + delay`.
5. When the delayed job fires, the executor resumes from the saved `resume_from` node.
6. The test endpoint (`POST /:id/run-test`) still uses the composed code with `setTimeout`-based delays for instant feedback.

### `workflow_runs` table

Tracks durable execution state. Schema: `docker/postgres/init/04-workflow-runs.sql`.

| Column | Purpose |
|--------|---------|
| `resume_from` | Node ID to resume from after a delay (null = start from roots) |
| `visited` | Array of already-executed node IDs |
| `context` | Accumulated shared context object (JSONB) |
| `status` | `running` / `delayed` / `completed` / `failed` |

### graphile-worker setup

graphile-worker is started alongside Express in `packages/backend/src/index.ts`. It auto-migrates its schema on first `run()`. The task list is defined in `workflow-segment-executor.ts`.

## What's not wired up yet (Phase 3)

- **Prompt history persistence:** prompt log is ephemeral. Could add a `prompt_history JSONB` column if needed.
- **User-draggable node positions:** Persist manual node repositioning alongside the auto-laid-out flow graph.
- **AST validation:** Post-generation check that the flow graph nodes match the actual code structure (defense against flow/code desync).
- **Add code review step to ensure nothing malicious or expensive is running**
- **Run-test in code panel:** Add a "Test" button in the node code panel to run the workflow in E2B with a sample event.
- **Condition node sandboxing:** Currently evaluates AI-generated condition code on the host via `new Function()`. For production, move to E2B or a constrained expression evaluator.
