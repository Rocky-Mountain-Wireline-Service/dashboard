-- One snapshot per client per calendar month, written once the month is over.
-- `data` is the whole report as JSON, so the shape can grow without a
-- migration. Additive and safe to run more than once.
--
-- Separate from the agency's own monthly_reports table, which holds the
-- web team's written summary; the dashboard reads that one, never writes it.

CREATE TABLE IF NOT EXISTS site_reports (
  id            TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  client_id     TEXT NOT NULL,
  -- YYYY-MM
  month         TEXT NOT NULL,
  data          TEXT NOT NULL,
  generated_at  TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (client_id, month)
);

CREATE INDEX IF NOT EXISTS idx_site_reports_client_month
  ON site_reports (client_id, month DESC);
