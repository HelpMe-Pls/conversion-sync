-- One sync-log row per (deal, destination), so a destination that failed is retried alone.
-- SQLite cannot change a primary key in place: rebuild the table and keep v0's rows as Meta's.
CREATE TABLE sync_log_new (
  event_id    TEXT NOT NULL,
  destination TEXT NOT NULL,
  deal_id     TEXT NOT NULL,
  status      TEXT NOT NULL CHECK (status IN ('sending', 'sent', 'failed', 'skipped_no_email', 'skipped_no_amount', 'skipped_too_old', 'rejected')),
  detail      TEXT,
  updated_at  TEXT NOT NULL,
  PRIMARY KEY (event_id, destination)
);

INSERT INTO sync_log_new (event_id, destination, deal_id, status, detail, updated_at)
  SELECT event_id, 'meta', deal_id, status, detail, updated_at FROM sync_log;

DROP TABLE sync_log;

ALTER TABLE sync_log_new RENAME TO sync_log;
