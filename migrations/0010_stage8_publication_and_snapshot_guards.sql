-- Forward-only Stage 8 review repair. The public schema contract remains 8.

CREATE TRIGGER benchmark_sets_current_baseline_insert_guard
BEFORE INSERT ON benchmark_sets
WHEN NEW.source_type = 'current_app_baseline' AND NEW.is_provisional <> 1
BEGIN
  SELECT RAISE(ABORT, 'current-app baselines must remain provisional');
END;

CREATE TRIGGER benchmark_sets_current_baseline_update_guard
BEFORE UPDATE OF source_type, is_provisional ON benchmark_sets
WHEN NEW.source_type = 'current_app_baseline' AND NEW.is_provisional <> 1
BEGIN
  SELECT RAISE(ABORT, 'current-app baselines must remain provisional');
END;

CREATE TRIGGER benchmark_sets_formal_publish_insert_guard
BEFORE INSERT ON benchmark_sets
WHEN NEW.status = 'published'
  AND NEW.source_type = 'expert_panel'
  AND NEW.is_provisional = 0
BEGIN
  SELECT RAISE(ABORT, 'formal expert benchmarks must be published from a validated draft');
END;

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
BEGIN
  SELECT RAISE(ABORT, 'formal expert benchmark expert rows are incomplete');
END;

CREATE TRIGGER benchmark_sets_no_reopen
BEFORE UPDATE OF status ON benchmark_sets
WHEN OLD.status IN ('published', 'retired') AND NEW.status = 'draft'
BEGIN
  SELECT RAISE(ABORT, 'published benchmark versions cannot be reopened');
END;

CREATE TRIGGER benchmark_expert_scores_published_no_insert
BEFORE INSERT ON benchmark_expert_scores
WHEN EXISTS (
  SELECT 1 FROM benchmark_sets
  WHERE benchmark_version = NEW.benchmark_version AND status <> 'draft'
)
BEGIN
  SELECT RAISE(ABORT, 'published expert scores are immutable');
END;

CREATE TRIGGER benchmark_expert_scores_published_no_update
BEFORE UPDATE ON benchmark_expert_scores
WHEN EXISTS (
  SELECT 1 FROM benchmark_sets
  WHERE benchmark_version = OLD.benchmark_version AND status <> 'draft'
)
BEGIN
  SELECT RAISE(ABORT, 'published expert scores are immutable');
END;

CREATE TRIGGER benchmark_expert_scores_published_no_delete
BEFORE DELETE ON benchmark_expert_scores
WHEN EXISTS (
  SELECT 1 FROM benchmark_sets
  WHERE benchmark_version = OLD.benchmark_version AND status <> 'draft'
)
BEGIN
  SELECT RAISE(ABORT, 'published expert scores are immutable');
END;

CREATE TRIGGER scoring_input_snapshots_session_insert_guard
BEFORE INSERT ON scoring_input_snapshots
WHEN NOT EXISTS (
  SELECT 1 FROM scoring_runs
  WHERE scoring_run_id = NEW.scoring_run_id AND session_id = NEW.session_id
)
BEGIN
  SELECT RAISE(ABORT, 'snapshot session does not match scoring run');
END;

CREATE TRIGGER scoring_input_snapshots_session_update_guard
BEFORE UPDATE OF scoring_run_id, session_id ON scoring_input_snapshots
WHEN NOT EXISTS (
  SELECT 1 FROM scoring_runs
  WHERE scoring_run_id = NEW.scoring_run_id AND session_id = NEW.session_id
)
BEGIN
  SELECT RAISE(ABORT, 'snapshot session does not match scoring run');
END;
