-- Website form submissions, kept so the dashboard can list and manage them.
-- Shared across clients like the other tables here: every query filters by
-- client_id. Additive and safe to run more than once.

CREATE TABLE IF NOT EXISTS form_submissions (
  id          TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  client_id   TEXT NOT NULL,
  -- 'contact' or 'application'; anything else a site sends is kept as 'other'
  kind        TEXT NOT NULL DEFAULT 'other',
  form_slug   TEXT,
  form_title  TEXT NOT NULL,
  -- Lifted out of the fields so the list can show and search them directly
  name        TEXT,
  email       TEXT,
  phone       TEXT,
  -- Everything that was submitted: JSON array of { label, name, value }
  fields      TEXT NOT NULL,
  page_path   TEXT,
  -- new | in_progress | done | archived
  status      TEXT NOT NULL DEFAULT 'new',
  notes       TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_form_submissions_client_created
  ON form_submissions (client_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_form_submissions_client_status
  ON form_submissions (client_id, status);

-- Attachments (résumés) live apart from the submission so that listing
-- submissions never has to read megabytes of file content.
CREATE TABLE IF NOT EXISTS form_submission_files (
  id            TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  submission_id TEXT NOT NULL REFERENCES form_submissions (id) ON DELETE CASCADE,
  client_id     TEXT NOT NULL,
  filename      TEXT NOT NULL,
  content_type  TEXT,
  size          INTEGER NOT NULL DEFAULT 0,
  content       BLOB NOT NULL,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_form_submission_files_submission
  ON form_submission_files (submission_id);
