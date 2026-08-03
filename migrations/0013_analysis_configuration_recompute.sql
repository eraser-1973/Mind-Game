-- Stage 10B: immutable analysis-parameter versions and resumable formal
-- analysis.  This migration deliberately leaves the Stage 8 pre-pilot
-- scoring tables and their orchestrator untouched.

PRAGMA foreign_keys = OFF;

ALTER TABLE configuration_sets ADD COLUMN reliability_version TEXT;
ALTER TABLE sessions ADD COLUMN reliability_version TEXT;

ALTER TABLE scoring_definitions ADD COLUMN source_scoring_version TEXT;
ALTER TABLE scoring_definitions ADD COLUMN revision_no INTEGER;
ALTER TABLE scoring_definitions ADD COLUMN validation_status TEXT;
ALTER TABLE scoring_definitions ADD COLUMN validation_report_json TEXT;
ALTER TABLE scoring_definitions ADD COLUMN content_fingerprint TEXT;
ALTER TABLE scoring_definitions ADD COLUMN created_by_admin_user_id TEXT;
ALTER TABLE scoring_definitions ADD COLUMN updated_by_admin_user_id TEXT;
ALTER TABLE scoring_definitions ADD COLUMN published_by_admin_user_id TEXT;
ALTER TABLE scoring_definitions ADD COLUMN updated_at TEXT;
ALTER TABLE scoring_definitions ADD COLUMN validated_at TEXT;

ALTER TABLE benchmark_sets ADD COLUMN display_name TEXT;
ALTER TABLE benchmark_sets ADD COLUMN source_benchmark_version TEXT;
ALTER TABLE benchmark_sets ADD COLUMN revision_no INTEGER;
ALTER TABLE benchmark_sets ADD COLUMN validation_status TEXT;
ALTER TABLE benchmark_sets ADD COLUMN validation_report_json TEXT;
ALTER TABLE benchmark_sets ADD COLUMN content_fingerprint TEXT;
ALTER TABLE benchmark_sets ADD COLUMN created_by_admin_user_id TEXT;
ALTER TABLE benchmark_sets ADD COLUMN updated_by_admin_user_id TEXT;
ALTER TABLE benchmark_sets ADD COLUMN published_by_admin_user_id TEXT;
ALTER TABLE benchmark_sets ADD COLUMN updated_at TEXT;

ALTER TABLE norm_sets ADD COLUMN display_name TEXT;
ALTER TABLE norm_sets ADD COLUMN source_norm_version TEXT;
ALTER TABLE norm_sets ADD COLUMN revision_no INTEGER;
ALTER TABLE norm_sets ADD COLUMN validation_status TEXT;
ALTER TABLE norm_sets ADD COLUMN validation_report_json TEXT;
ALTER TABLE norm_sets ADD COLUMN content_fingerprint TEXT;
ALTER TABLE norm_sets ADD COLUMN created_by_admin_user_id TEXT;
ALTER TABLE norm_sets ADD COLUMN updated_by_admin_user_id TEXT;
ALTER TABLE norm_sets ADD COLUMN published_by_admin_user_id TEXT;
ALTER TABLE norm_sets ADD COLUMN updated_at TEXT;
ALTER TABLE norm_sets ADD COLUMN validated_at TEXT;

ALTER TABLE reliability_parameters ADD COLUMN display_name TEXT;
ALTER TABLE reliability_parameters ADD COLUMN source_reliability_version TEXT;
ALTER TABLE reliability_parameters ADD COLUMN revision_no INTEGER;
ALTER TABLE reliability_parameters ADD COLUMN validation_status TEXT;
ALTER TABLE reliability_parameters ADD COLUMN validation_report_json TEXT;
ALTER TABLE reliability_parameters ADD COLUMN content_fingerprint TEXT;
ALTER TABLE reliability_parameters ADD COLUMN population_note TEXT;
ALTER TABLE reliability_parameters ADD COLUMN created_by_admin_user_id TEXT;
ALTER TABLE reliability_parameters ADD COLUMN updated_by_admin_user_id TEXT;
ALTER TABLE reliability_parameters ADD COLUMN published_by_admin_user_id TEXT;
ALTER TABLE reliability_parameters ADD COLUMN updated_at TEXT;
ALTER TABLE reliability_parameters ADD COLUMN validated_at TEXT;

