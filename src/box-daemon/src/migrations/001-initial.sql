PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS paired_clients (
  id                   TEXT PRIMARY KEY,
  name                 TEXT NOT NULL,
  token_hash           TEXT NOT NULL,
  previous_token_hash  TEXT,
  grace_expires_at     INTEGER,
  paired_at            INTEGER NOT NULL,
  last_seen            INTEGER,
  is_revoked           INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS process_events (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  process     TEXT NOT NULL,
  event       TEXT NOT NULL,
  exit_code   INTEGER,
  signal      TEXT,
  message     TEXT,
  created_at  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS access_log (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  client_id   TEXT NOT NULL,
  method      TEXT NOT NULL,
  path        TEXT NOT NULL,
  status      INTEGER NOT NULL,
  latency_ms  INTEGER NOT NULL,
  blocked_by  TEXT,
  created_at  INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_access_log_created ON access_log(created_at);
CREATE INDEX IF NOT EXISTS idx_process_events_created ON process_events(created_at);
CREATE INDEX IF NOT EXISTS idx_paired_clients_token ON paired_clients(token_hash);
