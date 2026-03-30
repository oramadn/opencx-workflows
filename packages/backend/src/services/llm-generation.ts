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
  type: z.enum(["trigger", "condition", "action"]),
  label: z.string().min(1),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

const FlowEdgeSchema = z.object({
  source: z.string().min(1),
  target: z.string().min(1),
  label: z.string().optional(),
});

const FlowGraphSchema = z.object({
  nodes: z.array(FlowNodeSchema).min(1, "At least one flow node is required"),
  edges: z.array(FlowEdgeSchema),
});

const GeneratedSchema = z.object({
  status: z.literal("ok"),
  trigger_events: z
    .array(z.enum(VALID_TRIGGERS))
    .min(1, "At least one trigger event is required"),
  code: z.string().min(1, "Generated code must not be empty"),
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
  existingCode?: string;
  existingFlowGraph?: FlowGraph;
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
  existing?: { triggerEvents: string[]; code: string; flowGraph?: FlowGraph },
): string {
  let prompt = `You are a workflow code generator for a customer support system.

CAPABILITIES — these are the ONLY triggers and tools available:
  Triggers: ${VALID_TRIGGERS.join(", ")}
  Tools: ${VALID_TOOL_METHODS.join(", ")}

Your response MUST be a single JSON object with a "status" key that is either "ok" or "rejected".

If the user's request CAN be fully implemented with the triggers and tools above, respond with:
  { "status": "ok", "trigger_events": [...], "code": "...", "flow": { "nodes": [...], "edges": [...] } }
where:
  - "trigger_events" is an array of one or more trigger names from the list above.
  - "code" is a JavaScript string containing the full workflow function.
  - "flow" is a visual graph descriptor for rendering the workflow as a node diagram.

If the user's request REQUIRES any trigger, action, or integration that is NOT in the lists above (e.g. message-level triggers, WhatsApp, SMS, webhooks, or any tool not listed), you MUST respond with:
  { "status": "rejected", "reason": "...", "unsupported": ["..."] }
where:
  - "reason" is a brief, user-friendly explanation of what cannot be fulfilled and why.
  - "unsupported" is an array of short labels for the missing capabilities (e.g. "trigger:onMessageSent", "action:sendWhatsApp").
Do NOT invent triggers or tools. Do NOT generate code that calls methods not in the tools list. If even one part of the request is unsupported, reject the entire request.

When generating code (status "ok"), the code MUST:
- Export a default async function with this exact signature:
    export default async function run(event, tools) { ... }
- Use ONLY the \`event\` argument (a WorkflowEvent) and the \`tools\` argument (WorkflowTools) provided below.
- Contain condition-checking logic based on \`event\` properties (e.g. event.triggerType, event.sentiment).
- Call ONLY tools from the list above: ${VALID_TOOL_METHODS.map((m) => `tools.${m}`).join(", ")}.

The generated code MUST NEVER:
- Use require(), import, dynamic import(), fetch(), eval(), Function(), or setTimeout/setInterval.
- Access global objects like process, Buffer, __dirname, __filename, or window.
- Declare variables named "event" or "tools" (they are parameters).

FLOW GRAPH — alongside the code, you MUST produce a "flow" object that describes the workflow visually:
  {
    "nodes": [
      { "id": "<unique-id>", "type": "<trigger|condition|action>", "label": "<short human-readable label>" }
    ],
    "edges": [
      { "source": "<node-id>", "target": "<node-id>", "label": "<optional edge label>" }
    ]
  }

Node types:
  - "trigger": One per subscribed trigger event. Label should name the event (e.g. "Session Closed").
  - "condition": A branching decision point. Label should describe the check (e.g. "Customer is angry?"). Use edge labels "Yes"/"No" for the branches.
  - "action": A tool call or side effect. Label should describe what happens (e.g. "Send Slack alert", "Fetch recent sessions").

Rules for the flow graph:
  - Every trigger event in "trigger_events" must have a corresponding trigger node.
  - The graph must be a connected DAG starting from trigger node(s).
  - Node IDs must be unique strings (e.g. "trigger-1", "condition-1", "action-1").
  - The graph should mirror the logical structure of the code — each condition check and tool call should be a node.
  - Keep labels concise (under 40 characters).

Here are the COMPLETE TypeScript type definitions — this is your compiler reference.
The code you produce must conform to these types exactly:

\`\`\`typescript
${sdkSource}
\`\`\`

Respond with ONLY valid JSON. No markdown fences, no explanation.`;

  if (existing) {
    prompt += `

You are UPDATING an existing workflow. The current configuration is:

Current trigger events: ${JSON.stringify(existing.triggerEvents)}

Current code:
\`\`\`javascript
${existing.code}
\`\`\`

Current flow graph:
\`\`\`json
${JSON.stringify(existing.flowGraph ?? { nodes: [], edges: [] }, null, 2)}
\`\`\`

Modify the code and flow graph to fulfill the user's new request.
Retain any existing logic unless the user explicitly asks to remove or change it.
Keep the flow graph in sync with the code — add, update, or remove nodes/edges to match.
If the user's request implies additional triggers, add them to the trigger_events array.
If the new request introduces unsupported capabilities, reject it — do NOT silently ignore the unsupported parts.`;
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
    options.existingCode && options.existingTriggerEvents
      ? {
          triggerEvents: options.existingTriggerEvents,
          code: options.existingCode,
          flowGraph: options.existingFlowGraph,
        }
      : undefined;

  const systemPrompt = buildSystemPrompt(existing);

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
    const unknownMethods = findUnknownToolCalls(outcome.code);
    if (unknownMethods.length > 0) {
      return {
        status: "rejected",
        reason: `The generated code references tools that are not available: ${unknownMethods.map((m) => `tools.${m}`).join(", ")}. Please rephrase your request using only the supported capabilities.`,
        unsupported: unknownMethods.map((m) => `action:${m}`),
      };
    }
  }

  return outcome;
}
