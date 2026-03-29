export type SessionStatus = "open" | "closed";

export type AuthorRole = "customer" | "agent";

export type Sentiment = "happy" | "neutral" | "angry";

export type SessionSummary = {
  id: string;
  customerName: string;
  customerEmail: string;
  status: SessionStatus;
  sentiment: string | null;
  createdAt: string;
  updatedAt: string;
};

export type SessionMessage = {
  id: string;
  sessionId: string;
  authorRole: AuthorRole;
  body: string;
  createdAt: string;
};

export type SessionDetail = {
  session: SessionSummary;
  messages: SessionMessage[];
};
