PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS sessions (
  session_id TEXT PRIMARY KEY,
  participant_id TEXT NOT NULL,
  mode TEXT NOT NULL CHECK (mode = 'formal'),
  status TEXT NOT NULL CHECK (status IN ('in_progress','completed','abandoned','technical_error')),
  schema_version TEXT NOT NULL,
  app_version TEXT NOT NULL,
  started_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  last_heartbeat_at TEXT,
  completed_at TEXT,
  submission_type TEXT,
  final_candidate_id TEXT,
  final_confidence INTEGER CHECK (final_confidence BETWEEN 0 AND 100),
  invalid_for_assessment INTEGER NOT NULL DEFAULT 0,
  invalid_reason TEXT,
  recovery_token_hash TEXT NOT NULL,
  final_payload_json TEXT
);

CREATE TABLE IF NOT EXISTS events (
  event_id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  candidate_id TEXT,
  stage TEXT,
  occurred_at TEXT NOT NULL,
  elapsed_sec INTEGER,
  payload_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (session_id) REFERENCES sessions(session_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS stage_snapshots (
  snapshot_id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  stage TEXT NOT NULL CHECK (stage IN ('T1','T2','T3','FINAL')),
  preferred_candidate_id TEXT NOT NULL,
  confidence INTEGER NOT NULL CHECK (confidence BETWEEN 0 AND 100),
  submitted_at TEXT NOT NULL,
  payload_json TEXT,
  FOREIGN KEY (session_id) REFERENCES sessions(session_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS client_errors (
  error_id TEXT PRIMARY KEY,
  session_id TEXT,
  error_type TEXT NOT NULL,
  message TEXT NOT NULL,
  stack TEXT,
  route TEXT,
  occurred_at TEXT NOT NULL,
  app_version TEXT NOT NULL,
  fatal INTEGER NOT NULL,
  affected_assessment INTEGER NOT NULL,
  payload_json TEXT,
  FOREIGN KEY (session_id) REFERENCES sessions(session_id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_events_session_id ON events(session_id);
CREATE INDEX IF NOT EXISTS idx_snapshots_session_id ON stage_snapshots(session_id);
CREATE INDEX IF NOT EXISTS idx_sessions_status ON sessions(status);
CREATE INDEX IF NOT EXISTS idx_sessions_updated_at ON sessions(updated_at);
CREATE INDEX IF NOT EXISTS idx_sessions_last_heartbeat_at ON sessions(last_heartbeat_at);
