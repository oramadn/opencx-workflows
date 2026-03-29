export type SessionRow = {
  id: string;
  customer_name: string;
  status: string;
  sentiment: string | null;
  created_at: Date;
  updated_at: Date;
};

export type MessageRow = {
  id: string;
  session_id: string;
  author_role: string;
  body: string;
  created_at: Date;
};

export function sessionToJson(row: SessionRow) {
  return {
    id: row.id,
    customerName: row.customer_name,
    status: row.status,
    sentiment: row.sentiment,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

export function messageToJson(row: MessageRow) {
  return {
    id: row.id,
    sessionId: row.session_id,
    authorRole: row.author_role,
    body: row.body,
    createdAt: row.created_at.toISOString(),
  };
}