-- Stage 8 sealed the initial published rows before these lifecycle columns
-- existed.  Replace the two equivalent guards after this one-time metadata
-- backfill; all subsequent published changes remain blocked below.
DROP TRIGGER scoring_definitions_published_immutable;
DROP TRIGGER benchmark_sets_published_immutable;

UPDATE scoring_definitions SET
  revision_no = 1,
  validation_status = 'valid',
  validation_report_json = json('{"errors":[],"warnings":[]}'),
  updated_at = created_at,
  validated_at = published_at,
  display_name = COALESCE(display_name, scoring_version)
WHERE revision_no IS NULL;

UPDATE benchmark_sets SET
  display_name = COALESCE(display_name, benchmark_version),
  revision_no = 1,
  validation_status = 'valid',
  validation_report_json = json('{"errors":[],"warnings":[{"code":"PROVISIONAL_BASELINE","path":"sourceType"}]}'),
  updated_at = created_at,
  validated_at = created_at
WHERE revision_no IS NULL;

UPDATE norm_sets SET
  display_name = COALESCE(display_name, norm_version),
  revision_no = 1,
  validation_status = CASE WHEN status = 'draft' THEN 'not_validated' ELSE 'valid' END,
  validation_report_json = json('{"errors":[],"warnings":[]}'),
  updated_at = created_at,
  validated_at = published_at
WHERE revision_no IS NULL;

