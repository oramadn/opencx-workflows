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
          │ { trigger_events: string[], code: string }
          ▼
┌──────────────────────────┐
│  Postgres (workflows)    │
│  INSERT or UPDATE row    │
└─────────┬────────────────┘
          │ full workflow record
          ▼
┌──────────────────────────┐
│  Builder UI              │
│  (split-pane: prompt     │
│   panel + code viewer)   │
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

The LLM is instructed to produce code matching this exact signature:

```javascript
export default async function run(event, tools) {
  // condition-checking + tool calls
}
```

Constraints enforced via the system prompt (for **generated** workflow code only):
- No `require()`, `import`, `fetch()`, `eval()`, `Function()`, `setTimeout`/`setInterval`.
- No access to `process`, `Buffer`, `__dirname`, `__filename`, or `window`.
- Only `event` and `tools` are available.

The **harness** is not generated by the LLM; it may use Node APIs and (when you add it) `fetch` to reach your backend for real tool implementations.

## Trigger system

A workflow can subscribe to **multiple** broad triggers via the `trigger_events` column (`TEXT[]` with a GIN index). When an event fires (Phase 3), the dispatch query will be:

```sql
SELECT * FROM workflows
WHERE trigger_events @> ARRAY['onSessionClosed']
  AND is_active = true;
```

This finds every active workflow whose trigger list contains the fired event.

## Data model

Defined in `docker/postgres/init/01-schema.sql`:

| Column | Type | Notes |
|--------|------|-------|
| `id` | UUID | PK, auto-generated |
| `name` | VARCHAR(255) | Derived from the first prompt (first ~80 chars) |
| `trigger_events` | TEXT[] | Array of trigger names, e.g. `{onSessionClosed,onSessionOpened}` |
| `original_prompt` | TEXT | The latest prompt used for generation |
| `generated_code` | TEXT | The LLM-generated JavaScript |
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
| `POST` | `/api/workflows/generate` | `{ prompt, workflowId? }` | Generate new or refine existing workflow |
| `POST` | `/api/workflows/:id/run-test` | `WorkflowEvent` (JSON) | Execute workflow in E2B sandbox with a sample event. Returns `{ exitCode, stdout, stderr }`. |

### POST /generate flow

1. Validate `prompt` (required, non-empty string).
2. If `workflowId` provided, fetch existing `trigger_events` and `generated_code` from DB (404 if not found).
3. Build system prompt: role/constraints + raw `workflow-sdk.ts` source + optional existing state.
4. Call OpenAI `gpt-4o` with `response_format: json_object`, temperature `0.2`.
5. Validate LLM output with Zod (`trigger_events: string[]`, `code: string`).
6. INSERT (new) or UPDATE (existing) the `workflows` row.
7. Return the full workflow record.

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
- In update mode, the LLM is told to preserve existing logic unless the user explicitly asks to change it.

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
| Code viewer (shiki) | `packages/frontend/src/components/workflow/code-viewer.tsx` |
| Prompt panel | `packages/frontend/src/components/workflow/prompt-panel.tsx` |
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

Split-pane layout: **prompt panel** (left, ~40%) + **code viewer** (right, ~60%).

- **Create mode:** empty state, first prompt creates the workflow. After generation, the URL is replaced with `/workflows/:id` for subsequent refinements.
- **Edit mode:** fetches existing workflow on mount, populates code viewer, user continues refining.
- **Prompt history:** ephemeral React state (not persisted to DB). Shows previous prompts as chat-like bubbles.
- **Code viewer:** uses `shiki` with `github-dark-dimmed` theme. Falls back to plain `<pre>` while the highlighter loads. Shows trigger event badges above the code.
- **Loading state:** spinner overlay on the code panel + "Generating workflow..." in the prompt panel.
- **Error state:** red banner below the code viewer if generation fails, or full-page error if the workflow can't be loaded.

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

## What's not wired up yet (Phase 3)

- **Prompt history persistence:** prompt log is ephemeral. Could add a `prompt_history JSONB` column if needed.
- **Durable workflow execution:** Introduce [Workflow DevKit](https://useworkflow.dev/) (`@workflow/world-postgres`) for durable functions so workflow runs survive restarts and support retries.
- **Sleep / delay support:** Verify that long-running `sleep`-style delays work correctly inside durable workflows (e.g. "wait 5 minutes then send a follow-up email").
- **React Flow workflow canvas:** Revamp the workflow builder interface using [React Flow](https://reactflow.dev/) to give users a visual node-based graph for triggers, conditions, and actions.
- **Expandable side navigation:** Improve the `NavRail` to expand on hover or add a toggle arrow so labels are visible without taking permanent horizontal space.
