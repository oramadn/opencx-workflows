# Workflows (prototype)

pnpm monorepo: **Express + Postgres** backend, **Vite + React** frontend, optional **Workflow DevKit** with the Postgres world (same database). Runs entirely **locally**—see [`.cursorrules`](.cursorrules) for product goals and architecture.

## Prerequisites

- **Docker** (for PostgreSQL)
- **Node.js** (current LTS is fine)
- **pnpm** (`packageManager` in root `package.json` pins a version; use `corepack enable` if needed)

## First-time setup

From the **repository root**:

### 1. Install JavaScript dependencies

```bash
pnpm install
```

### 2. Start PostgreSQL

```bash
docker compose up -d
```

Default database: **`workflows`**, user **`postgres`**, password **`password`**, port **`5432`**.

On the **first** start with an **empty** data volume, scripts in `docker/postgres/init/` run automatically (`01-schema.sql`, `02-session-messages.sql`). If you already had an old volume or the init SQL changed (e.g. `trigger_events` column update), reset data:

```bash
docker compose down -v   # destructive: deletes the Docker volume
docker compose up -d
```

### 3. Backend environment

```bash
cp packages/backend/.env.example packages/backend/.env
```

Edit `packages/backend/.env` if your Postgres URL or ports differ. Variables:

| Variable | Purpose |
|----------|---------|
| `DATABASE_URL` | App DB connection (Express + `pg`) |
| `OPENAI_API_KEY` | **Required** for the workflow builder's LLM generation pipeline (get one from [platform.openai.com](https://platform.openai.com/api-keys)) |
| `WORKFLOW_TARGET_WORLD` | Set to `@workflow/world-postgres` when using Workflow DevKit |
| `WORKFLOW_POSTGRES_URL` | Workflow / queue DB (defaults to `DATABASE_URL` if unset) |
| `E2B_API_KEY` | **When workflow execution is implemented:** [E2B](https://e2b.dev/) API key (Hobby tier includes credits). See [docs/workflow-builder.md](docs/workflow-builder.md). |
| `RESEND_API_KEY` | [Resend](https://resend.com/) API key for the `sendEmail` workflow tool. Without it, `sendEmail` falls back to a console.log stub. |
| `RESEND_FROM_EMAIL` | Sender address for workflow emails (defaults to `onboarding@resend.dev`, Resend's built-in test sender). |
| `SLACK_BOT_TOKEN` | [Slack](https://api.slack.com/apps) Bot User OAuth Token (`xoxb-...`) for the `sendSlackChannelMessage` workflow tool. Without it, the tool falls back to a console.log stub. The bot must be invited to any channel it posts to. |

### 4. Workflow DevKit schema (Postgres world)

**One-time** (idempotent; safe to re-run after DB is up and `.env` is loaded):

```bash
pnpm workflow:postgres-setup
```

This adds the **`workflow`** and **`graphile_worker`** schemas (and related objects). App tables stay in **`public`**. In `psql`, use `\dt public.*`, `\dt workflow.*`, and `\dt graphile_worker.*`—plain `\dt` only shows `public` by default.

Workflow runtime is **not** started by Express yet; this step only prepares the database.

### 5. Optional: pnpm build scripts

If installs warn about ignored **native/build scripts** and something fails at runtime, from the repo root:

```bash
pnpm approve-builds
pnpm install
```

## Run the project (daily)

Use **three terminals** from the repo root (Postgres container already running).

| What | Command |
|------|---------|
| API (default **3001**) | `pnpm backend:dev` |
| UI (Vite, default **5173**) | `pnpm frontend` |

The Vite dev server **proxies** `/api` to `http://localhost:3001` (see `packages/frontend/vite.config.ts`).

- **Inbox / sessions UI:** [http://localhost:5173/inbox](http://localhost:5173/inbox)  
- **Workflow builder:** [http://localhost:5173/workflows](http://localhost:5173/workflows)  
- **API:** e.g. `GET http://localhost:3001/api/sessions`, `GET http://localhost:3001/api/workflows`  

Product and API details: **[docs/inbox.md](docs/inbox.md)**.

### Workflow builder API

| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/api/workflows` | List all workflows |
| `GET` | `/api/workflows/:id` | Get a single workflow (includes generated code) |
| `POST` | `/api/workflows/generate` | Generate or refine a workflow via LLM (`{ prompt, workflowId? }`) |

## Root scripts (reference)

| Script | Description |
|--------|-------------|
| `pnpm install` | Install all workspace dependencies |
| `pnpm lint` / `pnpm lint:fix` | ESLint |
| `pnpm backend` | Run backend once (no watch) |
| `pnpm backend:dev` | Backend with watch |
| `pnpm frontend` | Vite dev server |
| `pnpm frontend:build` | Production build |
| `pnpm frontend:preview` | Preview production build |
| `pnpm workflow:postgres-setup` | Apply Workflow DevKit Postgres migrations |

## Troubleshooting

- **Port 5432 in use:** change the host mapping in `docker-compose.yml` (e.g. `5433:5432`) and update `DATABASE_URL` / `WORKFLOW_POSTGRES_URL`.
- **Backend cannot connect:** ensure `docker compose ps` shows Postgres healthy and `packages/backend/.env` matches.
- **CORS:** backend allows `http://localhost:5173` and `http://127.0.0.1:5173` in dev.
