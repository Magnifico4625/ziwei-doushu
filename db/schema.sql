-- PostgreSQL persistence schema for Zi Wei Dou Shu server routes

CREATE TABLE IF NOT EXISTS webhook_events (
  event_id TEXT PRIMARY KEY,
  provider TEXT,
  order_id TEXT,
  processed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_webhook_events_order_id
  ON webhook_events (order_id);

CREATE TABLE IF NOT EXISTS orders (
  order_id TEXT PRIMARY KEY,
  scope TEXT NOT NULL,
  target_key TEXT NOT NULL,
  status TEXT NOT NULL,
  amount_minor INTEGER,
  currency TEXT,
  provider TEXT,
  meta JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  paid_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_orders_scope_target_status
  ON orders (scope, target_key, status);

CREATE TABLE IF NOT EXISTS chart_interpretations (
  cache_key TEXT NOT NULL,
  topic_key TEXT NOT NULL DEFAULT 'default',
  content TEXT NOT NULL,
  provider TEXT,
  model TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (cache_key, topic_key)
);

CREATE TABLE IF NOT EXISTS synastry_interpretations (
  pair_key TEXT NOT NULL,
  question_hash TEXT NOT NULL DEFAULT '',
  content TEXT NOT NULL,
  provider TEXT,
  model TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (pair_key, question_hash)
);
