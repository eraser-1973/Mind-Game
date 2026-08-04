-- Stage 10B parameter-version management.  This is intentionally forward-only:
-- schema 12 (expert benchmarks) remains intact and no seeded analysis values
-- are introduced.
PRAGMA foreign_keys = OFF;

ALTER TABLE norm_sets ADD COLUMN source_type TEXT;
ALTER TABLE norm_sets ADD COLUMN write_token TEXT;
ALTER TABLE reliability_parameters ADD COLUMN write_token TEXT;
ALTER TABLE scoring_definitions ADD COLUMN write_token TEXT;

-- Stage 8 made the two reliability values NOT NULL.  A true lifecycle draft
-- must not fabricate defaults, so rebuild this one small version table with
-- nullable draft values while retaining the published-value constraints.
DROP TRIGGER analysis_reliability_published_no_update;
CREATE TABLE reliability_parameters_stage10c (
  reliability_version TEXT PRIMARY KEY,
  scoring_version TEXT NOT NULL,
  metric_code TEXT NOT NULL CHECK (metric_code = 'EAC'),
  sd_value REAL CHECK (sd_value IS NULL OR sd_value > 0),
  reliability_value REAL CHECK (reliability_value IS NULL OR (reliability_value > 0 AND reliability_value <= 1)),
  status TEXT NOT NULL CHECK (status IN ('draft', 'published', 'retired')),
  sample_size INTEGER NOT NULL CHECK (sample_size >= 0),
  created_at TEXT NOT NULL,
  published_at TEXT,
  display_name TEXT,
  source_reliability_version TEXT,
  revision_no INTEGER,
  validation_status TEXT,
  validation_report_json TEXT,
  content_fingerprint TEXT,
  population_note TEXT,
  created_by_admin_user_id TEXT,
  updated_by_admin_user_id TEXT,
  published_by_admin_user_id TEXT,
  updated_at TEXT,
  validated_at TEXT,
  write_token TEXT,
  FOREIGN KEY (scoring_version) REFERENCES scoring_definitions(scoring_version) ON DELETE RESTRICT
);
INSERT INTO reliability_parameters_stage10c SELECT * FROM reliability_parameters;
DROP TABLE reliability_parameters;
ALTER TABLE reliability_parameters_stage10c RENAME TO reliability_parameters;

CREATE TRIGGER analysis_reliability_published_no_update
BEFORE UPDATE ON reliability_parameters
WHEN OLD.status = 'published'
BEGIN SELECT RAISE(ABORT, 'published reliability sets are immutable'); END;

CREATE TRIGGER analysis_norm_sets_published_no_delete
BEFORE DELETE ON norm_sets
WHEN OLD.status = 'published'
BEGIN SELECT RAISE(ABORT, 'published norm sets are immutable'); END;

CREATE TRIGGER analysis_norm_parameters_published_no_insert
BEFORE INSERT ON norm_metric_parameters
WHEN EXISTS (SELECT 1 FROM norm_sets WHERE norm_version=NEW.norm_version AND status='published')
BEGIN SELECT RAISE(ABORT, 'published norm parameters are immutable'); END;

CREATE TRIGGER analysis_norm_parameters_published_no_update
BEFORE UPDATE ON norm_metric_parameters
WHEN EXISTS (SELECT 1 FROM norm_sets WHERE norm_version=OLD.norm_version AND status='published')
BEGIN SELECT RAISE(ABORT, 'published norm parameters are immutable'); END;

CREATE TRIGGER analysis_norm_parameters_published_no_delete
BEFORE DELETE ON norm_metric_parameters
WHEN EXISTS (SELECT 1 FROM norm_sets WHERE norm_version=OLD.norm_version AND status='published')
BEGIN SELECT RAISE(ABORT, 'published norm parameters are immutable'); END;

CREATE TRIGGER analysis_reliability_published_no_delete
BEFORE DELETE ON reliability_parameters
WHEN OLD.status = 'published'
BEGIN SELECT RAISE(ABORT, 'published reliability sets are immutable'); END;

CREATE TRIGGER scoring_definitions_published_no_delete
BEFORE DELETE ON scoring_definitions
WHEN OLD.status = 'published'
BEGIN SELECT RAISE(ABORT, 'published scoring definitions are immutable'); END;

-- The existing audit action CHECK is deliberately extended forward-only.  The
-- copy retains prior audit records while allowing only the new safe lifecycle
-- actions introduced by this migration.
DROP INDEX admin_audit_logs_time_idx;
DROP INDEX admin_audit_logs_user_time_idx;
DROP INDEX admin_audit_logs_action_time_idx;
DROP INDEX admin_audit_logs_outcome_time_idx;
DROP INDEX admin_audit_logs_session_terminal_once_idx;

CREATE TABLE admin_audit_logs_stage10c (
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
    'benchmark_set_created','benchmark_set_updated','benchmark_set_validated','benchmark_set_published',
    'norm_set_created','norm_set_updated','norm_set_validated','norm_set_published',
    'reliability_set_created','reliability_set_updated','reliability_set_validated','reliability_set_published',
    'scoring_definition_created','scoring_definition_updated','scoring_definition_validated','scoring_definition_published'
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

INSERT INTO admin_audit_logs_stage10c SELECT * FROM admin_audit_logs;
DROP TABLE admin_audit_logs;
ALTER TABLE admin_audit_logs_stage10c RENAME TO admin_audit_logs;

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
UPDATE app_metadata SET value='13', updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
WHERE key='schema_version';
