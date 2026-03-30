-- Add flow_graph column to workflows table for visual node-based representation
ALTER TABLE workflows ADD COLUMN IF NOT EXISTS flow_graph JSONB;
