-- Compatible with the shared LifeFlow audit table; no Housing/Map dependencies.
CREATE SCHEMA IF NOT EXISTS audit;
CREATE TABLE IF NOT EXISTS audit.tool_calls (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tool_name text NOT NULL,
  actor_id text,
  request_id text,
  input_summary jsonb NOT NULL DEFAULT '{}'::jsonb,
  result_status text NOT NULL CHECK (result_status IN ('success', 'error')),
  duration_ms integer NOT NULL CHECK (duration_ms >= 0),
  error_code text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS tool_calls_created_idx ON audit.tool_calls (created_at DESC);
