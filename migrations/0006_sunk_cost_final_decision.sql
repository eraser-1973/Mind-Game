CREATE TABLE sunk_cost_rules (
  sunk_cost_rule_version TEXT PRIMARY KEY,
  trigger_remaining_sec INTEGER NOT NULL CHECK (trigger_remaining_sec > 0),
  minimum_candidate_investment INTEGER NOT NULL CHECK (minimum_candidate_investment >= 0),
  requires_key_risk INTEGER NOT NULL CHECK (requires_key_risk IN (0, 1)),
  status TEXT NOT NULL CHECK (status IN ('published', 'retired')),
  created_at TEXT NOT NULL
);

INSERT INTO sunk_cost_rules (
  sunk_cost_rule_version, trigger_remaining_sec,
  minimum_candidate_investment, requires_key_risk, status, created_at
) VALUES (
  'sunk-1.0.0', 300, 2, 1, 'published',
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
);

ALTER TABLE configuration_sets
ADD COLUMN sunk_cost_rule_version TEXT NOT NULL DEFAULT 'sunk-1.0.0';

UPDATE configuration_sets
SET sunk_cost_rule_version = 'sunk-1.0.0'
WHERE config_set_id = 'config-2026-07-v1';

ALTER TABLE sessions
ADD COLUMN sunk_cost_rule_version TEXT NOT NULL DEFAULT 'sunk-1.0.0';

ALTER TABLE game_runs ADD COLUMN finalized_at TEXT;

CREATE TRIGGER configuration_sets_sunk_rule_exists_insert
BEFORE INSERT ON configuration_sets
WHEN NOT EXISTS (
  SELECT 1 FROM sunk_cost_rules
  WHERE sunk_cost_rule_version = NEW.sunk_cost_rule_version
)
BEGIN
  SELECT RAISE(ABORT, 'sunk cost rule does not exist');
END;

CREATE TRIGGER configuration_sets_sunk_rule_exists_update
BEFORE UPDATE OF sunk_cost_rule_version ON configuration_sets
WHEN NOT EXISTS (
  SELECT 1 FROM sunk_cost_rules
  WHERE sunk_cost_rule_version = NEW.sunk_cost_rule_version
)
BEGIN
  SELECT RAISE(ABORT, 'sunk cost rule does not exist');
END;

CREATE TRIGGER sessions_sunk_rule_exists_insert
BEFORE INSERT ON sessions
WHEN NOT EXISTS (
  SELECT 1 FROM sunk_cost_rules
  WHERE sunk_cost_rule_version = NEW.sunk_cost_rule_version
)
BEGIN
  SELECT RAISE(ABORT, 'sunk cost rule does not exist');
END;

CREATE TRIGGER sessions_sunk_rule_immutable
BEFORE UPDATE OF sunk_cost_rule_version ON sessions
WHEN NEW.sunk_cost_rule_version <> OLD.sunk_cost_rule_version
BEGIN
  SELECT RAISE(ABORT, 'session sunk cost rule is immutable');
END;

CREATE TABLE sunk_cost_events (
  sunk_event_id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL UNIQUE,
  show_event_id TEXT UNIQUE,
  choice_event_id TEXT UNIQUE,
  target_candidate_id TEXT CHECK (
    target_candidate_id IS NULL OR target_candidate_id IN ('A', 'B', 'C', 'D', 'E')
  ),
  trigger_rule_version TEXT NOT NULL,
  trigger_reason TEXT NOT NULL,
  risk_evidence_ids_seen TEXT NOT NULL CHECK (
    json_valid(risk_evidence_ids_seen)
    AND json_type(risk_evidence_ids_seen) = 'array'
  ),
  points_invested_before INTEGER NOT NULL CHECK (points_invested_before >= 0),
  points_remaining_at_show INTEGER CHECK (
    points_remaining_at_show IS NULL OR points_remaining_at_show >= 0
  ),
  shown_at TEXT,
  show_sequence_no INTEGER CHECK (show_sequence_no IS NULL OR show_sequence_no >= 1),
  choice TEXT CHECK (
    choice IS NULL OR choice IN ('continue', 'stop_loss', 'give_up', 'not_triggered')
  ),
  choice_client_at TEXT,
  choice_submitted_at TEXT,
  choice_sequence_no INTEGER CHECK (
    choice_sequence_no IS NULL OR choice_sequence_no >= 1
  ),
  points_remaining_at_choice INTEGER CHECK (
    points_remaining_at_choice IS NULL OR points_remaining_at_choice >= 0
  ),
  points_after_choice INTEGER CHECK (
    points_after_choice IS NULL OR points_after_choice >= 0
  ),
  choice_status TEXT NOT NULL CHECK (
    choice_status IN ('pending', 'answered', 'not_triggered', 'timeout_unanswered')
  ),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (session_id) REFERENCES sessions(session_id) ON DELETE CASCADE,
  FOREIGN KEY (trigger_rule_version)
    REFERENCES sunk_cost_rules(sunk_cost_rule_version) ON DELETE RESTRICT,
  CHECK (
    (choice_status = 'pending' AND shown_at IS NOT NULL AND choice IS NULL)
    OR (choice_status = 'answered' AND shown_at IS NOT NULL
      AND choice IN ('continue', 'stop_loss', 'give_up'))
    OR (choice_status = 'not_triggered' AND shown_at IS NULL
      AND choice = 'not_triggered')
    OR (choice_status = 'timeout_unanswered' AND shown_at IS NOT NULL
      AND choice IS NULL)
  )
);

