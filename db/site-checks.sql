-- Point-in-time checks of the live site, such as Google Lighthouse. Unlike
-- analytics these cannot be re-run for a past date, so each result is kept as
-- it was measured. Additive and safe to run more than once.

CREATE TABLE IF NOT EXISTS site_checks (
  id          TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  client_id   TEXT NOT NULL,
  -- 'lighthouse'
  kind        TEXT NOT NULL,
  data        TEXT NOT NULL,
  checked_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_site_checks_client_kind
  ON site_checks (client_id, kind, checked_at DESC);
