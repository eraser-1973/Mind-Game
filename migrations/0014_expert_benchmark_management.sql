-- Stage 10B benchmark administration needs to keep expert panel ratings in a
-- draft without manufacturing provisional benchmark values.  The original
-- Stage 8 foreign key pointed at published candidate values, which made that
-- workflow impossible.  Draft expert scores now depend on the versioned
-- candidate policy matrix instead.

PRAGMA foreign_keys = OFF;

DROP TRIGGER benchmark_sets_formal_publish_update_guard;
DROP TRIGGER benchmark_expert_scores_published_no_insert;
DROP TRIGGER benchmark_expert_scores_published_no_update;
DROP TRIGGER benchmark_expert_scores_published_no_delete;
DROP TRIGGER analysis_expert_code_guard_insert;

CREATE TABLE benchmark_expert_scores_stage10b (
  expert_score_id TEXT PRIMARY KEY,
  benchmark_version TEXT NOT NULL,
  candidate_id TEXT NOT NULL CHECK (candidate_id IN ('A', 'B', 'C', 'D', 'E')),
  expert_code TEXT NOT NULL,
  score REAL NOT NULL CHECK (score BETWEEN 0 AND 100),
  submitted_at TEXT NOT NULL,
  FOREIGN KEY (benchmark_version, candidate_id)
    REFERENCES benchmark_candidate_policies(benchmark_version, candidate_id) ON DELETE RESTRICT,
  UNIQUE (benchmark_version, candidate_id, expert_code)
);

INSERT INTO benchmark_expert_scores_stage10b (
  expert_score_id, benchmark_version, candidate_id, expert_code, score, submitted_at
) SELECT expert_score_id, benchmark_version, candidate_id, expert_code, score, submitted_at
  FROM benchmark_expert_scores;

DROP TABLE benchmark_expert_scores;
ALTER TABLE benchmark_expert_scores_stage10b RENAME TO benchmark_expert_scores;

ALTER TABLE benchmark_sets ADD COLUMN write_token TEXT;
ALTER TABLE benchmark_sets ADD COLUMN published_at TEXT;

CREATE INDEX benchmark_expert_scores_version_expert_idx
ON benchmark_expert_scores (benchmark_version, expert_code, candidate_id);

CREATE TRIGGER benchmark_expert_scores_published_no_insert
BEFORE INSERT ON benchmark_expert_scores
WHEN EXISTS (SELECT 1 FROM benchmark_sets
  WHERE benchmark_version = NEW.benchmark_version AND status <> 'draft')
BEGIN SELECT RAISE(ABORT, 'published expert scores are immutable'); END;

CREATE TRIGGER benchmark_expert_scores_published_no_update
BEFORE UPDATE ON benchmark_expert_scores
WHEN EXISTS (SELECT 1 FROM benchmark_sets
  WHERE benchmark_version = OLD.benchmark_version AND status <> 'draft')
BEGIN SELECT RAISE(ABORT, 'published expert scores are immutable'); END;

CREATE TRIGGER benchmark_expert_scores_published_no_delete
BEFORE DELETE ON benchmark_expert_scores
WHEN EXISTS (SELECT 1 FROM benchmark_sets
  WHERE benchmark_version = OLD.benchmark_version AND status <> 'draft')
BEGIN SELECT RAISE(ABORT, 'published expert scores are immutable'); END;

CREATE TRIGGER analysis_expert_code_guard_insert
BEFORE INSERT ON benchmark_expert_scores
WHEN length(NEW.expert_code) NOT BETWEEN 3 AND 64
  OR NEW.expert_code GLOB '*[^A-Za-z0-9._-]*'
  OR NEW.expert_code LIKE '%@%'
  OR lower(NEW.expert_code) LIKE 'wxid[_]%'
  OR (length(NEW.expert_code) = 11 AND NEW.expert_code NOT GLOB '*[^0-9]*')
BEGIN SELECT RAISE(ABORT, 'expert code must be an anonymous internal code'); END;

CREATE TRIGGER benchmark_candidate_values_published_no_update
BEFORE UPDATE ON benchmark_candidate_values
WHEN EXISTS (SELECT 1 FROM benchmark_sets
  WHERE benchmark_version = OLD.benchmark_version AND status = 'published')
BEGIN SELECT RAISE(ABORT, 'published benchmark values are immutable'); END;

CREATE TRIGGER benchmark_sets_published_no_delete
BEFORE DELETE ON benchmark_sets
WHEN OLD.status = 'published'
BEGIN SELECT RAISE(ABORT, 'published benchmark sets are immutable'); END;

