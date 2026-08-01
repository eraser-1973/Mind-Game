CREATE TABLE game_runs (
  session_id TEXT PRIMARY KEY,
  start_event_id TEXT NOT NULL UNIQUE,
  current_stage TEXT NOT NULL CHECK (
    current_stage IN ('T1', 'T1_COMPLETE', 'T2', 'T3', 'DECISION')
  ),
  duration_sec INTEGER NOT NULL CHECK (duration_sec = 900),
  points_total INTEGER NOT NULL CHECK (points_total = 5),
  points_remaining INTEGER NOT NULL CHECK (
    points_remaining BETWEEN 0 AND points_total
  ),
  last_sequence_no INTEGER NOT NULL DEFAULT 0 CHECK (last_sequence_no >= 0),
  started_at TEXT NOT NULL,
  deadline_at TEXT NOT NULL,
  time_expired_at TEXT,
  t1_completed_at TEXT,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (session_id) REFERENCES sessions(session_id) ON DELETE CASCADE,
  CHECK (deadline_at > started_at)
);

CREATE INDEX game_runs_deadline_idx ON game_runs (deadline_at);

CREATE TABLE stage_ratings (
  rating_id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL UNIQUE,
  session_id TEXT NOT NULL,
  candidate_id TEXT NOT NULL CHECK (candidate_id IN ('A', 'B', 'C', 'D', 'E')),
  stage TEXT NOT NULL CHECK (stage IN ('T1', 'T2', 'T3')),
  rating_value INTEGER NOT NULL CHECK (
    typeof(rating_value) = 'integer' AND rating_value BETWEEN 0 AND 100
  ),
  evidence_ids_seen TEXT NOT NULL CHECK (
    json_valid(evidence_ids_seen)
    AND json_type(evidence_ids_seen) = 'array'
    AND (stage <> 'T1' OR json_array_length(evidence_ids_seen) = 0)
  ),
  client_submitted_at TEXT NOT NULL,
  server_submitted_at TEXT NOT NULL,
  sequence_no INTEGER NOT NULL CHECK (sequence_no >= 1),
  FOREIGN KEY (session_id) REFERENCES sessions(session_id) ON DELETE CASCADE,
  UNIQUE (session_id, candidate_id, stage),
  UNIQUE (session_id, sequence_no)
);

CREATE INDEX stage_ratings_session_stage_idx
ON stage_ratings (session_id, stage);

CREATE INDEX stage_ratings_session_candidate_idx
ON stage_ratings (session_id, candidate_id);

CREATE TRIGGER stage_ratings_no_update
BEFORE UPDATE ON stage_ratings
BEGIN
  SELECT RAISE(ABORT, 'sealed stage ratings cannot be updated');
END;

CREATE TABLE stage_choices (
  choice_id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL UNIQUE,
  session_id TEXT NOT NULL,
  stage TEXT NOT NULL CHECK (stage IN ('T1', 'T2', 'T3', 'final')),
  candidate_id TEXT NOT NULL CHECK (candidate_id IN ('A', 'B', 'C', 'D', 'E')),
  confidence INTEGER NOT NULL CHECK (
    typeof(confidence) = 'integer' AND confidence BETWEEN 0 AND 100
  ),
  submit_mode TEXT NOT NULL CHECK (submit_mode = 'active'),
  client_submitted_at TEXT NOT NULL,
  server_submitted_at TEXT NOT NULL,
  sequence_no INTEGER NOT NULL CHECK (sequence_no >= 1),
  FOREIGN KEY (session_id) REFERENCES sessions(session_id) ON DELETE CASCADE,
  UNIQUE (session_id, stage),
  UNIQUE (session_id, sequence_no)
);

CREATE INDEX stage_choices_session_stage_idx
ON stage_choices (session_id, stage);

CREATE TRIGGER stage_choices_no_update
BEFORE UPDATE ON stage_choices
BEGIN
  SELECT RAISE(ABORT, 'sealed stage choices cannot be updated');
END;

CREATE TABLE game_events (
  event_id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  event_type TEXT NOT NULL CHECK (
    event_type IN (
      'game_start', 'rating_submit', 'stage_choice_submit', 'timer_expired'
    )
  ),
  candidate_id TEXT CHECK (
    candidate_id IS NULL OR candidate_id IN ('A', 'B', 'C', 'D', 'E')
  ),
  stage TEXT CHECK (
    stage IS NULL OR stage IN ('T1', 'T1_COMPLETE', 'T2', 'T3', 'DECISION', 'final')
  ),
  client_sequence INTEGER CHECK (
    client_sequence IS NULL OR client_sequence >= 0
  ),
  server_sequence INTEGER NOT NULL CHECK (server_sequence >= 1),
  client_at TEXT NOT NULL,
  server_at TEXT NOT NULL,
  payload_json TEXT NOT NULL CHECK (
    json_valid(payload_json) AND json_type(payload_json) = 'object'
  ),
  FOREIGN KEY (session_id) REFERENCES sessions(session_id) ON DELETE CASCADE,
  UNIQUE (session_id, server_sequence)
);

CREATE INDEX game_events_session_sequence_idx
ON game_events (session_id, server_sequence);

UPDATE app_metadata
SET value = '4',
    updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE key = 'schema_version';
