import type {
  MessageResult,
  QueryOptions,
  SessionResult,
  WorkflowTools,
} from "../workflow-sdk.js";

function logQuery(noun: string, options?: QueryOptions): void {
  console.log(`[MOCK] ${noun} query:`, JSON.stringify(options ?? {}, null, 2));
}

export function createMockTools(): WorkflowTools {
  return {
    async getSessions(options?: QueryOptions): Promise<SessionResult[]> {
      logQuery("getSessions", options);
      return [
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
    },

    async getMessages(options?: QueryOptions): Promise<MessageResult[]> {
      logQuery("getMessages", options);
      return [
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
    },

    async sendEmail(to: string, subject: string, body: string): Promise<void> {
      console.log(`[MOCK] Email sent to=${to} subject="${subject}" body="${body}"`);
    },

    async sendSlackChannelMessage(
      channelName: string,
      message: string,
    ): Promise<void> {
      console.log(`[MOCK] Slack #${channelName}: "${message}"`);
    },
  };
}
