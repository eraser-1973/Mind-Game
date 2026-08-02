-- Forward-only Stage 8 repair. This migration intentionally keeps the
-- application schema version at 8; it closes integrity gaps discovered after
-- 0008 had been applied to the empty remote database.

CREATE TRIGGER scoring_runs_version_keys_insert_guard
BEFORE INSERT ON scoring_runs
WHEN NOT (
  (
    (NEW.norm_version IS NULL AND NEW.norm_key = 'none')
    OR (NEW.norm_version IS NOT NULL AND NEW.norm_key = NEW.norm_version)
  )
  AND
  (
    (NEW.reliability_version IS NULL AND NEW.reliability_key = 'none')
    OR (
      NEW.reliability_version IS NOT NULL
      AND NEW.reliability_key = NEW.reliability_version
    )
  )
)
BEGIN
  SELECT RAISE(ABORT, 'scoring run version keys are inconsistent');
END;

CREATE TRIGGER benchmark_candidate_values_published_no_insert
BEFORE INSERT ON benchmark_candidate_values
WHEN EXISTS (
  SELECT 1 FROM benchmark_sets
  WHERE benchmark_version = NEW.benchmark_version AND status = 'published'
)
BEGIN
  SELECT RAISE(ABORT, 'published benchmark values are immutable');
END;

CREATE TRIGGER benchmark_candidate_values_published_no_delete
BEFORE DELETE ON benchmark_candidate_values
WHEN EXISTS (
  SELECT 1 FROM benchmark_sets
  WHERE benchmark_version = OLD.benchmark_version AND status = 'published'
)
BEGIN
  SELECT RAISE(ABORT, 'published benchmark values are immutable');
END;
