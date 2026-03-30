# Why We Don't Use the Workflow SDK (and What We Do Instead)

## The problem

Our workflow builder lets an AI generate executable code at runtime. That code runs inside **E2B sandboxes** — ephemeral, isolated cloud containers that live for ~30 seconds. This is a security boundary: AI-generated code never touches our host, our filesystem, or our database directly.

The **Workflow SDK** (`"use workflow"`, `"use step"`, `sleep()`) is a durable execution framework. It gives you crash-safe, resumable workflows with automatic step replay. It's powerful — but it assumes the workflow code runs **on your own infrastructure**, compiled and deployed as part of your application.

These two assumptions are fundamentally in tension.

## Why the Workflow SDK doesn't fit our architecture

The SDK requires three things that conflict with ephemeral sandboxes:

1. **A compile step.** `"use workflow"` and `"use step"` are not real JavaScript. They're directives that a Vite/bundler plugin transforms at build time into event-sourced checkpointing code. E2B sandboxes run raw JS — to use the SDK there, every sandbox invocation would need to install the SDK, run a bundler, and compile the generated code before executing it.

2. **A persistent connection to Postgres.** The SDK writes an event log to a "world" (Postgres). The sandbox would need direct network access to our database. This undermines the isolation that E2B provides — the whole point is that untrusted code can't reach our infrastructure.

3. **Process continuity across sleeps.** When `sleep("5m")` is called, the SDK writes a timer event and the function returns. Five minutes later, something must spin up a **new** process, replay the entire event log, and continue execution from where it left off. In our case, that means creating a new E2B sandbox, re-compiling the same code, reconnecting to Postgres, and hoping the replay produces identical state. And something on the host still needs to schedule that resumption — which is a job queue. We'd still need graphile-worker.

In short: using the SDK inside E2B would mean **every delay creates a new sandbox with a full compile cycle and database connectivity**, while the host still runs a job scheduler to trigger resumptions. The SDK replaces our checkpointing logic but adds compile overhead and breaks sandbox isolation.

## What Vercel does differently

Vercel's own AI workflow builder doesn't have this problem because they **don't have a sandbox boundary**. AI-generated code is compiled and deployed directly onto their serverless infrastructure. The SDK runtime, the Postgres world, and the generated code all live in the same environment. That's a valid design when you control the entire platform and trust the generated code (or have other mitigation).

We chose E2B specifically because we **don't** trust AI-generated code to run on our host. That security boundary is what makes the SDK impractical for us.

## What we built instead

A **host-side graph walker** with **graphile-worker** for durable scheduling:

- The workflow is represented as a flow graph (nodes + edges), not a single async function.
- The host walks the graph node-by-node. Action nodes execute in E2B. Condition nodes evaluate on the host.
- When the walker hits a **delay node**, it saves its progress to a `workflow_runs` table (visited nodes, context, resume point) and schedules a graphile-worker job with `runAt = now + delay`.
- When the job fires, the walker loads the saved state and resumes from where it stopped.

This gives us durable delays without requiring compile-time transforms, without giving sandboxes database access, and without the overhead of replaying an event log.

## Tradeoffs of not using the Workflow SDK

| What we lose | Impact | Severity |
|---|---|---|
| **Step idempotency** | If an action node sends an email and the process crashes before marking it visited, the email may be re-sent on retry. The SDK's event log prevents this by caching step results. | Low for now — our actions are notifications (email, Slack). Acceptable for a prototype. Could add idempotency keys to tools later. |
| **Exact replay** | The SDK can replay a workflow from scratch and arrive at exactly the same state. Our walker relies on a saved context snapshot — if the schema of context changes between code updates, a resumed run may behave unexpectedly. | Low — workflows are short-lived and delays are bounded (minutes to hours, not weeks). |
| **Built-in webhook pausing** | The SDK has `createHook()` / `createWebhook()` to pause a workflow until an external event arrives (e.g. "wait for customer reply"). We'd have to build this ourselves if needed. | Not needed yet. Would be the strongest reason to reconsider the SDK in the future. |
| **Observability** | The SDK's event log is a detailed audit trail of every step execution. Our `workflow_runs` table stores coarser state (which nodes were visited, final context). | Acceptable for a prototype. Can add structured logging per node if needed. |

## When to reconsider

If the project evolves to need any of the following, it's worth revisiting the SDK — potentially running it **on the host** as the orchestrator (not inside E2B):

