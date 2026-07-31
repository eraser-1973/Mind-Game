CREATE TABLE configuration_sets (
  config_set_id TEXT PRIMARY KEY,
  task_version TEXT NOT NULL,
  material_version TEXT NOT NULL,
  point_rule_version TEXT NOT NULL,
  scoring_version TEXT NOT NULL,
  benchmark_version TEXT NOT NULL,
  norm_version TEXT,
  status TEXT NOT NULL CHECK (status IN ('draft', 'published', 'retired')),
  is_active INTEGER NOT NULL CHECK (is_active IN (0, 1)),
  created_at TEXT NOT NULL,
  published_at TEXT,
  CHECK (is_active = 0 OR status = 'published')
);

CREATE UNIQUE INDEX configuration_sets_one_active_idx
ON configuration_sets (is_active)
WHERE is_active = 1;

CREATE TABLE participants (
  participant_id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL
);

CREATE TABLE participant_identity (
  participant_id TEXT PRIMARY KEY,
  full_name TEXT,
  student_id TEXT,
  student_id_normalized TEXT,
  phone TEXT,
  phone_normalized TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (participant_id) REFERENCES participants(participant_id) ON DELETE CASCADE,
  CHECK (full_name IS NOT NULL OR student_id IS NOT NULL OR phone IS NOT NULL),
  CHECK (full_name IS NULL OR (length(trim(full_name)) BETWEEN 1 AND 100)),
  CHECK (student_id IS NULL OR (length(trim(student_id)) BETWEEN 1 AND 64)),
  CHECK (phone IS NULL OR length(trim(phone)) > 0)
);

CREATE INDEX participant_identity_student_id_idx
ON participant_identity (student_id_normalized);

CREATE INDEX participant_identity_phone_idx
ON participant_identity (phone_normalized);

CREATE TABLE sessions (
  session_id TEXT PRIMARY KEY,
  participant_id TEXT NOT NULL,
  creation_key TEXT NOT NULL UNIQUE,
  mode TEXT NOT NULL CHECK (mode = 'formal'),
  config_set_id TEXT NOT NULL,
  task_version TEXT NOT NULL,
  material_version TEXT NOT NULL,
  point_rule_version TEXT NOT NULL,
  scoring_version TEXT NOT NULL,
  benchmark_version TEXT NOT NULL,
  norm_version TEXT,
  candidate_display_order TEXT NOT NULL CHECK (
    json_valid(candidate_display_order)
    AND json_type(candidate_display_order) = 'array'
    AND json_array_length(candidate_display_order) = 5
  ),
  initial_opened_candidate TEXT NOT NULL CHECK (
    initial_opened_candidate IN ('A', 'B', 'C', 'D', 'E')
  ),
  completion_status TEXT NOT NULL CHECK (
    completion_status IN ('in_progress', 'completed', 'timeout', 'quit', 'error')
  ),
  current_step TEXT NOT NULL,
  final_submit_mode TEXT NOT NULL,
  client_version TEXT,
  duplicate_student_id INTEGER NOT NULL DEFAULT 0 CHECK (
    duplicate_student_id IN (0, 1)
  ),
  duplicate_phone INTEGER NOT NULL DEFAULT 0 CHECK (
    duplicate_phone IN (0, 1)
  ),
  prior_identity_match_count INTEGER NOT NULL DEFAULT 0 CHECK (
    prior_identity_match_count >= 0
  ),
  error_count INTEGER NOT NULL DEFAULT 0 CHECK (error_count >= 0),
  created_at TEXT NOT NULL,
  started_at TEXT,
  deadline_at TEXT,
  ended_at TEXT,
  FOREIGN KEY (participant_id) REFERENCES participants(participant_id) ON DELETE CASCADE,
  FOREIGN KEY (config_set_id) REFERENCES configuration_sets(config_set_id) ON DELETE RESTRICT
);

CREATE INDEX sessions_participant_id_idx ON sessions (participant_id);
CREATE INDEX sessions_completion_status_idx ON sessions (completion_status);
CREATE INDEX sessions_created_at_idx ON sessions (created_at);

CREATE TABLE session_credentials (
  session_id TEXT PRIMARY KEY,
  token_hash TEXT NOT NULL CHECK (length(token_hash) = 64),
  created_at TEXT NOT NULL,
  rotated_at TEXT NOT NULL,
  revoked_at TEXT,
  FOREIGN KEY (session_id) REFERENCES sessions(session_id) ON DELETE CASCADE
);

INSERT INTO configuration_sets (
  config_set_id,
  task_version,
  material_version,
  point_rule_version,
  scoring_version,
  benchmark_version,
  norm_version,
  status,
  is_active,
  created_at,
  published_at
) VALUES (
  'config-2026-07-v1',
  'task-1.0.0',
  'material-1.0.0',
  'points-5-v1',
  'RDI-2.0-prepilot',
  'benchmark-1.0.0',
  NULL,
  'published',
  1,
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
);

UPDATE app_metadata
SET value = '2',
    updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE key = 'schema_version';
