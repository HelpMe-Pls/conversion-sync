CREATE TABLE IF NOT EXISTS sync_log (
  event_id   TEXT PRIMARY KEY,
  deal_id    TEXT NOT NULL,
  status     TEXT NOT NULL CHECK (status IN ('sent', 'failed', 'skipped_no_email')),
  detail     TEXT,
  updated_at TEXT NOT NULL
);
