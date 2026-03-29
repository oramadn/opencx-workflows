import fs from "node:fs";
import path from "node:path";
import { Sandbox } from "e2b";
import type { WorkflowEvent } from "../workflow-sdk.js";

const harnessSource = fs.readFileSync(
  path.join(import.meta.dirname, "../sandbox/workflow-harness.mjs"),
  "utf-8",
);

const SANDBOX_TIMEOUT_MS = 30_000;
const COMMAND_TIMEOUT_MS = 15_000;

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
