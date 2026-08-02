CREATE TABLE scoring_definitions (
  scoring_version TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  formula_family TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('draft', 'published', 'retired')),
  is_pre_pilot INTEGER NOT NULL CHECK (is_pre_pilot IN (0, 1)),
  total_rdi_enabled INTEGER NOT NULL CHECK (total_rdi_enabled IN (0, 1)),
  level_enabled INTEGER NOT NULL CHECK (level_enabled IN (0, 1)),
  formula_config_json TEXT NOT NULL CHECK (
    json_valid(formula_config_json) AND json_type(formula_config_json) = 'object'
  ),
  weights_json TEXT NOT NULL CHECK (
    json_valid(weights_json) AND json_type(weights_json) = 'object'
  ),
  time_unit TEXT NOT NULL CHECK (time_unit = 'second'),
  created_at TEXT NOT NULL,
  published_at TEXT,
  CHECK (
    is_pre_pilot = 0
    OR (total_rdi_enabled = 0 AND level_enabled = 0)
  )
);

CREATE TABLE benchmark_sets (
  benchmark_version TEXT PRIMARY KEY,
  source_type TEXT NOT NULL CHECK (
    source_type IN ('current_app_baseline', 'expert_panel')
  ),
  status TEXT NOT NULL CHECK (status IN ('draft', 'published', 'retired')),
  is_provisional INTEGER NOT NULL CHECK (is_provisional IN (0, 1)),
  expert_count INTEGER NOT NULL CHECK (expert_count >= 0),
  rated_at TEXT,
  validated_at TEXT,
  notes TEXT,
  created_at TEXT NOT NULL,
  CHECK (
    status <> 'published'
    OR source_type <> 'expert_panel'
    OR expert_count > 0
  )
);

CREATE TABLE benchmark_candidate_values (
  benchmark_version TEXT NOT NULL,
  candidate_id TEXT NOT NULL CHECK (candidate_id IN ('A', 'B', 'C', 'D', 'E')),
  benchmark_value REAL NOT NULL CHECK (benchmark_value BETWEEN 0 AND 100),
  benchmark_sd REAL CHECK (benchmark_sd IS NULL OR benchmark_sd >= 0),
  direction INTEGER NOT NULL CHECK (direction IN (-1, 0, 1)),
  include_in_core_eac INTEGER NOT NULL CHECK (include_in_core_eac IN (0, 1)),
  source_note TEXT,
  created_at TEXT NOT NULL,
  PRIMARY KEY (benchmark_version, candidate_id),
  FOREIGN KEY (benchmark_version) REFERENCES benchmark_sets(benchmark_version) ON DELETE RESTRICT,
  CHECK (
    (direction = 0 AND include_in_core_eac = 0)
    OR direction <> 0
  )
);

CREATE TABLE benchmark_expert_scores (
  expert_score_id TEXT PRIMARY KEY,
  benchmark_version TEXT NOT NULL,
  candidate_id TEXT NOT NULL CHECK (candidate_id IN ('A', 'B', 'C', 'D', 'E')),
  expert_code TEXT NOT NULL,
  score REAL NOT NULL CHECK (score BETWEEN 0 AND 100),
  submitted_at TEXT NOT NULL,
  FOREIGN KEY (benchmark_version, candidate_id)
    REFERENCES benchmark_candidate_values(benchmark_version, candidate_id) ON DELETE RESTRICT,
  UNIQUE (benchmark_version, candidate_id, expert_code)
);

CREATE TABLE norm_sets (
  norm_version TEXT PRIMARY KEY,
  scoring_version TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('draft', 'published', 'retired')),
  sample_size INTEGER NOT NULL CHECK (sample_size >= 0),
  population_note TEXT,
  created_at TEXT NOT NULL,
  published_at TEXT,
  FOREIGN KEY (scoring_version) REFERENCES scoring_definitions(scoring_version) ON DELETE RESTRICT
);

CREATE TABLE norm_metric_parameters (
  norm_version TEXT NOT NULL,
  metric_code TEXT NOT NULL CHECK (metric_code IN ('RES', 'EACS', 'DDS', 'GDS', 'SLS')),
  mean_value REAL NOT NULL,
  sd_value REAL NOT NULL CHECK (sd_value > 0),
  created_at TEXT NOT NULL,
  PRIMARY KEY (norm_version, metric_code),
  FOREIGN KEY (norm_version) REFERENCES norm_sets(norm_version) ON DELETE RESTRICT
);

