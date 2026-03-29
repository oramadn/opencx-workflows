import express, { type Request, type Response } from "express";
import { pool } from "../db.js";
import {
  type SessionRow,
  type MessageRow,
  sessionToJson,
  messageToJson,
} from "../lib/row-mappers.js";
import { dispatchTrigger } from "../services/workflow-dispatcher.js";

const MAX_BODY_LEN = 10_000;

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isUuid(s: string): boolean {
  return UUID_RE.test(s);
}

export function sessionsRouter(): express.Router {
  const r = express.Router();

  r.get("/", async (_req: Request, res: Response) => {
    const { rows } = await pool.query<SessionRow>(
      `SELECT id, customer_name, customer_email, status, sentiment, created_at, updated_at
       FROM sessions
       ORDER BY updated_at DESC`,
    );
    res.json(rows.map(sessionToJson));
  });

  r.post("/", async (req: Request, res: Response) => {
    const rawName = req.body?.customerName;
    const customerName =
      typeof rawName === "string" && rawName.trim() !== ""
        ? rawName.trim().slice(0, 255)
        : "Customer";

    const rawEmail = req.body?.customerEmail;
    if (typeof rawEmail !== "string" || rawEmail.trim() === "") {
      res.status(400).json({ error: "customerEmail is required" });
      return;
    }
    const customerEmail = rawEmail.trim().slice(0, 255);

    const { rows } = await pool.query<SessionRow>(
      `INSERT INTO sessions (customer_name, customer_email)
       VALUES ($1, $2)
       RETURNING id, customer_name, customer_email, status, sentiment, created_at, updated_at`,
      [customerName, customerEmail],
    );
    const session = rows[0]!;
    res.status(201).json(sessionToJson(session));

    void dispatchTrigger("onSessionOpened", {
      triggerType: "onSessionOpened",
      sessionId: session.id,
      customerName: session.customer_name,
      customerEmail: session.customer_email,
      createdAt: session.created_at.toISOString(),
    }).catch((err) =>
      console.error("[dispatch] onSessionOpened failed:", err),
    );
  });

  r.get("/:id", async (req: Request, res: Response) => {
    const { id } = req.params;
    if (!id || !isUuid(id)) {
      res.status(400).json({ error: "Invalid session id" });
      return;
    }

    const sessionResult = await pool.query<SessionRow>(
      `SELECT id, customer_name, customer_email, status, sentiment, created_at, updated_at
       FROM sessions WHERE id = $1`,
      [id],
    );
    if (sessionResult.rowCount === 0) {
      res.status(404).json({ error: "Session not found" });
      return;
    }

    const msgResult = await pool.query<MessageRow>(
      `SELECT id, session_id, author_role, body, created_at
       FROM session_messages
       WHERE session_id = $1
       ORDER BY created_at ASC`,
      [id],
    );

    res.json({
      session: sessionToJson(sessionResult.rows[0]!),
      messages: msgResult.rows.map(messageToJson),
    });
  });

  r.post("/:id/messages", async (req: Request, res: Response) => {
    const { id } = req.params;
    if (!id || !isUuid(id)) {
      res.status(400).json({ error: "Invalid session id" });
      return;
    }

    const authorRole = req.body?.authorRole;
    const bodyRaw = req.body?.body;

    if (authorRole !== "customer" && authorRole !== "agent") {
      res.status(400).json({ error: "authorRole must be 'customer' or 'agent'" });
      return;
    }
    if (typeof bodyRaw !== "string") {
      res.status(400).json({ error: "body must be a string" });
      return;
    }
    const body = bodyRaw.trim();
    if (body.length === 0) {
      res.status(400).json({ error: "body must not be empty" });
      return;
    }
    if (body.length > MAX_BODY_LEN) {
      res.status(400).json({ error: `body must be at most ${MAX_BODY_LEN} characters` });
      return;
    }

    const sessionResult = await pool.query<{ status: string }>(
      `SELECT status FROM sessions WHERE id = $1`,
      [id],
    );
    if (sessionResult.rowCount === 0) {
      res.status(404).json({ error: "Session not found" });
      return;
    }
    if (sessionResult.rows[0]!.status !== "open") {
      res.status(409).json({ error: "Session is closed" });
      return;
    }

    const { rows } = await pool.query<MessageRow>(
      `INSERT INTO session_messages (session_id, author_role, body)
       VALUES ($1, $2, $3)
       RETURNING id, session_id, author_role, body, created_at`,
      [id, authorRole, body],
    );
    res.status(201).json(messageToJson(rows[0]!));
  });

  r.patch("/:id/close", async (req: Request, res: Response) => {
    const { id } = req.params;
    if (!id || !isUuid(id)) {
      res.status(400).json({ error: "Invalid session id" });
      return;
    }

    const sentiment = req.body?.sentiment;
    if (
      sentiment !== "happy" &&
      sentiment !== "neutral" &&
      sentiment !== "angry"
    ) {
      res
        .status(400)
        .json({ error: "sentiment must be 'happy', 'neutral', or 'angry'" });
      return;
    }

    const { rows, rowCount } = await pool.query<SessionRow>(
      `UPDATE sessions
       SET status = 'closed', sentiment = $2, updated_at = CURRENT_TIMESTAMP
       WHERE id = $1 AND status = 'open'
       RETURNING id, customer_name, customer_email, status, sentiment, created_at, updated_at`,
      [id, sentiment],
    );

    if (rowCount === 0) {
      const exists = await pool.query(`SELECT 1 FROM sessions WHERE id = $1`, [
        id,
      ]);
      if (exists.rowCount === 0) {
        res.status(404).json({ error: "Session not found" });
        return;
      }
      res.status(409).json({ error: "Session is already closed" });
      return;
    }

    const session = rows[0]!;
    res.json(sessionToJson(session));

    void dispatchTrigger("onSessionClosed", {
      triggerType: "onSessionClosed",
      sessionId: session.id,
      customerName: session.customer_name,
      customerEmail: session.customer_email,
      sentiment: session.sentiment as "happy" | "neutral" | "angry",
      createdAt: session.created_at.toISOString(),
    }).catch((err) =>
      console.error("[dispatch] onSessionClosed failed:", err),
    );
  });

  return r;
}
