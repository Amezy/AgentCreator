-- Cloud communication tables

-- KV store for device configuration
CREATE TABLE device_config (
  key    TEXT PRIMARY KEY,
  value  TEXT NOT NULL
);

-- Command execution log (supports idempotency)
CREATE TABLE command_log (
  cmd_id      TEXT PRIMARY KEY,
  cmd_type    TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'pending',  -- pending | executing | success | failed | timeout
  request     TEXT NOT NULL,                     -- JSON of original request payload
  response    TEXT,                               -- JSON of response data (null until complete)
  error       TEXT,                               -- error message if failed
  created_at  INTEGER NOT NULL,                   -- Unix seconds
  updated_at  INTEGER NOT NULL                    -- Unix seconds
);
CREATE INDEX idx_command_log_created ON command_log(created_at);
CREATE INDEX idx_command_log_status ON command_log(status);

-- Users managed via cloud commands
CREATE TABLE managed_users (
  username    TEXT PRIMARY KEY,
  uid         INTEGER,
  status      TEXT NOT NULL DEFAULT 'active',    -- active | disabled | deleted
  created_at  INTEGER NOT NULL,                   -- Unix seconds
  updated_at  INTEGER NOT NULL                    -- Unix seconds
);
CREATE INDEX idx_managed_users_status ON managed_users(status);