CREATE TABLE reliability_parameters (
  reliability_version TEXT PRIMARY KEY,
  scoring_version TEXT NOT NULL,
  metric_code TEXT NOT NULL CHECK (metric_code = 'EAC'),
  sd_value REAL NOT NULL CHECK (sd_value > 0),
  reliability_value REAL NOT NULL CHECK (
    reliability_value > 0 AND reliability_value <= 1
  ),
  status TEXT NOT NULL CHECK (status IN ('draft', 'published', 'retired')),
  sample_size INTEGER NOT NULL CHECK (sample_size >= 0),
  created_at TEXT NOT NULL,
  published_at TEXT,
  FOREIGN KEY (scoring_version) REFERENCES scoring_definitions(scoring_version) ON DELETE RESTRICT
);

CREATE TABLE scoring_runs (
  scoring_run_id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  scoring_version TEXT NOT NULL,
  benchmark_version TEXT NOT NULL,
  norm_version TEXT,
  reliability_version TEXT,
  norm_key TEXT NOT NULL DEFAULT 'none',
  reliability_key TEXT NOT NULL DEFAULT 'none',
  source_fingerprint TEXT NOT NULL CHECK (
    length(source_fingerprint) = 64
  ),
  run_status TEXT NOT NULL CHECK (
    run_status IN ('pending', 'completed', 'partial', 'failed')
  ),
  is_pre_pilot INTEGER NOT NULL CHECK (is_pre_pilot IN (0, 1)),
  interpretation_status TEXT NOT NULL CHECK (
    interpretation_status = 'research_only'
  ),
  rdi_status TEXT NOT NULL CHECK (
    rdi_status IN ('norms_unavailable', 'inputs_incomplete', 'not_calculated')
  ),
  missing_reasons_json TEXT NOT NULL CHECK (
    json_valid(missing_reasons_json) AND json_type(missing_reasons_json) = 'array'
  ),
  failure_code TEXT,
  failure_detail_safe TEXT,
  started_at TEXT NOT NULL,
  completed_at TEXT,
  is_current INTEGER NOT NULL CHECK (is_current IN (0, 1)),
  FOREIGN KEY (session_id) REFERENCES sessions(session_id) ON DELETE CASCADE,
  FOREIGN KEY (scoring_version) REFERENCES scoring_definitions(scoring_version) ON DELETE RESTRICT,
  FOREIGN KEY (benchmark_version) REFERENCES benchmark_sets(benchmark_version) ON DELETE RESTRICT,
  FOREIGN KEY (norm_version) REFERENCES norm_sets(norm_version) ON DELETE RESTRICT,
  FOREIGN KEY (reliability_version) REFERENCES reliability_parameters(reliability_version) ON DELETE RESTRICT,
  UNIQUE (
    session_id,
    scoring_version,
    benchmark_version,
    norm_key,
    reliability_key,
    source_fingerprint
  ),
  CHECK (
    (norm_version IS NULL AND norm_key = 'none')
    OR norm_version = norm_key
  ),
  CHECK (
    (reliability_version IS NULL AND reliability_key = 'none')
    OR reliability_version = reliability_key
  ),
  CHECK (
    (run_status = 'failed' AND failure_code IS NOT NULL
      AND failure_detail_safe IS NOT NULL AND is_current = 0)
    OR (run_status <> 'failed' AND failure_code IS NULL
      AND failure_detail_safe IS NULL)
  )
);

CREATE TABLE scoring_input_snapshots (
  scoring_run_id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  input_json TEXT NOT NULL CHECK (
    json_valid(input_json) AND json_type(input_json) = 'object'
  ),
  input_schema_version TEXT NOT NULL,
  captured_at TEXT NOT NULL,
  FOREIGN KEY (scoring_run_id) REFERENCES scoring_runs(scoring_run_id) ON DELETE CASCADE,
  FOREIGN KEY (session_id) REFERENCES sessions(session_id) ON DELETE CASCADE
);

