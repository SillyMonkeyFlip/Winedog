-- WineDog database schema (Cloudflare D1 / SQLite)

CREATE TABLE IF NOT EXISTS accounts (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  email         TEXT NOT NULL UNIQUE COLLATE NOCASE,
  name          TEXT NOT NULL DEFAULT '',
  role          TEXT NOT NULL DEFAULT 'Normal' CHECK (role IN ('Normal', 'Special')),
  code          TEXT NOT NULL,
  notes         TEXT NOT NULL DEFAULT '',
  disabled      INTEGER NOT NULL DEFAULT 0,
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL,
  last_login_at INTEGER,
  code_sent_at  INTEGER
);

CREATE TABLE IF NOT EXISTS sessions (
  id           TEXT PRIMARY KEY,
  account_id   INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  token_hash   TEXT NOT NULL UNIQUE,
  created_at   INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL,
  user_agent   TEXT NOT NULL DEFAULT '',
  ip           TEXT NOT NULL DEFAULT '',
  location     TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS sessions_account ON sessions(account_id);

CREATE TABLE IF NOT EXISTS admin_sessions (
  token_hash TEXT PRIMARY KEY,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS rate_limits (
  key      TEXT PRIMARY KEY,
  count    INTEGER NOT NULL,
  reset_at INTEGER NOT NULL
);
