-- Research data collection release: immutable deletion ledger and audit actions.
DROP INDEX admin_audit_logs_time_idx;
DROP INDEX admin_audit_logs_user_time_idx;
DROP INDEX admin_audit_logs_action_time_idx;
DROP INDEX admin_audit_logs_outcome_time_idx;
DROP INDEX admin_audit_logs_session_terminal_once_idx;

CREATE TABLE admin_audit_logs_release1 (
  audit_id TEXT PRIMARY KEY,
  admin_user_id TEXT,
  admin_session_id TEXT,
  action TEXT NOT NULL CHECK (action IN (
    'admin_provisioned','admin_password_rotated','admin_login_success','admin_login_failure','admin_login_rate_limited','admin_logout',
    'admin_session_revoked','admin_session_idle_expired','admin_session_absolute_expired','admin_audit_logs_viewed',
    'material_set_created','material_set_updated','material_set_validated','material_set_published',
    'point_rule_created','point_rule_updated','point_rule_validated','point_rule_published',
    'sunk_cost_rule_created','sunk_cost_rule_updated','sunk_cost_rule_validated','sunk_cost_rule_published',
    'configuration_set_created','configuration_set_updated','configuration_set_validated','configuration_set_published','configuration_set_activated','configuration_set_rollback_activated',
    'benchmark_set_created','benchmark_set_updated','benchmark_set_validated','benchmark_set_published',
    'norm_set_created','norm_set_updated','norm_set_validated','norm_set_published',
    'reliability_set_created','reliability_set_updated','reliability_set_validated','reliability_set_published',
    'scoring_definition_created','scoring_definition_updated','scoring_definition_validated','scoring_definition_published',
    'research_sessions_viewed','research_data_exported','research_sessions_deleted'
  )),
  outcome TEXT NOT NULL CHECK (outcome IN ('success','failure','blocked')),
  target_type TEXT,
  target_id TEXT,
  request_id TEXT NOT NULL,
  client_fingerprint_hash TEXT CHECK (client_fingerprint_hash IS NULL OR (length(client_fingerprint_hash)=64 AND client_fingerprint_hash=lower(client_fingerprint_hash) AND client_fingerprint_hash NOT GLOB '*[^0-9a-f]*')),
  metadata_json TEXT NOT NULL CHECK (json_valid(metadata_json) AND json_type(metadata_json)='object'),
  created_at TEXT NOT NULL CHECK (julianday(created_at) IS NOT NULL),
  FOREIGN KEY (admin_user_id) REFERENCES admin_users(admin_user_id) ON DELETE RESTRICT,
  FOREIGN KEY (admin_session_id) REFERENCES admin_sessions(admin_session_id) ON DELETE RESTRICT
);
INSERT INTO admin_audit_logs_release1 SELECT * FROM admin_audit_logs;
DROP TABLE admin_audit_logs;
ALTER TABLE admin_audit_logs_release1 RENAME TO admin_audit_logs;
CREATE INDEX admin_audit_logs_time_idx ON admin_audit_logs (created_at);
CREATE INDEX admin_audit_logs_user_time_idx ON admin_audit_logs (admin_user_id,created_at);
CREATE INDEX admin_audit_logs_action_time_idx ON admin_audit_logs (action,created_at);
CREATE INDEX admin_audit_logs_outcome_time_idx ON admin_audit_logs (outcome,created_at);
CREATE UNIQUE INDEX admin_audit_logs_session_terminal_once_idx ON admin_audit_logs (admin_session_id,action)
WHERE admin_session_id IS NOT NULL AND action IN ('admin_logout','admin_session_revoked','admin_session_idle_expired','admin_session_absolute_expired');
CREATE TRIGGER admin_audit_logs_no_update BEFORE UPDATE ON admin_audit_logs
BEGIN SELECT RAISE(ABORT,'admin audit logs cannot be updated'); END;
CREATE TRIGGER admin_audit_logs_no_delete BEFORE DELETE ON admin_audit_logs
BEGIN SELECT RAISE(ABORT,'admin audit logs cannot be deleted'); END;

CREATE TABLE deletion_tombstones (
  tombstone_id TEXT PRIMARY KEY,
  entity_type TEXT NOT NULL CHECK (entity_type='session'),
  deleted_entity_hash TEXT NOT NULL CHECK (length(deleted_entity_hash)=64 AND deleted_entity_hash=lower(deleted_entity_hash) AND deleted_entity_hash NOT GLOB '*[^0-9a-f]*'),
  deletion_scope TEXT NOT NULL CHECK (deletion_scope IN ('single_session','bulk_sessions')),
  deleted_by_admin_user_id TEXT NOT NULL,
  deletion_request_id TEXT NOT NULL,
  deleted_at TEXT NOT NULL CHECK (julianday(deleted_at) IS NOT NULL),
  reason_code TEXT NOT NULL CHECK (length(trim(reason_code)) BETWEEN 1 AND 64),
  FOREIGN KEY (deleted_by_admin_user_id) REFERENCES admin_users(admin_user_id) ON DELETE RESTRICT,
  UNIQUE(entity_type,deleted_entity_hash)
);
CREATE INDEX deletion_tombstones_deleted_at_idx ON deletion_tombstones (deleted_at);
CREATE TRIGGER deletion_tombstones_no_update BEFORE UPDATE ON deletion_tombstones
BEGIN SELECT RAISE(ABORT,'deletion tombstones are immutable'); END;
CREATE TRIGGER deletion_tombstones_no_delete BEFORE DELETE ON deletion_tombstones
BEGIN SELECT RAISE(ABORT,'deletion tombstones are immutable'); END;

PRAGMA foreign_keys=ON;
UPDATE app_metadata SET value='14',updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE key='schema_version';
