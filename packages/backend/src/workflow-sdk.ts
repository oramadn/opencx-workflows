/**
 * Workflow SDK — Strict type contracts for AI-generated workflow code.
 *
 * This file is read as raw text and injected into the LLM system prompt so
 * the model treats these types as its "compiler instructions."  It is also
 * imported by backend code for runtime type safety.
 */

// ---------------------------------------------------------------------------
// Trigger Events — standard payloads the backend emits
// ---------------------------------------------------------------------------

export interface SessionClosedEvent {
  triggerType: "onSessionClosed";
  sessionId: string;
  customerName: string;
  customerEmail: string;
  sentiment: "happy" | "neutral" | "angry";
  createdAt: string;
}

export interface SessionOpenedEvent {
  triggerType: "onSessionOpened";
  sessionId: string;
  customerName: string;
  customerEmail: string;
  createdAt: string;
}

export type WorkflowEvent = SessionClosedEvent | SessionOpenedEvent;

export const VALID_TRIGGERS = ["onSessionClosed", "onSessionOpened"] as const;
export type TriggerType = (typeof VALID_TRIGGERS)[number];

export const VALID_TOOL_METHODS = [
  "getSessions",
  "getMessages",
  "sendEmail",
  "sendSlackChannelMessage",
] as const;
export type ToolMethod = (typeof VALID_TOOL_METHODS)[number];

// ---------------------------------------------------------------------------
// Generic query primitives — reusable across every domain noun
// ---------------------------------------------------------------------------

export interface WhereCondition {
  field: string;
  op: "eq" | "neq" | "in" | "gt" | "lt" | "gte" | "lte" | "like";
  value: unknown;
}

export interface QueryOptions {
  where?: WhereCondition[];
  limit?: number;
  orderBy?: { field: string; direction?: "asc" | "desc" };
}

// ---------------------------------------------------------------------------
// Typed result interfaces — one per domain noun
// ---------------------------------------------------------------------------

export interface SessionResult {
  id: string;
  customerName: string;
  customerEmail: string;
  status: string;
  sentiment: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface MessageResult {
  id: string;
  sessionId: string;
  authorRole: string;
  body: string;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// WorkflowTools — the ONLY functions the sandboxed code may call
// ---------------------------------------------------------------------------

export interface WorkflowTools {
  /**
   * Query sessions with optional filters.
   *
   * Examples:
   *   tools.getSessions({ where: [{ field: 'customerName', op: 'eq', value: 'Alice' }] })
   *   tools.getSessions({ where: [{ field: 'sentiment', op: 'in', value: ['angry','neutral'] }], limit: 5 })
   */
  getSessions(options?: QueryOptions): Promise<SessionResult[]>;

  /**
   * Query session messages with optional filters.
   *
   * Examples:
   *   tools.getMessages({ where: [{ field: 'sessionId', op: 'eq', value: id }], limit: 20 })
   */
  getMessages(options?: QueryOptions): Promise<MessageResult[]>;

  /**
   * Send an email alert.
   * @param to      Recipient email address.
   * @param subject Email subject line.
   * @param body    Plain-text email body.
   */
  sendEmail(to: string, subject: string, body: string): Promise<void>;

  /**
   * Send a message to a public Slack channel.
   * The bot must be invited to the target channel.
   * @param channelName Channel name without the # (e.g. 'alerts'), or a Slack channel ID.
   * @param message     Text content of the message.
   */
  sendSlackChannelMessage(
    channelName: string,
    message: string,
  ): Promise<void>;
}

// ---------------------------------------------------------------------------
// Flow Graph — visual representation of workflow logic for React Flow canvas
// ---------------------------------------------------------------------------

export type FlowNodeType = "trigger" | "condition" | "action" | "delay";

export interface FlowNodeDescriptor {
  id: string;
  type: FlowNodeType;
  label: string;
  code?: string;
  metadata?: Record<string, unknown>;
}

export interface FlowEdgeDescriptor {
  source: string;
  target: string;
  label?: string;
}

export interface FlowGraph {
  nodes: FlowNodeDescriptor[];
  edges: FlowEdgeDescriptor[];
}