CREATE TABLE derived_metric_values (
  metric_value_id TEXT PRIMARY KEY,
  scoring_run_id TEXT NOT NULL,
  metric_code TEXT NOT NULL CHECK (
    metric_code IN ('RES', 'EAC', 'EACS', 'DDS', 'GDS', 'SLS', 'RCI', 'RDIz', 'RDIT')
  ),
  numeric_value REAL,
  calculation_status TEXT NOT NULL CHECK (
    calculation_status IN (
      'calculated', 'partial', 'unavailable', 'not_applicable',
      'pending_parameters', 'norms_unavailable'
    )
  ),
  formula_version TEXT NOT NULL,
  coverage_count INTEGER CHECK (coverage_count IS NULL OR coverage_count >= 0),
  required_count INTEGER CHECK (required_count IS NULL OR required_count >= 0),
  missing_reason TEXT,
  input_json TEXT NOT NULL CHECK (
    json_valid(input_json) AND json_type(input_json) = 'object'
  ),
  computed_at TEXT NOT NULL,
  FOREIGN KEY (scoring_run_id) REFERENCES scoring_runs(scoring_run_id) ON DELETE CASCADE,
  UNIQUE (scoring_run_id, metric_code),
  CHECK (
    metric_code NOT IN ('RDIz', 'RDIT') OR numeric_value IS NULL
  ),
  CHECK (
    metric_code <> 'RCI' OR numeric_value IS NULL
  ),
  CHECK (
    coverage_count IS NULL OR required_count IS NULL OR coverage_count <= required_count
  )
);

CREATE TABLE candidate_metric_components (
  component_id TEXT PRIMARY KEY,
  scoring_run_id TEXT NOT NULL,
  candidate_id TEXT NOT NULL CHECK (candidate_id IN ('A', 'B', 'C', 'D', 'E')),
  direction INTEGER NOT NULL CHECK (direction IN (-1, 0, 1)),
  include_in_core INTEGER NOT NULL CHECK (include_in_core IN (0, 1)),
  t1_value REAL CHECK (t1_value IS NULL OR t1_value BETWEEN 0 AND 100),
  t3_value REAL CHECK (t3_value IS NULL OR t3_value BETWEEN 0 AND 100),
  t1_server_at TEXT,
  t3_server_at TEXT,
  delta_score REAL,
  delta_time_sec REAL CHECK (delta_time_sec IS NULL OR delta_time_sec > 0),
  eac_i REAL,
  eacs_i REAL,
  rci_i REAL,
  calculation_status TEXT NOT NULL CHECK (
    calculation_status IN ('calculated', 'unavailable', 'excluded')
  ),
  missing_reason TEXT,
  computed_at TEXT NOT NULL,
  FOREIGN KEY (scoring_run_id) REFERENCES scoring_runs(scoring_run_id) ON DELETE CASCADE,
  UNIQUE (scoring_run_id, candidate_id),
  CHECK (rci_i IS NULL)
);

CREATE INDEX scoring_runs_session_idx ON scoring_runs (session_id);
CREATE INDEX scoring_runs_versions_idx
ON scoring_runs (scoring_version, benchmark_version);
CREATE INDEX scoring_runs_status_idx ON scoring_runs (run_status);
CREATE UNIQUE INDEX scoring_runs_one_current_idx
ON scoring_runs (session_id) WHERE is_current = 1;
CREATE INDEX derived_metric_values_run_idx
ON derived_metric_values (scoring_run_id);
CREATE INDEX derived_metric_values_code_idx
ON derived_metric_values (metric_code);
CREATE INDEX candidate_metric_components_run_idx
ON candidate_metric_components (scoring_run_id);
CREATE INDEX benchmark_candidate_values_version_idx
ON benchmark_candidate_values (benchmark_version);
CREATE INDEX norm_metric_parameters_version_idx
ON norm_metric_parameters (norm_version);

CREATE TRIGGER scoring_runs_append_only_update
BEFORE UPDATE ON scoring_runs
WHEN NOT (
  OLD.scoring_run_id = NEW.scoring_run_id
  AND OLD.session_id = NEW.session_id
  AND OLD.scoring_version = NEW.scoring_version
  AND OLD.benchmark_version = NEW.benchmark_version
  AND OLD.norm_version IS NEW.norm_version
  AND OLD.reliability_version IS NEW.reliability_version
  AND OLD.norm_key = NEW.norm_key
  AND OLD.reliability_key = NEW.reliability_key
  AND OLD.source_fingerprint = NEW.source_fingerprint
  AND OLD.run_status = NEW.run_status
  AND OLD.is_pre_pilot = NEW.is_pre_pilot
  AND OLD.interpretation_status = NEW.interpretation_status
  AND OLD.rdi_status = NEW.rdi_status
  AND OLD.missing_reasons_json = NEW.missing_reasons_json
  AND OLD.failure_code IS NEW.failure_code
  AND OLD.failure_detail_safe IS NEW.failure_detail_safe
  AND OLD.started_at = NEW.started_at
  AND OLD.completed_at IS NEW.completed_at
  AND OLD.is_current = 1
  AND NEW.is_current = 0
)
BEGIN
  SELECT RAISE(ABORT, 'scoring runs are append-only except current demotion');
