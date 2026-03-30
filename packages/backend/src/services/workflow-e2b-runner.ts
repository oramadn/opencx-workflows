import fs from "node:fs";
import path from "node:path";
import { Sandbox } from "e2b";
import type { WorkflowEvent } from "../workflow-sdk.js";

const harnessSource = fs.readFileSync(
  path.join(import.meta.dirname, "../sandbox/workflow-harness.mjs"),
  "utf-8",
);

const stepHarnessSource = fs.readFileSync(
  path.join(import.meta.dirname, "../sandbox/workflow-step-harness.mjs"),
  "utf-8",
);

const SANDBOX_TIMEOUT_MS = 30_000;
const COMMAND_TIMEOUT_MS = 15_000;

export const CONTEXT_MARKER = "__WORKFLOW_CONTEXT_RESULT__";

export interface RunResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export async function runWorkflowInSandbox(
  code: string,
  event: WorkflowEvent,
): Promise<RunResult> {
  const sbx = await Sandbox.create({ timeoutMs: SANDBOX_TIMEOUT_MS });

  try {
    await sbx.files.write("workflow-harness.mjs", harnessSource);
    await sbx.files.write("workflow.mjs", code);

    const result = await sbx.commands.run("node workflow-harness.mjs", {
      envs: {
        WORKFLOW_EVENT_JSON: JSON.stringify(event),
        ...(process.env.RESEND_API_KEY && {
          RESEND_API_KEY: process.env.RESEND_API_KEY,
        }),
        ...(process.env.RESEND_FROM_EMAIL && {
          RESEND_FROM_EMAIL: process.env.RESEND_FROM_EMAIL,
        }),
        ...(process.env.SLACK_BOT_TOKEN && {
          SLACK_BOT_TOKEN: process.env.SLACK_BOT_TOKEN,
        }),
        ...(process.env.WORKFLOW_TOOLS_BASE_URL && {
          WORKFLOW_TOOLS_BASE_URL: process.env.WORKFLOW_TOOLS_BASE_URL,
        }),
        ...(process.env.WORKFLOW_TOOLS_SECRET && {
          WORKFLOW_TOOLS_SECRET: process.env.WORKFLOW_TOOLS_SECRET,
        }),
      },
      timeoutMs: COMMAND_TIMEOUT_MS,
    });

    return {
      exitCode: result.exitCode,
      stdout: result.stdout,
      stderr: result.stderr,
    };
  } finally {
    await sbx.kill().catch(() => {});
  }
}

function secretEnvs(): Record<string, string> {
  return {
    ...(process.env.RESEND_API_KEY && {
      RESEND_API_KEY: process.env.RESEND_API_KEY,
    }),
    ...(process.env.RESEND_FROM_EMAIL && {
      RESEND_FROM_EMAIL: process.env.RESEND_FROM_EMAIL,
    }),
    ...(process.env.SLACK_BOT_TOKEN && {
      SLACK_BOT_TOKEN: process.env.SLACK_BOT_TOKEN,
    }),
    ...(process.env.WORKFLOW_TOOLS_BASE_URL && {
      WORKFLOW_TOOLS_BASE_URL: process.env.WORKFLOW_TOOLS_BASE_URL,
    }),
    ...(process.env.WORKFLOW_TOOLS_SECRET && {
      WORKFLOW_TOOLS_SECRET: process.env.WORKFLOW_TOOLS_SECRET,
    }),
  };
}

export interface StepResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  context: Record<string, unknown>;
}

/**
 * Execute a single action node's code in an E2B sandbox.  The step code has
 * access to `event`, `tools`, and `context` — the same objects the composed
 * workflow `run()` provides, but only for one step.
 *
 * The updated `context` is extracted from a tagged stdout line emitted by
 * the per-step harness.
 */
export async function runStepInSandbox(
  stepCode: string,
  event: WorkflowEvent,
  context: Record<string, unknown>,
): Promise<StepResult> {
  const wrappedCode = `export default async function step(event, tools, context) {\n${stepCode}\n}\n`;

  const sbx = await Sandbox.create({ timeoutMs: SANDBOX_TIMEOUT_MS });

  try {
    await sbx.files.write("workflow-step-harness.mjs", stepHarnessSource);
    await sbx.files.write("workflow-step.mjs", wrappedCode);

    const result = await sbx.commands.run("node workflow-step-harness.mjs", {
      envs: {
        WORKFLOW_EVENT_JSON: JSON.stringify(event),
        WORKFLOW_CONTEXT_JSON: JSON.stringify(context),
        ...secretEnvs(),
      },
      timeoutMs: COMMAND_TIMEOUT_MS,
    });

    let updatedContext = context;
    for (const line of result.stdout.split("\n")) {
      if (line.startsWith(CONTEXT_MARKER)) {
        try {
          updatedContext = JSON.parse(line.slice(CONTEXT_MARKER.length));
        } catch {
          // keep previous context on parse failure
        }
      }
    }

    return {
      exitCode: result.exitCode,
      stdout: result.stdout,
      stderr: result.stderr,
      context: updatedContext,
    };
  } finally {
    await sbx.kill().catch(() => {});
  }
}