CREATE TABLE benchmark_candidate_policies (
  benchmark_version TEXT NOT NULL,
  candidate_id TEXT NOT NULL CHECK (candidate_id IN ('A', 'B', 'C', 'D', 'E')),
  direction INTEGER NOT NULL CHECK (direction IN (-1, 0, 1)),
  include_in_core_eac INTEGER NOT NULL CHECK (include_in_core_eac IN (0, 1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (benchmark_version, candidate_id),
  FOREIGN KEY (benchmark_version) REFERENCES benchmark_sets(benchmark_version) ON DELETE RESTRICT,
  CHECK ((direction = 0 AND include_in_core_eac = 0) OR direction <> 0)
);

INSERT INTO benchmark_candidate_policies (
  benchmark_version, candidate_id, direction, include_in_core_eac, created_at, updated_at
) VALUES
  ('benchmark-1.0.0', 'A', -1, 1, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  ('benchmark-1.0.0', 'B', 1, 1, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  ('benchmark-1.0.0', 'C', -1, 1, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  ('benchmark-1.0.0', 'D', 1, 1, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  ('benchmark-1.0.0', 'E', 0, 0, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));

CREATE TABLE analysis_validation_runs (
  validation_run_id TEXT PRIMARY KEY,
  object_type TEXT NOT NULL CHECK (object_type IN ('benchmark', 'norm', 'reliability', 'scoring_definition', 'configuration')),
  object_version TEXT NOT NULL,
  revision_no INTEGER NOT NULL CHECK (revision_no >= 1),
  content_fingerprint TEXT CHECK (content_fingerprint IS NULL OR (
    length(content_fingerprint) = 64 AND content_fingerprint = lower(content_fingerprint)
    AND content_fingerprint NOT GLOB '*[^0-9a-f]*'
  )),
  validation_status TEXT NOT NULL CHECK (validation_status IN ('valid', 'invalid')),
  errors_json TEXT NOT NULL CHECK (json_valid(errors_json) AND json_type(errors_json) = 'array'),
  warnings_json TEXT NOT NULL CHECK (json_valid(warnings_json) AND json_type(warnings_json) = 'array'),
  request_id TEXT,
  validated_by_admin_user_id TEXT,
  validated_at TEXT NOT NULL,
  FOREIGN KEY (validated_by_admin_user_id) REFERENCES admin_users(admin_user_id) ON DELETE RESTRICT
);

CREATE INDEX analysis_validation_runs_object_idx
ON analysis_validation_runs (object_type, object_version, revision_no, validated_at DESC);

CREATE TABLE formal_analysis_runs (
  analysis_run_id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  scoring_version TEXT NOT NULL,
  benchmark_version TEXT NOT NULL,
  norm_version TEXT,
  reliability_version TEXT,
  source_fingerprint TEXT NOT NULL CHECK (length(source_fingerprint) = 64 AND source_fingerprint NOT GLOB '*[^0-9a-f]*'),
  scoring_fingerprint TEXT NOT NULL CHECK (length(scoring_fingerprint) = 64 AND scoring_fingerprint NOT GLOB '*[^0-9a-f]*'),
  benchmark_fingerprint TEXT NOT NULL CHECK (length(benchmark_fingerprint) = 64 AND benchmark_fingerprint NOT GLOB '*[^0-9a-f]*'),
  norm_fingerprint TEXT,
  reliability_fingerprint TEXT,
  run_fingerprint TEXT NOT NULL CHECK (length(run_fingerprint) = 64 AND run_fingerprint NOT GLOB '*[^0-9a-f]*'),
  run_status TEXT NOT NULL CHECK (run_status IN ('completed', 'partial', 'failed')),
  rdi_status TEXT NOT NULL CHECK (rdi_status IN ('calculated', 'inputs_incomplete', 'norms_unavailable', 'not_calculated')),
  missing_reasons_json TEXT NOT NULL CHECK (json_valid(missing_reasons_json) AND json_type(missing_reasons_json) = 'array'),
  failure_code TEXT,
  failure_detail_safe TEXT,
  started_at TEXT NOT NULL,
  completed_at TEXT,
  is_current INTEGER NOT NULL DEFAULT 0 CHECK (is_current IN (0, 1)),
  FOREIGN KEY (session_id) REFERENCES sessions(session_id) ON DELETE CASCADE,
  FOREIGN KEY (scoring_version) REFERENCES scoring_definitions(scoring_version) ON DELETE RESTRICT,
  FOREIGN KEY (benchmark_version) REFERENCES benchmark_sets(benchmark_version) ON DELETE RESTRICT,
  FOREIGN KEY (norm_version) REFERENCES norm_sets(norm_version) ON DELETE RESTRICT,
  FOREIGN KEY (reliability_version) REFERENCES reliability_parameters(reliability_version) ON DELETE RESTRICT,
  UNIQUE (session_id, run_fingerprint)
);

CREATE UNIQUE INDEX formal_analysis_runs_one_current_idx
ON formal_analysis_runs (session_id) WHERE is_current = 1;
CREATE INDEX formal_analysis_runs_session_idx ON formal_analysis_runs (session_id, completed_at DESC);

CREATE TABLE formal_analysis_input_snapshots (
  analysis_run_id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  input_schema_version TEXT NOT NULL,
  input_json TEXT NOT NULL CHECK (json_valid(input_json) AND json_type(input_json) = 'object'),
  captured_at TEXT NOT NULL,
  FOREIGN KEY (analysis_run_id) REFERENCES formal_analysis_runs(analysis_run_id) ON DELETE CASCADE,
  FOREIGN KEY (session_id) REFERENCES sessions(session_id) ON DELETE CASCADE
);

CREATE TABLE formal_analysis_candidate_metrics (
  candidate_metric_id TEXT PRIMARY KEY,
  analysis_run_id TEXT NOT NULL,
  candidate_id TEXT NOT NULL CHECK (candidate_id IN ('A', 'B', 'C', 'D', 'E')),
  direction INTEGER NOT NULL CHECK (direction IN (-1, 0, 1)),
  include_in_core_eac INTEGER NOT NULL CHECK (include_in_core_eac IN (0, 1)),
  t1_value REAL,
  t3_value REAL,
  t1_server_at TEXT,
  t3_server_at TEXT,
  delta_score REAL,
  delta_time_sec REAL CHECK (delta_time_sec IS NULL OR delta_time_sec > 0),
  eac_i REAL,
  eacs_i REAL,
  rci_i REAL,
  calculation_status TEXT NOT NULL CHECK (calculation_status IN ('calculated', 'unavailable', 'excluded')),
  missing_reason TEXT,
  input_json TEXT NOT NULL CHECK (json_valid(input_json) AND json_type(input_json) = 'object'),
  computed_at TEXT NOT NULL,
  FOREIGN KEY (analysis_run_id) REFERENCES formal_analysis_runs(analysis_run_id) ON DELETE CASCADE,
  UNIQUE (analysis_run_id, candidate_id)
);

CREATE INDEX formal_analysis_candidate_metrics_run_idx
ON formal_analysis_candidate_metrics (analysis_run_id, candidate_id);

CREATE TABLE formal_analysis_metric_values (
  metric_value_id TEXT PRIMARY KEY,
  analysis_run_id TEXT NOT NULL,
  metric_code TEXT NOT NULL CHECK (metric_code IN ('RES', 'EAC', 'EACS', 'DDS', 'GDS', 'SLS', 'RCI', 'RDIz', 'RDIT')),
  numeric_value REAL,
  calculation_status TEXT NOT NULL CHECK (calculation_status IN ('calculated', 'partial', 'unavailable', 'components_calculated', 'norms_unavailable', 'not_applicable')),
  formula_version TEXT NOT NULL,
  coverage_count INTEGER CHECK (coverage_count IS NULL OR coverage_count >= 0),
  required_count INTEGER CHECK (required_count IS NULL OR required_count >= 0),
  missing_reason TEXT,
  input_json TEXT NOT NULL CHECK (json_valid(input_json) AND json_type(input_json) = 'object'),
  computed_at TEXT NOT NULL,
  FOREIGN KEY (analysis_run_id) REFERENCES formal_analysis_runs(analysis_run_id) ON DELETE CASCADE,
  UNIQUE (analysis_run_id, metric_code),
  CHECK (metric_code <> 'RCI' OR numeric_value IS NULL),
  CHECK (coverage_count IS NULL OR required_count IS NULL OR coverage_count <= required_count)
);

CREATE TABLE derived_metric_standard_scores (
  standard_score_id TEXT PRIMARY KEY,
  analysis_run_id TEXT NOT NULL,
  metric_code TEXT NOT NULL CHECK (metric_code IN ('RES', 'EACS', 'DDS', 'GDS', 'SLS')),
  raw_value REAL,
  norm_mean REAL,
  norm_sd REAL CHECK (norm_sd IS NULL OR norm_sd > 0),
  z_value REAL,
  weight REAL,
  weighted_value REAL,
  calculation_status TEXT NOT NULL CHECK (calculation_status IN ('calculated', 'unavailable', 'norms_unavailable')),
  missing_reason TEXT,
  input_json TEXT NOT NULL CHECK (json_valid(input_json) AND json_type(input_json) = 'object'),
  computed_at TEXT NOT NULL,
  FOREIGN KEY (analysis_run_id) REFERENCES formal_analysis_runs(analysis_run_id) ON DELETE CASCADE,
  UNIQUE (analysis_run_id, metric_code)
);

CREATE TABLE scoring_recompute_jobs (
  job_id TEXT PRIMARY KEY,
  idempotency_key TEXT NOT NULL UNIQUE,
  scoring_version TEXT NOT NULL,
  benchmark_version TEXT NOT NULL,
  norm_version TEXT,
  reliability_version TEXT,
  target_fingerprint TEXT NOT NULL CHECK (length(target_fingerprint) = 64 AND target_fingerprint NOT GLOB '*[^0-9a-f]*'),
  status TEXT NOT NULL CHECK (status IN ('pending', 'processing', 'completed', 'completed_with_failures')),
  total_count INTEGER NOT NULL DEFAULT 0 CHECK (total_count >= 0),
  pending_count INTEGER NOT NULL DEFAULT 0 CHECK (pending_count >= 0),
  processing_count INTEGER NOT NULL DEFAULT 0 CHECK (processing_count >= 0),
  completed_count INTEGER NOT NULL DEFAULT 0 CHECK (completed_count >= 0),
  partial_count INTEGER NOT NULL DEFAULT 0 CHECK (partial_count >= 0),
  failed_count INTEGER NOT NULL DEFAULT 0 CHECK (failed_count >= 0),
  reused_count INTEGER NOT NULL DEFAULT 0 CHECK (reused_count >= 0),
  created_by_admin_user_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  completed_at TEXT,
  FOREIGN KEY (scoring_version) REFERENCES scoring_definitions(scoring_version) ON DELETE RESTRICT,
  FOREIGN KEY (benchmark_version) REFERENCES benchmark_sets(benchmark_version) ON DELETE RESTRICT,
  FOREIGN KEY (norm_version) REFERENCES norm_sets(norm_version) ON DELETE RESTRICT,
  FOREIGN KEY (reliability_version) REFERENCES reliability_parameters(reliability_version) ON DELETE RESTRICT,
  FOREIGN KEY (created_by_admin_user_id) REFERENCES admin_users(admin_user_id) ON DELETE RESTRICT
);

CREATE TABLE scoring_recompute_items (
  job_item_id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  item_order INTEGER NOT NULL CHECK (item_order >= 1),
  status TEXT NOT NULL CHECK (status IN ('pending', 'processing', 'completed', 'partial', 'failed', 'reused', 'skipped')),
  lease_token TEXT,
  lease_expires_at TEXT,
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  analysis_run_id TEXT,
  safe_failure_code TEXT,
  safe_failure_detail TEXT,
  started_at TEXT,
  finished_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (job_id) REFERENCES scoring_recompute_jobs(job_id) ON DELETE CASCADE,
  FOREIGN KEY (session_id) REFERENCES sessions(session_id) ON DELETE RESTRICT,
  FOREIGN KEY (analysis_run_id) REFERENCES formal_analysis_runs(analysis_run_id) ON DELETE RESTRICT,
  UNIQUE (job_id, session_id),
  UNIQUE (job_id, item_order),
  CHECK ((status = 'processing') = (lease_token IS NOT NULL AND lease_expires_at IS NOT NULL))
);

CREATE INDEX scoring_recompute_items_claim_idx
ON scoring_recompute_items (job_id, status, item_order, lease_expires_at);
CREATE INDEX scoring_recompute_jobs_status_idx ON scoring_recompute_jobs (status, created_at);

CREATE TRIGGER benchmark_candidate_policies_published_no_insert
BEFORE INSERT ON benchmark_candidate_policies
WHEN EXISTS (SELECT 1 FROM benchmark_sets WHERE benchmark_version = NEW.benchmark_version AND status = 'published')
BEGIN SELECT RAISE(ABORT, 'published benchmark policies are immutable'); END;

CREATE TRIGGER benchmark_candidate_policies_published_no_update
BEFORE UPDATE ON benchmark_candidate_policies
WHEN EXISTS (SELECT 1 FROM benchmark_sets WHERE benchmark_version = OLD.benchmark_version AND status = 'published')
BEGIN SELECT RAISE(ABORT, 'published benchmark policies are immutable'); END;

CREATE TRIGGER benchmark_candidate_policies_published_no_delete
BEFORE DELETE ON benchmark_candidate_policies
WHEN EXISTS (SELECT 1 FROM benchmark_sets WHERE benchmark_version = OLD.benchmark_version AND status = 'published')
BEGIN SELECT RAISE(ABORT, 'published benchmark policies are immutable'); END;

CREATE TRIGGER analysis_validation_runs_no_update
BEFORE UPDATE ON analysis_validation_runs
BEGIN SELECT RAISE(ABORT, 'analysis validation runs are immutable'); END;

CREATE TRIGGER analysis_validation_runs_no_delete
BEFORE DELETE ON analysis_validation_runs
BEGIN SELECT RAISE(ABORT, 'analysis validation runs are immutable'); END;

CREATE TRIGGER formal_analysis_runs_append_only
BEFORE UPDATE ON formal_analysis_runs
WHEN NOT (OLD.is_current = 1 AND NEW.is_current = 0)
BEGIN SELECT RAISE(ABORT, 'formal analysis runs are append-only except current demotion'); END;

CREATE TRIGGER formal_analysis_input_snapshots_no_update
BEFORE UPDATE ON formal_analysis_input_snapshots
BEGIN SELECT RAISE(ABORT, 'formal analysis snapshots are immutable'); END;

CREATE TRIGGER formal_analysis_candidate_metrics_no_update
BEFORE UPDATE ON formal_analysis_candidate_metrics
BEGIN SELECT RAISE(ABORT, 'formal analysis candidate metrics are immutable'); END;

CREATE TRIGGER formal_analysis_metric_values_no_update
BEFORE UPDATE ON formal_analysis_metric_values
BEGIN SELECT RAISE(ABORT, 'formal analysis metric values are immutable'); END;

CREATE TRIGGER derived_metric_standard_scores_no_update
BEFORE UPDATE ON derived_metric_standard_scores
BEGIN SELECT RAISE(ABORT, 'standard score values are immutable'); END;

CREATE TRIGGER analysis_scoring_definitions_published_no_update
BEFORE UPDATE ON scoring_definitions
WHEN OLD.status = 'published'
BEGIN SELECT RAISE(ABORT, 'published scoring definitions are immutable'); END;

CREATE TRIGGER analysis_benchmark_sets_published_no_update
BEFORE UPDATE ON benchmark_sets
WHEN OLD.status = 'published'
BEGIN SELECT RAISE(ABORT, 'published benchmark sets are immutable'); END;

CREATE TRIGGER analysis_norm_sets_published_no_update
BEFORE UPDATE ON norm_sets
WHEN OLD.status = 'published'
BEGIN SELECT RAISE(ABORT, 'published norm sets are immutable'); END;

CREATE TRIGGER analysis_reliability_published_no_update
BEFORE UPDATE ON reliability_parameters
WHEN OLD.status = 'published'
BEGIN SELECT RAISE(ABORT, 'published reliability sets are immutable'); END;

CREATE TRIGGER analysis_expert_code_guard_insert
BEFORE INSERT ON benchmark_expert_scores
WHEN length(NEW.expert_code) NOT BETWEEN 3 AND 64
  OR NEW.expert_code GLOB '*[^A-Za-z0-9._-]*'
  OR NEW.expert_code LIKE '%@%'
  OR lower(NEW.expert_code) LIKE 'wxid[_]%'
  OR (length(NEW.expert_code) = 11 AND NEW.expert_code NOT GLOB '*[^0-9]*')
BEGIN SELECT RAISE(ABORT, 'expert code must be an anonymous internal code'); END;

CREATE TRIGGER scoring_recompute_items_processing_requires_lease
BEFORE INSERT ON scoring_recompute_items
WHEN NEW.status = 'processing' AND (NEW.lease_token IS NULL OR NEW.lease_expires_at IS NULL)
BEGIN SELECT RAISE(ABORT, 'processing recompute item requires a lease'); END;

CREATE TRIGGER scoring_recompute_items_terminal_clears_lease
BEFORE UPDATE OF status, lease_token, lease_expires_at ON scoring_recompute_items
WHEN NEW.status <> 'processing' AND (NEW.lease_token IS NOT NULL OR NEW.lease_expires_at IS NOT NULL)
BEGIN SELECT RAISE(ABORT, 'terminal recompute item must clear its lease'); END;

PRAGMA foreign_keys = ON;

UPDATE app_metadata
SET value = '11', updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE key = 'schema_version';