END;

CREATE TRIGGER scoring_input_snapshots_no_update
BEFORE UPDATE ON scoring_input_snapshots
BEGIN
  SELECT RAISE(ABORT, 'scoring input snapshots cannot be updated');
END;

CREATE TRIGGER derived_metric_values_no_update
BEFORE UPDATE ON derived_metric_values
BEGIN
  SELECT RAISE(ABORT, 'derived metric values cannot be updated');
END;

CREATE TRIGGER candidate_metric_components_no_update
BEFORE UPDATE ON candidate_metric_components
BEGIN
  SELECT RAISE(ABORT, 'candidate metric components cannot be updated');
END;

CREATE TRIGGER scoring_definitions_published_immutable
BEFORE UPDATE ON scoring_definitions
WHEN OLD.status = 'published'
BEGIN
  SELECT RAISE(ABORT, 'published scoring definitions are immutable');
END;

CREATE TRIGGER benchmark_sets_published_immutable
BEFORE UPDATE ON benchmark_sets
WHEN OLD.status = 'published'
BEGIN
  SELECT RAISE(ABORT, 'published benchmark sets are immutable');
END;

CREATE TRIGGER benchmark_candidate_values_no_update
BEFORE UPDATE ON benchmark_candidate_values
BEGIN
  SELECT RAISE(ABORT, 'benchmark candidate values are versioned and immutable');
END;

INSERT INTO scoring_definitions (
  scoring_version,display_name,formula_family,status,is_pre_pilot,
  total_rdi_enabled,level_enabled,formula_config_json,weights_json,time_unit,
  created_at,published_at
) VALUES (
  'RDI-2.0-prepilot',
  'RDI 2.0 预实验原始指标',
  'RDI-2.0',
  'published',
  1,
  0,
  0,
  json('{"eacCandidateIds":["A","B","C","D"],"primaryRiskAnchor":"earliest_server_key_risk","timeUnit":"second","availableCaseMean":true,"ddsRequiresRiskExposure":true,"sls":{"stop_loss":100,"give_up":80,"continue":30}}'),
  json('{"RES":0.35,"EACS":0.35,"DDS":0.15,"GDS":0.10,"SLS":0.05}'),
  'second',
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
);

INSERT INTO benchmark_sets (
  benchmark_version,source_type,status,is_provisional,expert_count,rated_at,
  validated_at,notes,created_at
) VALUES (
  'benchmark-1.0.0',
  'current_app_baseline',
  'published',
  1,
  0,
  NULL,
  NULL,
  '由当前项目 baselineFitScore 迁移，仅用于预实验流程验证，不代表已完成专家评定。',
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
);

INSERT INTO benchmark_candidate_values (
  benchmark_version,candidate_id,benchmark_value,benchmark_sd,direction,
  include_in_core_eac,source_note,created_at
) VALUES
('benchmark-1.0.0','A',51,NULL,-1,1,'current_app_baseline provisional baselineFitScore',strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
('benchmark-1.0.0','B',86,NULL,1,1,'current_app_baseline provisional baselineFitScore',strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
('benchmark-1.0.0','C',60,NULL,-1,1,'current_app_baseline provisional baselineFitScore',strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
('benchmark-1.0.0','D',83,NULL,1,1,'current_app_baseline provisional baselineFitScore',strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
('benchmark-1.0.0','E',70,NULL,0,0,'current_app_baseline provisional baselineFitScore',strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));

INSERT INTO norm_sets (
  norm_version,scoring_version,status,sample_size,population_note,created_at,published_at
) VALUES (
  'norm-prepilot-draft',
  'RDI-2.0-prepilot',
  'draft',
  0,
  'Empty draft only; no norm parameters are published or used in Stage 8.',
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
  NULL
);

UPDATE app_metadata
SET value = '8', updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE key = 'schema_version';
