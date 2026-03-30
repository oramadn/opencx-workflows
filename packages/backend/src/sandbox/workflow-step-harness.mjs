/**
 * Trusted per-step harness — runs INSIDE the E2B sandbox.
 *
 * Unlike the full workflow harness, this one executes a single action node's
 * code snippet.  It receives event + context via env vars, builds the same
 * tools object, wraps the step code in an async IIFE, then writes the
 * updated context to stdout as a tagged JSON line so the host can parse it.
 *
 * Env vars:
 *   WORKFLOW_EVENT_JSON   — the trigger event
 *   WORKFLOW_CONTEXT_JSON — accumulated inter-step context (may be "{}")
 *   + optional secrets (RESEND_API_KEY, SLACK_BOT_TOKEN, WORKFLOW_TOOLS_*)
 */

const CONTEXT_MARKER = "__WORKFLOW_CONTEXT_RESULT__";

const eventJson = process.env.WORKFLOW_EVENT_JSON;
if (!eventJson) {
  console.error("WORKFLOW_EVENT_JSON env var is missing");
  process.exit(1);
}

let event;
try {
  event = JSON.parse(eventJson);
} catch (err) {
  console.error("Failed to parse WORKFLOW_EVENT_JSON:", err.message);
  process.exit(1);
}

let context;
try {
  context = JSON.parse(process.env.WORKFLOW_CONTEXT_JSON || "{}");
} catch {
  context = {};
}

// ── tools (identical to the full harness) ────────────────────────────────────

const toolsBaseUrl = (process.env.WORKFLOW_TOOLS_BASE_URL || "").replace(
  /\/$/,
  "",
);
const toolsSecret = process.env.WORKFLOW_TOOLS_SECRET || "";
const hasToolsApi = Boolean(toolsBaseUrl && toolsSecret);

async function queryHost(resource, options) {
  const res = await fetch(
    `${toolsBaseUrl}/api/internal/workflow-tools/query`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${toolsSecret}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ resource, options: options ?? undefined }),
    },
  );

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(
      `Workflow tools query failed (${res.status}): ${text}`,
    );
  }

  return res.json();
}

const MOCK_SESSIONS = [
  {
    id: "00000000-0000-0000-0000-000000000001",
    customerName: "Alice Mock",
    status: "closed",
    sentiment: "angry",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
  {
    id: "00000000-0000-0000-0000-000000000002",
    customerName: "Bob Mock",
    status: "open",
    sentiment: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
];

const MOCK_MESSAGES = [
  {
    id: "00000000-0000-0000-0000-000000000010",
    sessionId: "00000000-0000-0000-0000-000000000001",
    authorRole: "customer",
    body: "I am very unhappy with the service!",
    createdAt: new Date().toISOString(),
  },
  {
    id: "00000000-0000-0000-0000-000000000011",
    sessionId: "00000000-0000-0000-0000-000000000001",
    authorRole: "agent",
    body: "I am sorry to hear that. Let me help.",
    createdAt: new Date().toISOString(),
  },
];

const tools = {
  async getSessions(options) {
    if (!hasToolsApi) {
      console.log(
        JSON.stringify({ tool: "getSessions", options: options ?? {}, mock: true }),
      );
      return MOCK_SESSIONS;
    }
    console.log(JSON.stringify({ tool: "getSessions", options: options ?? {} }));
    return queryHost("sessions", options);
  },

  async getMessages(options) {
    if (!hasToolsApi) {
      console.log(
        JSON.stringify({ tool: "getMessages", options: options ?? {}, mock: true }),
      );
      return MOCK_MESSAGES;
    }
    console.log(JSON.stringify({ tool: "getMessages", options: options ?? {} }));
    return queryHost("session_messages", options);
  },

  async sendEmail(to, subject, body) {
    const apiKey = process.env.RESEND_API_KEY;
    const from = process.env.RESEND_FROM_EMAIL || "onboarding@resend.dev";

    if (!apiKey) {
      console.log(
        JSON.stringify({ tool: "sendEmail", to, subject, body, mock: true }),
      );
      return;
    }

    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ from, to: [to], subject, text: body }),
    });

    const result = await res.json();

    if (!res.ok) {
      throw new Error(
        `sendEmail failed (${res.status}): ${JSON.stringify(result)}`,
      );
    }

    console.log(
      JSON.stringify({ tool: "sendEmail", to, subject, resendId: result.id }),
    );
  },

  async sendSlackChannelMessage(channelName, message) {
    const token = process.env.SLACK_BOT_TOKEN;

    if (!token) {
      console.log(
        JSON.stringify({
          tool: "sendSlackChannelMessage",
          channelName,
          message,
          mock: true,
        }),
      );
      return;
    }

    const channel =
      channelName.startsWith("#") || channelName.startsWith("C")
        ? channelName
        : `#${channelName}`;

    const res = await fetch("https://slack.com/api/chat.postMessage", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ channel, text: message }),
    });

    const result = await res.json();

    if (!result.ok) {
      throw new Error(
        `sendSlackChannelMessage failed: ${result.error ?? JSON.stringify(result)}`,
      );
    }

    console.log(
      JSON.stringify({
        tool: "sendSlackChannelMessage",
        channel: result.channel,
        ts: result.ts,
      }),
    );
  },
};

// ── execute the step code ────────────────────────────────────────────────────

try {
  const mod = await import("./workflow-step.mjs");
  const stepFn = mod.default;
  if (typeof stepFn !== "function") {
    throw new Error("workflow-step.mjs must export a default async function");
  }
  await stepFn(event, tools, context);

  // Emit updated context so the host can capture it
  console.log(`${CONTEXT_MARKER}${JSON.stringify(context)}`);
} catch (err) {
  console.error("Step execution failed:", err);
  process.exit(1);
}
