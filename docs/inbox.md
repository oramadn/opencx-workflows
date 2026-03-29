# Inbox (sessions) prototype

This document describes the **inbox** feature shipped so far: a support-session metaphor where one person plays **customer** and **agent** in the same thread, closes sessions with **manual sentiment**, and persists everything in Postgres behind a small Express API.

Use this file for product and technical context when changing inbox UI, session APIs, or `session_messages` schema.

## Product behavior

- A **session** is one conversation. The UI lists sessions (sorted by `updated_at`); opening one loads its messages.
- The user sends messages as **Customer** or **Agent** (toggle). Messages are stored with `author_role` `customer` | `agent`. UI copy says **Agent**, not “support.”
- **Close session** opens a modal: pick sentiment **happy** | **neutral** | **angry** (no LLM). The API sets `sessions.status = 'closed'` and `sessions.sentiment`.
- After close, the thread is **read-only** (no composer).
- **New session** creates a row with default `customer_name` `"Customer"` unless extended later.
- The app **polls** the list and active session detail on an interval (~4s) for simplicity (no WebSockets).

## Layout (frontend)

- **Far left:** `NavRail` — links to `/inbox` and `/workflows` (placeholder).
- **Inner left:** Session list + new-session control.
- **Main:** Header (title, status, close when open), scrollable message thread, footer composer when open.

Key paths:

| Area | Location |
|------|----------|
| Inbox page | `packages/frontend/src/pages/inbox-page.tsx` |
| Close + sentiment modal | `packages/frontend/src/components/close-session-modal.tsx` |
| Shell + nav | `packages/frontend/src/components/app-shell.tsx`, `nav-rail.tsx` |
| API client | `packages/frontend/src/api/sessions.ts` |
| DTO types | `packages/frontend/src/types/session.ts` |
| Routes | `packages/frontend/src/App.tsx` (`/inbox`, `/workflows`) |

Dev server proxies **`/api`** to the backend (`vite.config.ts` → `http://localhost:3001`).

## Data model

Defined in Docker init SQL (runs on **first** empty DB volume only):

- **`sessions`** (`01-schema.sql`): `id`, `customer_name`, `status` (`open` \| `closed`), `sentiment` (nullable until close), timestamps.
- **`session_messages`** (`02-session-messages.sql`): `id`, `session_id` → `sessions`, `author_role` (`customer` \| `agent`), `body`, `created_at`. Index on `(session_id, created_at)`. Trigger bumps `sessions.updated_at` on new message.

Existing volumes need a manual migration or `docker compose down -v` + recreate to pick up new init files.

## REST API

Base path: **`/api/sessions`** (JSON). Backend: `packages/backend/src/routes/sessions.ts`, port **3001** by default (`PORT`), `DATABASE_URL` overrides default Postgres URL.

| Method | Path | Body | Notes |
|--------|------|------|--------|
| `GET` | `/api/sessions` | — | List sessions, newest activity first |
| `POST` | `/api/sessions` | `{ customerName?: string }` | Optional name; default `"Customer"` |
| `GET` | `/api/sessions/:id` | — | `{ session, messages[] }` |
| `POST` | `/api/sessions/:id/messages` | `{ authorRole, body }` | `authorRole` must be `customer` or `agent`; `body` trimmed, max 10k chars; **409** if session closed |
| `PATCH` | `/api/sessions/:id/close` | `{ sentiment }` | `happy` \| `neutral` \| `angry`; **409** if already closed |

Errors return JSON `{ error: string }` where implemented.

## Local run

1. Postgres: `docker compose up -d` from repo root.
2. Ensure schema includes `session_messages` (see Data model).
3. API: `pnpm backend:dev` from repo root.
4. UI: `pnpm frontend` from repo root.

## Intentional non-goals (so far)

- No workflow execution on `session.closed` (Graphile Worker not wired to this event yet).
- No auth, no real customer identity, no LLM sentiment.
- No WebSocket / SSE; polling only.

## Related repo rules

Commit and scope conventions for fullstack work: root **`.cursorrules`** (Git commits section).
