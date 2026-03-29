import fs from "node:fs";
import path from "node:path";
import OpenAI from "openai";
import { z } from "zod";
import { VALID_TRIGGERS } from "../workflow-sdk.js";

const sdkSource = fs.readFileSync(
  path.join(import.meta.dirname, "../workflow-sdk.ts"),
  "utf-8",
);

let _openai: OpenAI | null = null;
function getClient(): OpenAI {
  if (!_openai) _openai = new OpenAI();
  return _openai;
}

const GenerationResultSchema = z.object({
  trigger_events: z
    .array(z.enum(VALID_TRIGGERS))
    .min(1, "At least one trigger event is required"),
  code: z.string().min(1, "Generated code must not be empty"),
});

export type GenerationResult = z.infer<typeof GenerationResultSchema>;

interface GenerateOptions {
  prompt: string;
  existingTriggerEvents?: string[];
  existingCode?: string;
}

function buildSystemPrompt(
  existing?: { triggerEvents: string[]; code: string },
): string {
  let prompt = `You are a workflow code generator for a customer support system.
Your ONLY job is to produce a JSON object with exactly two keys:
  1. "trigger_events" — an array of one or more trigger names from: ${VALID_TRIGGERS.join(", ")}
  2. "code" — a JavaScript string containing the full workflow function

The generated code MUST:
- Export a default async function with this exact signature:
    export default async function run(event, tools) { ... }
- Use ONLY the \`event\` argument (a WorkflowEvent) and the \`tools\` argument (WorkflowTools) provided below.
- Contain condition-checking logic based on \`event\` properties (e.g. event.triggerType, event.sentiment).
- Call data-fetching tools (tools.getSessions, tools.getMessages) and action tools (tools.sendEmail, tools.sendSlackChannelMessage) as needed.

The generated code MUST NEVER:
- Use require(), import, dynamic import(), fetch(), eval(), Function(), or setTimeout/setInterval.
- Access global objects like process, Buffer, __dirname, __filename, or window.
- Declare variables named "event" or "tools" (they are parameters).

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

Modify this code to fulfill the user's new request.
Retain any existing logic unless the user explicitly asks to remove or change it.
If the user's request implies additional triggers, add them to the trigger_events array.`;
  }

  return prompt;
}

export async function generateWorkflow(
  options: GenerateOptions,
): Promise<GenerationResult> {
  const existing =
    options.existingCode && options.existingTriggerEvents
      ? {
          triggerEvents: options.existingTriggerEvents,
          code: options.existingCode,
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

  return GenerationResultSchema.parse(parsed);
}