- **Exactly-once step execution** for actions with real consequences (billing, database writes)
- **Webhook/hook pausing** ("wait until the customer replies before continuing")
- **Complex control flow** (loops, sub-workflows, fan-out/fan-in)

The SDK would run on the host as a durable orchestrator, calling into E2B only for sandboxed action execution — similar to our current graph walker, but with the SDK managing state instead of our custom `workflow_runs` table.

---

## What switching to the Workflow SDK would look like

If we decided to adopt the SDK for the full stack, here's what it would require and what we'd get in return.

### What changes

**1. Drop E2B. AI-generated code runs on the host.**

This is the big one. The SDK needs workflow code to be compiled and executed in the same environment as the runtime and Postgres. E2B is incompatible with that model. We'd remove the sandbox boundary entirely and execute AI-generated code directly on our Node.js backend.

**Security mitigation would shift** from process isolation (E2B) to code-level constraints: static analysis of generated code, an allowlist of permitted APIs, and potentially a lightweight in-process sandbox like `vm2` or Node's `--experimental-vm-modules`. None of these are as strong as E2B's full container isolation.

**2. Add a build step to the backend.**

The SDK's `"use workflow"` and `"use step"` directives require a Vite plugin (or equivalent bundler transform) that rewrites the code at compile time. Our backend currently runs with `tsx` (no build). We'd need to:

- Add a Vite or esbuild build pipeline for the backend.
- Configure the `workflow` Vite plugin.
- Either pre-compile AI-generated workflow code on save (turning generation into a build+deploy cycle), or compile on-the-fly when a workflow is triggered.

**3. Rewrite the generation pipeline.**

The LLM currently generates a flow graph with per-node code snippets. With the SDK, it would instead generate a single async function that uses SDK primitives:

```typescript
"use workflow";
import { sleep } from "workflow";

export default async function run(event, tools) {
  "use step";
  const sessions = await tools.getSessions({ where: [{ field: "sentiment", op: "eq", value: "angry" }] });

  "use step";
  await tools.sendEmail(event.customerEmail, "We're sorry", "Following up on your session...");

  await sleep("5m");

  "use step";
  await tools.sendSlackChannelMessage("alerts", `Follow-up sent to ${event.customerName}`);
}
```

