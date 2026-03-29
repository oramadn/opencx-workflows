import type {
  AuthorRole,
  Sentiment,
  SessionDetail,
  SessionMessage,
  SessionSummary,
} from "@/types/session";

async function parseJson<T>(res: Response): Promise<T> {
  const data = (await res.json()) as T;
  return data;
}

export async function listSessions(): Promise<SessionSummary[]> {
  const res = await fetch("/api/sessions");
  if (!res.ok) throw new Error("Failed to load sessions");
  return parseJson<SessionSummary[]>(res);
}

export async function createSession(
  customerName?: string,
): Promise<SessionSummary> {
  const res = await fetch("/api/sessions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(
      customerName ? { customerName } : {},
    ),
  });
  if (!res.ok) throw new Error("Failed to create session");
  return parseJson<SessionSummary>(res);
}

export async function getSession(id: string): Promise<SessionDetail> {
  const res = await fetch(`/api/sessions/${id}`);
  if (res.status === 404) throw new Error("Session not found");
  if (!res.ok) throw new Error("Failed to load session");
  return parseJson<SessionDetail>(res);
}

export async function postMessage(
  sessionId: string,
  authorRole: AuthorRole,
  body: string,
): Promise<SessionMessage> {
  const res = await fetch(`/api/sessions/${sessionId}/messages`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ authorRole, body }),
  });
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(err.error ?? "Failed to send message");
  }
  return parseJson<SessionMessage>(res);
}

export async function closeSession(
  sessionId: string,
  sentiment: Sentiment,
): Promise<SessionSummary> {
  const res = await fetch(`/api/sessions/${sessionId}/close`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sentiment }),
  });
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(err.error ?? "Failed to close session");
  }
  return parseJson<SessionSummary>(res);
}
