/**
 * Read-only catalog for the workflow builder SDK reference (side panel).
 *
 * Keep aligned with packages/backend/src/workflow-sdk.ts and the sandbox
 * `tools` object in workflow-harness.mjs / workflow-step-harness.mjs.
 */

export type SdkReferenceSectionId = "triggers" | "flowControl" | "actions";

export interface SdkReferenceItem {
  id: string;
  title: string;
  summary: string;
  iconKey: string;
  /** Ideas / field names to use when describing this to the AI in the chat */
  attributes: string[];
  /** Example sentence the user can copy or adapt for the workflow prompt */
  examplePrompt: string;
}

export interface SdkReferenceSection {
  id: SdkReferenceSectionId;
  title: string;
  items: SdkReferenceItem[];
}

export const SDK_REFERENCE_SECTIONS: SdkReferenceSection[] = [
  {
    id: "triggers",
    title: "Triggers",
    items: [
      {
        id: "onSessionClosed",
        title: "onSessionClosed",
        iconKey: "onSessionClosed",
        summary: "Fires when a session is closed; use customer, sentiment, and IDs in your wording to the AI.",
        attributes: [
          "session closed",
          "customerName, customerEmail",
          "sessionId",
          "sentiment: happy, neutral, or angry",
          "createdAt (when the session started)",
        ],
        examplePrompt:
          "When a session closes, if the customer was angry, Slack #escalations with their name, email, and session id.",
      },
      {
        id: "onSessionOpened",
        title: "onSessionOpened",
        iconKey: "onSessionOpened",
        summary: "Fires when a new session opens; mention new chats, customer, and session id in prompts.",
        attributes: [
          "new session / session opened",
          "customerName, customerEmail",
          "sessionId",
          "createdAt",
        ],
        examplePrompt:
          "When a new session opens, email the team a one-line heads-up with the customer name and session id.",
      },
    ],
  },
  {
    id: "flowControl",
    title: "Flow Control",
    items: [
      {
        id: "condition",
        title: "Condition",
        iconKey: "condition",
        summary: "A yes/no branch; tell the AI what should be true for the “yes” path (often using trigger or fetched data).",
        attributes: [
          "if / only when / branch",
          "yes vs no path",
          "checking sentiment, status, or fields from earlier steps",
        ],
        examplePrompt:
          "Only send the email on the yes branch if sentiment is angry; otherwise skip it.",
      },
      {
        id: "delay",
        title: "Delay",
        iconKey: "delay",
        summary: "Pause before the next step; say how long to wait in plain language.",
        attributes: [
          "wait, pause, delay",
          "minutes, hours, or a duration the AI can interpret",
        ],
        examplePrompt:
          "After the session closes, wait 10 minutes, then send the follow-up email.",
      },
    ],
  },
  {
    id: "actions",
    title: "Actions",
    items: [
      {
        id: "getSessions",
        title: "getSessions",
        iconKey: "getSessions",
        summary: "Load sessions from the inbox; describe filters in everyday words (who, mood, how many).",
        attributes: [
          "fetch / list sessions",
          "filter by customer, sentiment, status",
          "limit (how many)",
          "newest first / sort order",
        ],
        examplePrompt:
          "Get the five most recent closed sessions where sentiment was angry.",
      },
      {
        id: "getMessages",
        title: "getMessages",
        iconKey: "getMessages",
        summary: "Load messages for a session; mention the session id or “this session’s conversation”.",
        attributes: [
          "messages / conversation / transcript",
          "sessionId",
          "how many messages, order (latest first)",
        ],
        examplePrompt:
          "Pull the last 20 messages for this session and use the latest customer reply in the Slack alert.",
      },
      {
        id: "sendEmail",
        title: "sendEmail",
        iconKey: "sendEmail",
        summary: "Send email; say who it’s to, subject, and what the body should say.",
        attributes: [
          "to (email address)",
          "subject line",
          "body (plain text)",
        ],
        examplePrompt:
          "Email ops@company.com with subject 'Needs review' and the customer name and session id in the body.",
      },
      {
        id: "sendSlackChannelMessage",
        title: "sendSlackChannelMessage",
        iconKey: "sendSlackChannelMessage",
        summary: "Post to Slack; name the channel and the message text you want.",
        attributes: [
          "channel name (e.g. alerts, support-alerts) or #channel",
          "message text",
        ],
        examplePrompt:
          "Post to #support-alerts: 'Angry session closed for [customer] — session [id].'",
      },
    ],
  },
];

export function itemMatchesQuery(item: SdkReferenceItem, q: string): boolean {
  if (!q.trim()) return true;
  const needle = q.trim().toLowerCase();
  const hay = [
    item.id,
    item.title,
    item.summary,
    item.examplePrompt,
    ...item.attributes,
  ]
    .join(" ")
    .toLowerCase();
  return hay.includes(needle);
}

export function filterSdkReferenceSections(
  sections: SdkReferenceSection[],
  query: string,
): SdkReferenceSection[] {
  return sections
    .map((section) => ({
      ...section,
      items: section.items.filter((item) => itemMatchesQuery(item, query)),
    }))
    .filter((section) => section.items.length > 0);
}