The system prompt, Zod schema, and composition engine would all change. The flow graph visual model could stay (it's UI), but the executable code would be a monolithic function with SDK directives instead of per-node snippets.

**4. Wire up the Workflow SDK runtime.**

- Call `getWorld().start?.()` on server boot (currently documented but not wired).
- Configure `WORKFLOW_TARGET_WORLD=@workflow/world-postgres` and `WORKFLOW_POSTGRES_URL`.
- The SDK uses graphile-worker internally for its job queue — our direct graphile-worker usage, the segment executor, and the `workflow_runs` table would all be replaced by the SDK's event log and internal scheduling.

**5. Delete our custom orchestration layer.**

These files/concepts become redundant:

- `workflow_runs` table and `04-workflow-runs.sql`
- `workflow-segment-executor.ts` (graph walker)
- `workflow-step-harness.mjs` (per-step E2B harness)
- `runStepInSandbox()` in `workflow-e2b-runner.ts`
- The delay-node routing logic in `workflow-dispatcher.ts`
- Direct graphile-worker initialization in `index.ts`

The `tools` object would move from the E2B harness to a host-side module that the generated code imports or receives as an argument.

### What we gain

| Benefit | Detail |
|---|---|
| **Step idempotency** | Every `"use step"` caches its result in the event log. If the process crashes after sending an email, the SDK won't re-send it on replay — it returns the cached result. This is the single biggest reliability improvement. |
| **Durable sleep as a first-class primitive** | `sleep("5m")` just works. No delay nodes, no graph walker, no manual state checkpointing. The SDK handles persistence, timer scheduling, and replay internally. |
| **Crash recovery via replay** | If the server restarts mid-workflow, the SDK replays the event log from the beginning, skips all completed steps (returning cached results), and resumes execution exactly where it left off. Our current system resumes from a checkpoint but doesn't replay — subtle state inconsistencies are possible. |
| **Webhook/hook pausing** | `createHook()` pauses a workflow until an external HTTP callback arrives. This enables "wait until the customer replies" without building custom infrastructure. |
| **Simpler codebase** | We delete ~400 lines of custom orchestration (segment executor, step harness, run table, dispatcher routing). The SDK replaces all of it with a few directives and a runtime call. |
| **Observability** | The event log is a complete, queryable audit trail of every step in every workflow run — what ran, what returned, when it slept, when it resumed. |

### What we lose

| Cost | Detail |
|---|---|
| **Sandbox isolation** | The most significant loss. AI-generated code runs on our host with access to the Node.js environment. A malicious or buggy workflow could access the filesystem, make arbitrary network requests, or consume unbounded resources. Mitigation exists (static analysis, `vm2`, resource limits) but is weaker than E2B's container boundary. |
| **Simplicity of the backend** | We add a compile step, a bundler plugin, and the SDK runtime to a backend that currently has none of these. The SDK is beta software (`4.2.0-beta.73`) with its own learning curve and upgrade churn. |
| **Instant test feedback** | Currently, the test endpoint composes code and runs it immediately in E2B. With the SDK, testing would either need to bypass the directives (mock mode) or run a real durable workflow — which is slower and more complex. |
| **Flow graph as source of truth** | The SDK model is a single function, not a node graph. The visual flow graph would become a derived view (generated from the code or maintained in parallel), rather than the canonical representation that drives execution. This is a significant UX and architecture shift. |

### Summary

Switching to the Workflow SDK means **trading sandbox security for execution reliability**. The SDK gives us idempotent steps, durable sleep, crash replay, and webhook pausing — things that are genuinely hard to build correctly. But it requires running AI-generated code on the host, which is the one thing our architecture was specifically designed to prevent.

The decision comes down to: **how much do you trust AI-generated code?** If the answer is "enough, with guardrails," the SDK is a strict upgrade in reliability and simplicity. If the answer is "not at all without full isolation," E2B + our custom orchestration is the right tradeoff.

---

## How does Vercel run AI-generated workflows without sandboxing?

Vercel doesn't skip sandboxing — they just don't need E2B because their platform already provides three layers of protection that we don't have.

### 1. The code runs in the user's account, not the platform's

When Vercel's AI generates a workflow, it gets deployed as a serverless function in *that user's* Vercel project. If the generated code does something destructive — leaks env vars, makes expensive API calls, infinite loops — it damages the **user's own resources**, not Vercel's infrastructure or other customers. The blast radius is scoped to the person who asked for it.

In our case, the generated code runs on **our backend server**. A bad workflow could read our filesystem, access our database, exhaust our memory, or interfere with other users' workflows. The blast radius is our entire system. That's why we need E2B.

### 2. Vercel already has platform-level isolation

Vercel Functions run in either **V8 isolates** (Edge Runtime — same technology as Cloudflare Workers) or **containerized Node.js processes** (Node runtime). Both provide:

- Memory isolation between functions (one function can't read another's state)
- No filesystem persistence (ephemeral, like E2B)
- Enforced timeouts and memory limits (function gets killed if it exceeds them)
- Limited API surface on Edge Runtime (no `fs`, no `child_process`, no raw sockets)

This isn't as strong as a full container sandbox, but it's sufficient because of point 1 — the worst case is "user's own function misbehaves in user's own project."

### 3. Human-in-the-loop before deployment

Vercel's workflow builder shows the user the generated code and lets them review/edit it before deploying. There's a deliberate step between "AI generated this" and "this is running in production." The user has agency to catch problems.

Our system is more automated — a trigger fires, the dispatcher finds matching workflows, and generated code executes immediately. There's no human review at execution time (though there is at creation time in the builder UI).

### The fundamental difference is where the trust boundary sits

| | Vercel | Us |
|---|---|---|
| **Who owns the compute?** | The user paying for Vercel | Us (our server) |
| **Who suffers if code is bad?** | The user who deployed it | Us and all our users |
| **Platform isolation?** | V8 isolates / serverless containers (built-in) | Plain Node.js process (none without E2B) |
| **Review before execution?** | Yes — deploy cycle with code preview | No — auto-dispatched on trigger |

Vercel can afford to run AI-generated code without E2B because the code is **isolated by their platform** and **scoped to the user's own account**. We can't, because the code would run in our shared backend process with access to everything.

That's the core reason E2B exists in our stack — and why the Workflow SDK, which assumes your code is trusted, doesn't naturally fit.