CREATE TRIGGER benchmark_sets_formal_publish_update_guard
BEFORE UPDATE OF status, source_type, is_provisional, expert_count ON benchmark_sets
WHEN NEW.status = 'published'
  AND NEW.source_type = 'expert_panel'
  AND NEW.is_provisional = 0
  AND (
    NEW.expert_count <= 0
    OR NEW.validated_at IS NULL
    OR (SELECT COUNT(*) FROM benchmark_candidate_values
        WHERE benchmark_version = NEW.benchmark_version) <> 5
    OR (SELECT COUNT(DISTINCT expert_code) FROM benchmark_expert_scores
        WHERE benchmark_version = NEW.benchmark_version) <> NEW.expert_count
    OR (SELECT COUNT(DISTINCT candidate_id) FROM benchmark_expert_scores
        WHERE benchmark_version = NEW.benchmark_version) <> 5
    OR (SELECT COUNT(*) FROM benchmark_expert_scores
        WHERE benchmark_version = NEW.benchmark_version) <> NEW.expert_count * 5
  )
BEGIN SELECT RAISE(ABORT, 'formal expert benchmark expert rows are incomplete'); END;

DROP INDEX admin_audit_logs_time_idx;
DROP INDEX admin_audit_logs_user_time_idx;
DROP INDEX admin_audit_logs_action_time_idx;
DROP INDEX admin_audit_logs_outcome_time_idx;
DROP INDEX admin_audit_logs_session_terminal_once_idx;

CREATE TABLE admin_audit_logs_stage10b (
  audit_id TEXT PRIMARY KEY,
  admin_user_id TEXT,
  admin_session_id TEXT,
  action TEXT NOT NULL CHECK (action IN (
    'admin_provisioned','admin_password_rotated','admin_login_success',
    'admin_login_failure','admin_login_rate_limited','admin_logout',
    'admin_session_revoked','admin_session_idle_expired',
    'admin_session_absolute_expired','admin_audit_logs_viewed',
    'material_set_created','material_set_updated','material_set_validated','material_set_published',
    'point_rule_created','point_rule_updated','point_rule_validated','point_rule_published',
    'sunk_cost_rule_created','sunk_cost_rule_updated','sunk_cost_rule_validated','sunk_cost_rule_published',
    'configuration_set_created','configuration_set_updated','configuration_set_validated',
    'configuration_set_published','configuration_set_activated','configuration_set_rollback_activated',
    'benchmark_set_created','benchmark_set_updated','benchmark_set_validated','benchmark_set_published'
  )),
  outcome TEXT NOT NULL CHECK (outcome IN ('success', 'failure', 'blocked')),
  target_type TEXT,
  target_id TEXT,
  request_id TEXT NOT NULL,
  client_fingerprint_hash TEXT CHECK (
    client_fingerprint_hash IS NULL OR (
      length(client_fingerprint_hash) = 64
      AND client_fingerprint_hash = lower(client_fingerprint_hash)
      AND client_fingerprint_hash NOT GLOB '*[^0-9a-f]*'
    )
  ),
  metadata_json TEXT NOT NULL CHECK (json_valid(metadata_json) AND json_type(metadata_json) = 'object'),
  created_at TEXT NOT NULL CHECK (julianday(created_at) IS NOT NULL),
  FOREIGN KEY (admin_user_id) REFERENCES admin_users(admin_user_id) ON DELETE RESTRICT,
  FOREIGN KEY (admin_session_id) REFERENCES admin_sessions(admin_session_id) ON DELETE RESTRICT
);

INSERT INTO admin_audit_logs_stage10b SELECT * FROM admin_audit_logs;
DROP TABLE admin_audit_logs;
ALTER TABLE admin_audit_logs_stage10b RENAME TO admin_audit_logs;

CREATE INDEX admin_audit_logs_time_idx ON admin_audit_logs (created_at);
CREATE INDEX admin_audit_logs_user_time_idx ON admin_audit_logs (admin_user_id, created_at);
CREATE INDEX admin_audit_logs_action_time_idx ON admin_audit_logs (action, created_at);
CREATE INDEX admin_audit_logs_outcome_time_idx ON admin_audit_logs (outcome, created_at);
CREATE UNIQUE INDEX admin_audit_logs_session_terminal_once_idx
ON admin_audit_logs (admin_session_id, action)
WHERE admin_session_id IS NOT NULL AND action IN (
  'admin_logout','admin_session_revoked','admin_session_idle_expired','admin_session_absolute_expired'
);

CREATE TRIGGER admin_audit_logs_no_update
BEFORE UPDATE ON admin_audit_logs
BEGIN SELECT RAISE(ABORT, 'admin audit logs cannot be updated'); END;

CREATE TRIGGER admin_audit_logs_no_delete
BEFORE DELETE ON admin_audit_logs
BEGIN SELECT RAISE(ABORT, 'admin audit logs cannot be deleted'); END;

PRAGMA foreign_keys = ON;

UPDATE app_metadata
SET value = '12', updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE key = 'schema_version';
