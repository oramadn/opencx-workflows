import fs from "node:fs";
import path from "node:path";
import OpenAI from "openai";
import { z } from "zod";
import type { FlowGraph } from "../workflow-sdk.js";
import { VALID_TOOL_METHODS, VALID_TRIGGERS } from "../workflow-sdk.js";

const sdkSource = fs.readFileSync(
  path.join(import.meta.dirname, "../workflow-sdk.ts"),
  "utf-8",
);

let _openai: OpenAI | null = null;
function getClient(): OpenAI {
  if (!_openai) _openai = new OpenAI();
  return _openai;
}

// ---------------------------------------------------------------------------
// Discriminated LLM response schemas
// ---------------------------------------------------------------------------

const FlowNodeSchema = z.object({
  id: z.string().min(1),
  type: z.enum(["trigger", "condition", "action", "delay"]),
  label: z.string().min(1),
  code: z.string().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

const FlowEdgeSchema = z.object({
  source: z.string().min(1),
  target: z.string().min(1),
  label: z.string().optional(),
});

const FlowGraphSchema = z
  .object({
    nodes: z
      .array(FlowNodeSchema)
      .min(1, "At least one flow node is required"),
    edges: z.array(FlowEdgeSchema),
  })
  .superRefine((graph, ctx) => {
    for (const node of graph.nodes) {
      if (node.type === "trigger") continue;
      if (!node.code || node.code.trim() === "") {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Non-trigger node "${node.id}" must have a non-empty "code" field`,
          path: ["nodes"],
        });
      }
      if (node.type === "delay" && !/^\d+\s*(ms|s|m|h|d)$/.test(node.code?.trim() ?? "")) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Delay node "${node.id}" code must be a duration string (e.g. "30s", "5m", "1h", "1d")`,
          path: ["nodes"],
        });
      }
    }
  });

const GeneratedSchema = z.object({
  status: z.literal("ok"),
  trigger_events: z
    .array(z.enum(VALID_TRIGGERS))
    .min(1, "At least one trigger event is required"),
  flow: FlowGraphSchema,
});

const RejectedSchema = z.object({
  status: z.literal("rejected"),
  reason: z.string().min(1, "Rejection reason must not be empty"),
  unsupported: z.array(z.string()).optional(),
});

const GenerationOutcomeSchema = z.discriminatedUnion("status", [
  GeneratedSchema,
  RejectedSchema,
]);

export type GenerationOutcome = z.infer<typeof GenerationOutcomeSchema>;

export interface GenerateOptions {
  prompt: string;
  existingTriggerEvents?: string[];
  existingFlowGraph?: FlowGraph;
  /** When set, the system prompt focuses the LLM on this node (per-node chat). */
  focusedNodeId?: string;
}

// ---------------------------------------------------------------------------
// Post-parse guard: ensure generated code only calls known tools methods
// ---------------------------------------------------------------------------

