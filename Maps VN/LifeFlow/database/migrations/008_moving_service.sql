CREATE SCHEMA IF NOT EXISTS moving;

CREATE TABLE IF NOT EXISTS moving.quotes (
  id uuid PRIMARY KEY,
  request_fingerprint text NOT NULL,
  request_payload jsonb NOT NULL,
  quote_payload jsonb NOT NULL,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS moving_quotes_expires_at_idx ON moving.quotes (expires_at);

CREATE TABLE IF NOT EXISTS moving.approvals (
  id uuid PRIMARY KEY,
  action_type text NOT NULL CHECK (action_type IN ('create', 'update', 'cancel', 'rate')),
  payload_hash text NOT NULL CHECK (length(payload_hash) = 64),
  approved_by text NOT NULL,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS moving.order_actions (
  idempotency_key text PRIMARY KEY CHECK (length(idempotency_key) = 64),
  workflow_id text NOT NULL,
  action_id text NOT NULL,
  request_hash text NOT NULL CHECK (length(request_hash) = 64),
  status text NOT NULL CHECK (status IN ('pending', 'completed', 'failed')),
  provider_order_id text,
  response_payload jsonb,
  error_code text,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  UNIQUE (workflow_id, action_id)
);

CREATE TABLE IF NOT EXISTS moving.orders (
  provider_order_id text PRIMARY KEY,
  status text NOT NULL,
  order_payload jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS moving_orders_status_idx ON moving.orders (status);

CREATE TABLE IF NOT EXISTS moving.webhook_events (
  event_hash text PRIMARY KEY CHECK (length(event_hash) = 64),
  provider_order_id text NOT NULL,
  status text NOT NULL,
  event_payload jsonb NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS moving_webhook_order_idx
  ON moving.webhook_events (provider_order_id, received_at DESC);
