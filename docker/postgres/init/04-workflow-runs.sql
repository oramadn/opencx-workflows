-- Tracks durable workflow execution state for segment-based execution.
-- When a workflow contains delay nodes, the host-side graph walker saves
-- progress here and schedules resumption via graphile-worker.

CREATE TABLE IF NOT EXISTS workflow_runs (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  workflow_id UUID NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
  event       JSONB NOT NULL,
  context     JSONB NOT NULL DEFAULT '{}',
  resume_from TEXT,
  visited     TEXT[] NOT NULL DEFAULT '{}',
  status      TEXT NOT NULL DEFAULT 'running',
  error       TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