const TOOLS_CALL_RE = /tools\.(\w+)\s*\(/g;
const toolMethodSet = new Set<string>(VALID_TOOL_METHODS);

export function findUnknownToolCalls(code: string): string[] {
  const unknown: string[] = [];
  for (const match of code.matchAll(TOOLS_CALL_RE)) {
    const method = match[1]!;
    if (!toolMethodSet.has(method) && !unknown.includes(method)) {
      unknown.push(method);
    }
  }
  return unknown;
}

// ---------------------------------------------------------------------------
// System prompt
// ---------------------------------------------------------------------------

function buildSystemPrompt(
  existing?: { triggerEvents: string[]; flowGraph?: FlowGraph },
  focusedNodeId?: string,
): string {
  let prompt = `You are a workflow code generator for a customer support system.

CAPABILITIES — these are the ONLY triggers, tools, and scheduling primitives available:
  Triggers: ${VALID_TRIGGERS.join(", ")}
  Tools: ${VALID_TOOL_METHODS.join(", ")}
  Scheduling: delay nodes — durably pause workflow execution for a duration

Your response MUST be a single JSON object with a "status" key that is either "ok" or "rejected".

If the user's request CAN be fully implemented with the triggers and tools above, respond with:
  { "status": "ok", "trigger_events": [...], "flow": { "nodes": [...], "edges": [...] } }
where:
  - "trigger_events" is an array of one or more trigger names from the list above.
  - "flow" is a visual graph descriptor where each non-trigger node carries a "code" field (see below).

If the user's request REQUIRES any trigger, action, or integration that is NOT in the lists above (e.g. message-level triggers, WhatsApp, SMS, webhooks, or any tool not listed), you MUST respond with:
  { "status": "rejected", "reason": "...", "unsupported": ["..."] }
where:
  - "reason" is a brief, user-friendly explanation of what cannot be fulfilled and why.
  - "unsupported" is an array of short labels for the missing capabilities (e.g. "trigger:onMessageSent", "action:sendWhatsApp").
Do NOT invent triggers or tools. Do NOT generate code that calls methods not in the tools list. If even one part of the request is unsupported, reject the entire request.

STEP-CODE ARCHITECTURE — each flow node carries its own code snippet instead of a monolithic function:

  - "trigger" nodes: NO "code" field. Triggers represent event subscriptions, not executable code.
  - "action" nodes: "code" is the step body — tool calls, data preparation, assignments. This code runs inside an async IIFE with access to \`event\`, \`tools\`, and a shared \`context\` object.
  - "condition" nodes: "code" is a boolean expression (e.g. \`event.sentiment === 'angry'\`). The runtime wraps it in an if-statement.
  - "delay" nodes: "code" is a duration string using units s/m/h/d (e.g. "30s", "5m", "1h", "1d"). The runtime durably pauses execution for that duration. Use delay nodes between action nodes when the user asks to wait, pause, or schedule a follow-up after some time.

INTER-STEP DATA FLOW — the \`context\` convention:
  Steps share data through a \`context\` object provided by the runtime.
  - To pass data to a later step, assign it: \`context.messages = await tools.getMessages(...);\`
  - To read data from an earlier step, reference it: \`context.messages\`
  - Local variables within a step (declared with const/let) stay scoped to that step.
  - The \`event\` and \`tools\` objects are available in every step.

Per-step code MUST:
- Call ONLY tools from the list above: ${VALID_TOOL_METHODS.map((m) => `tools.${m}`).join(", ")}.
- Use \`context.*\` for any value that a later step needs.

Per-step code MUST NEVER:
- Use require(), import, dynamic import(), fetch(), eval(), Function(), or setTimeout/setInterval.
- Access global objects like process, Buffer, __dirname, __filename, or window.
- Declare variables named "event", "tools", or "context" (they are provided by the runtime).
- Include the \`export default async function run\` wrapper — the runtime composes that.

FLOW GRAPH — you MUST produce a "flow" object:
  {
    "nodes": [
      { "id": "<unique-id>", "type": "trigger", "label": "<event name>", "metadata": { "triggerType": "<trigger name>" } },
      { "id": "<unique-id>", "type": "action", "label": "<short label>", "code": "<step body>", "metadata": { "toolMethod": "<primary tool called>" } },
      { "id": "<unique-id>", "type": "condition", "label": "<question?>", "code": "<boolean expression>" },
      { "id": "<unique-id>", "type": "delay", "label": "Wait 5 minutes", "code": "5m" }
    ],
    "edges": [
      { "source": "<node-id>", "target": "<node-id>", "label": "<optional: Yes/No for conditions>" }
    ]
  }

Rules for the flow graph:
  - Every trigger event in "trigger_events" must have a corresponding trigger node.
  - The graph must be a connected DAG starting from trigger node(s).
  - Node IDs must be unique strings (e.g. "trigger-1", "condition-1", "action-1", "delay-1").
  - Every non-trigger node MUST have a non-empty "code" field.
  - Condition nodes must have "Yes"/"No" labeled edges to downstream nodes.
  - Delay node "code" must be ONLY a duration string (e.g. "30s", "5m", "1h", "1d") — no JavaScript.
  - Keep labels concise (under 40 characters).

NODE METADATA — used by the UI to display the correct icon for each node:
  - Every "trigger" node MUST include "metadata": { "triggerType": "<name>" } where <name> is the matching trigger from trigger_events (one of: ${VALID_TRIGGERS.join(", ")}).
  - Every "action" node MUST include "metadata": { "toolMethod": "<name>" } where <name> is the PRIMARY tools method that the step's code calls (one of: ${VALID_TOOL_METHODS.join(", ")}). If the step calls multiple tools, use the most important one.
  - "condition" and "delay" nodes do not need metadata.

Here are the COMPLETE TypeScript type definitions — this is your compiler reference.
The step code you produce must conform to these types exactly:

\`\`\`typescript
${sdkSource}
\`\`\`

Respond with ONLY valid JSON. No markdown fences, no explanation.`;

  if (existing) {
    prompt += `

You are UPDATING an existing workflow. The current configuration is:

Current trigger events: ${JSON.stringify(existing.triggerEvents)}

Current flow graph (with per-node step code):
\`\`\`json
${JSON.stringify(existing.flowGraph ?? { nodes: [], edges: [] }, null, 2)}
\`\`\`

Modify the flow graph and per-node code to fulfill the user's new request.
Retain any existing logic unless the user explicitly asks to remove or change it.
Keep the flow graph consistent — add, update, or remove nodes/edges to match.
If the user's request implies additional triggers, add them to the trigger_events array.
If the new request introduces unsupported capabilities, reject it — do NOT silently ignore the unsupported parts.`;
  }

  if (focusedNodeId && existing?.flowGraph) {
    const graph = existing.flowGraph;
    const focusedNode = graph.nodes.find((n) => n.id === focusedNodeId);
    if (focusedNode) {
      const upstreamIds = graph.edges
        .filter((e) => e.target === focusedNodeId)
        .map((e) => e.source);
      const downstreamIds = graph.edges
        .filter((e) => e.source === focusedNodeId)
        .map((e) => e.target);
      const neighborIds = new Set([...upstreamIds, ...downstreamIds]);
      const neighbors = graph.nodes.filter((n) => neighborIds.has(n.id));

      prompt += `

NODE-FOCUSED EDIT — the user is editing a specific node in the workflow.

Focused node:
  id: "${focusedNode.id}", type: "${focusedNode.type}", label: "${focusedNode.label}"${focusedNode.code ? `\n  code: ${JSON.stringify(focusedNode.code)}` : ""}

${neighbors.length > 0 ? `Immediate neighbors:\n${neighbors.map((n) => `  - id: "${n.id}", type: "${n.type}", label: "${n.label}"${n.code ? `, code: ${JSON.stringify(n.code)}` : ""}`).join("\n")}` : "This node has no immediate neighbors."}

Rules for node-focused edits:
  - The focused node ("${focusedNode.id}") is the PRIMARY subject of the user's request.
  - You MAY add, remove, or modify neighboring nodes and edges when the change structurally requires it (e.g. removing the focused node and reconnecting edges, inserting a new node before/after, changing the type which affects edge wiring).
  - You MUST NOT modify nodes that are unrelated to the focused node unless the user explicitly asks.
  - If the user asks to remove the focused node, reconnect its incoming edges to its downstream nodes to maintain a valid DAG.
  - Always return the COMPLETE flow graph (all nodes and edges), not just the changed parts.`;
    }
  }

  return prompt;
}

// ---------------------------------------------------------------------------
// Main generation function
// ---------------------------------------------------------------------------

export async function generateWorkflow(
  options: GenerateOptions,
): Promise<GenerationOutcome> {
  const existing =
    options.existingTriggerEvents
      ? {
          triggerEvents: options.existingTriggerEvents,
          flowGraph: options.existingFlowGraph,
        }
      : undefined;

  const systemPrompt = buildSystemPrompt(existing, options.focusedNodeId);

  const response = await getClient().chat.completions.create({
    model: "gpt-4o",
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: options.prompt },
    ],
    temperature: 0.2,
  });

  const content = response.choices[0]?.message?.content;
  if (!content) {
    throw new Error("LLM returned an empty response");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    throw new Error(`LLM returned invalid JSON: ${content.slice(0, 200)}`);
  }

  const outcome = GenerationOutcomeSchema.parse(parsed);

  if (outcome.status === "ok") {
    const allUnknown: string[] = [];
    for (const node of outcome.flow.nodes) {
      if (!node.code || node.type === "delay") continue;
      for (const method of findUnknownToolCalls(node.code)) {
        if (!allUnknown.includes(method)) allUnknown.push(method);
      }
    }
    if (allUnknown.length > 0) {
      return {
        status: "rejected",
        reason: `The generated code references tools that are not available: ${allUnknown.map((m) => `tools.${m}`).join(", ")}. Please rephrase your request using only the supported capabilities.`,
        unsupported: allUnknown.map((m) => `action:${m}`),
      };
    }
  }

  return outcome;
}