CREATE INDEX sunk_cost_events_session_idx ON sunk_cost_events (session_id);
CREATE INDEX sunk_cost_events_target_candidate_idx
ON sunk_cost_events (target_candidate_id);

CREATE TRIGGER sunk_cost_show_fields_immutable
BEFORE UPDATE OF sunk_event_id, session_id, show_event_id,
  target_candidate_id, trigger_rule_version, trigger_reason,
  risk_evidence_ids_seen, points_invested_before, points_remaining_at_show,
  shown_at, show_sequence_no, created_at
ON sunk_cost_events
BEGIN
  SELECT RAISE(ABORT, 'sunk cost show fields are immutable');
END;

CREATE TRIGGER sunk_cost_choice_immutable
BEFORE UPDATE OF choice_event_id, choice, choice_client_at,
  choice_submitted_at, choice_sequence_no, points_remaining_at_choice
ON sunk_cost_events
WHEN OLD.choice_status <> 'pending'
BEGIN
  SELECT RAISE(ABORT, 'sunk cost choice is sealed');
END;

CREATE TABLE final_decisions (
  final_decision_id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL UNIQUE,
  session_id TEXT NOT NULL UNIQUE,
  candidate_id TEXT NOT NULL CHECK (candidate_id IN ('A', 'B', 'C', 'D', 'E')),
  confidence INTEGER NOT NULL CHECK (
    typeof(confidence) = 'integer' AND confidence BETWEEN 0 AND 100
  ),
  submit_mode TEXT NOT NULL CHECK (submit_mode IN ('active', 'timeout')),
  source_stage TEXT NOT NULL CHECK (source_stage IN ('T1', 'T2', 'T3')),
  selection_origin TEXT NOT NULL CHECK (
    selection_origin IN ('active_user', 'timeout_latest_sealed_choice')
  ),
  auto_selected INTEGER NOT NULL CHECK (auto_selected IN (0, 1)),
  client_submitted_at TEXT,
  server_submitted_at TEXT NOT NULL,
  sequence_no INTEGER NOT NULL CHECK (sequence_no >= 1),
  remaining_sec_at_submit INTEGER NOT NULL CHECK (remaining_sec_at_submit >= 0),
  points_remaining_at_submit INTEGER NOT NULL CHECK (points_remaining_at_submit >= 0),
  sunk_cost_choice TEXT CHECK (
    sunk_cost_choice IS NULL OR sunk_cost_choice IN (
      'continue', 'stop_loss', 'give_up', 'not_triggered'
    )
  ),
  created_at TEXT NOT NULL,
  FOREIGN KEY (session_id) REFERENCES sessions(session_id) ON DELETE CASCADE,
  UNIQUE (session_id, sequence_no),
  CHECK (
    (submit_mode = 'active' AND auto_selected = 0
      AND selection_origin = 'active_user' AND client_submitted_at IS NOT NULL)
    OR (submit_mode = 'timeout' AND auto_selected = 1
      AND selection_origin = 'timeout_latest_sealed_choice'
      AND client_submitted_at IS NULL)
  )
);

CREATE INDEX final_decisions_session_idx ON final_decisions (session_id);
CREATE INDEX final_decisions_server_submitted_idx
ON final_decisions (server_submitted_at);
CREATE INDEX final_decisions_submit_mode_idx ON final_decisions (submit_mode);

CREATE TRIGGER final_decisions_no_update
BEFORE UPDATE ON final_decisions
BEGIN
  SELECT RAISE(ABORT, 'final decisions cannot be updated');
END;

CREATE TRIGGER game_runs_finalized_at_immutable
BEFORE UPDATE OF finalized_at ON game_runs
WHEN OLD.finalized_at IS NOT NULL AND NEW.finalized_at <> OLD.finalized_at
BEGIN
  SELECT RAISE(ABORT, 'finalized game time is immutable');
END;

ALTER TABLE game_events RENAME TO game_events_v5;

CREATE TABLE game_events (
  event_id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  event_type TEXT NOT NULL CHECK (
    event_type IN (
      'game_start', 'rating_submit', 'stage_choice_submit',
      'evidence_unlock', 'timer_expired', 'sunk_cost_show',
      'sunk_cost_choice', 'final_submit'
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

INSERT INTO game_events (
  event_id, session_id, event_type, candidate_id, stage,
  client_sequence, server_sequence, client_at, server_at, payload_json
)
SELECT event_id, session_id, event_type, candidate_id, stage,
  client_sequence, server_sequence, client_at, server_at, payload_json
FROM game_events_v5;

DROP TABLE game_events_v5;

CREATE INDEX game_events_session_sequence_idx
ON game_events (session_id, server_sequence);

UPDATE app_metadata
SET value = '6', updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE key = 'schema_version';
