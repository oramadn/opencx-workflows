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
