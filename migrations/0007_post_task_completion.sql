ALTER TABLE questionnaire_submissions
ADD COLUMN sequence_no INTEGER CHECK (
  sequence_no IS NULL OR (typeof(sequence_no) = 'integer' AND sequence_no >= 1)
);

CREATE UNIQUE INDEX questionnaire_submissions_session_sequence_idx
ON questionnaire_submissions (session_id, sequence_no)
WHERE sequence_no IS NOT NULL;

CREATE UNIQUE INDEX questionnaire_submissions_one_post_idx
ON questionnaire_submissions (session_id)
WHERE phase = 'post';

CREATE UNIQUE INDEX questionnaire_submissions_one_task_experience_idx
ON questionnaire_submissions (session_id)
WHERE phase = 'task_experience';

CREATE INDEX questionnaire_submissions_session_phase_idx
ON questionnaire_submissions (session_id, phase);

CREATE TRIGGER questionnaire_submissions_sequence_required_insert
BEFORE INSERT ON questionnaire_submissions
WHEN NEW.phase IN ('post', 'task_experience')
  AND (
    NEW.sequence_no IS NULL
    OR typeof(NEW.sequence_no) <> 'integer'
    OR NEW.sequence_no < 1
  )
BEGIN
  SELECT RAISE(ABORT, 'post-task questionnaire sequence is required');
END;

CREATE TRIGGER questionnaire_submissions_identity_immutable
BEFORE UPDATE OF submission_id, event_id, session_id, phase,
  instrument_version, sequence_no
ON questionnaire_submissions
BEGIN
  SELECT RAISE(ABORT, 'questionnaire submission identity is immutable');
END;

CREATE TRIGGER questionnaire_answers_no_update
BEFORE UPDATE ON questionnaire_answers
BEGIN
  SELECT RAISE(ABORT, 'questionnaire answers cannot be updated');
END;

ALTER TABLE sessions ADD COLUMN post_task_completed_at TEXT;
ALTER TABLE sessions ADD COLUMN task_experience_completed_at TEXT;

CREATE TRIGGER sessions_post_task_completed_at_immutable
BEFORE UPDATE OF post_task_completed_at ON sessions
WHEN OLD.post_task_completed_at IS NOT NULL
  AND NEW.post_task_completed_at IS NOT OLD.post_task_completed_at
BEGIN
  SELECT RAISE(ABORT, 'post-task completion time is immutable');
END;

CREATE TRIGGER sessions_task_experience_completed_at_immutable
BEFORE UPDATE OF task_experience_completed_at ON sessions
WHEN OLD.task_experience_completed_at IS NOT NULL
  AND NEW.task_experience_completed_at IS NOT OLD.task_experience_completed_at
BEGIN
  SELECT RAISE(ABORT, 'task-experience completion time is immutable');
END;

CREATE TABLE completion_records (
  completion_id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL UNIQUE,
  session_id TEXT NOT NULL UNIQUE,
  final_decision_id TEXT NOT NULL,
  post_submission_id TEXT NOT NULL,
  task_experience_submission_id TEXT NOT NULL,
  completion_status TEXT NOT NULL CHECK (
    completion_status IN ('completed', 'timeout')
  ),
  final_submit_mode TEXT NOT NULL CHECK (
    final_submit_mode IN ('active', 'timeout')
  ),
  client_completed_at TEXT NOT NULL,
  server_completed_at TEXT NOT NULL,
  sequence_no INTEGER NOT NULL CHECK (
    typeof(sequence_no) = 'integer' AND sequence_no >= 1
  ),
  created_at TEXT NOT NULL,
  FOREIGN KEY (session_id) REFERENCES sessions(session_id) ON DELETE CASCADE,
  FOREIGN KEY (final_decision_id) REFERENCES final_decisions(final_decision_id) ON DELETE CASCADE,
  FOREIGN KEY (post_submission_id) REFERENCES questionnaire_submissions(submission_id) ON DELETE CASCADE,
  FOREIGN KEY (task_experience_submission_id) REFERENCES questionnaire_submissions(submission_id) ON DELETE CASCADE,
  UNIQUE (session_id, sequence_no),
  CHECK (
    (final_submit_mode = 'active' AND completion_status = 'completed')
    OR (final_submit_mode = 'timeout' AND completion_status = 'timeout')
  )
);

CREATE INDEX completion_records_server_completed_idx
ON completion_records (server_completed_at);

CREATE INDEX completion_records_status_idx
ON completion_records (completion_status);

CREATE TRIGGER completion_records_integrity_insert
BEFORE INSERT ON completion_records
WHEN NOT EXISTS (
    SELECT 1 FROM final_decisions f
    WHERE f.final_decision_id = NEW.final_decision_id
      AND f.session_id = NEW.session_id
      AND f.submit_mode = NEW.final_submit_mode
      AND f.server_submitted_at <= NEW.server_completed_at
      AND f.sequence_no < NEW.sequence_no
  )
  OR NOT EXISTS (
    SELECT 1 FROM questionnaire_submissions q
    WHERE q.submission_id = NEW.post_submission_id
      AND q.session_id = NEW.session_id
      AND q.phase = 'post'
      AND q.sequence_no IS NOT NULL
      AND q.sequence_no < NEW.sequence_no
  )
  OR NOT EXISTS (
    SELECT 1 FROM questionnaire_submissions q
    WHERE q.submission_id = NEW.task_experience_submission_id
      AND q.session_id = NEW.session_id
      AND q.phase = 'task_experience'
      AND q.sequence_no IS NOT NULL
      AND q.sequence_no < NEW.sequence_no
  )
BEGIN
  SELECT RAISE(ABORT, 'completion references are inconsistent');
END;

CREATE TRIGGER completion_records_no_update
BEFORE UPDATE ON completion_records
BEGIN
  SELECT RAISE(ABORT, 'completion records cannot be updated');
END;

ALTER TABLE game_events RENAME TO game_events_v6;

CREATE TABLE game_events (
  event_id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  event_type TEXT NOT NULL CHECK (
    event_type IN (
      'game_start', 'rating_submit', 'stage_choice_submit',
      'evidence_unlock', 'timer_expired', 'sunk_cost_show',
      'sunk_cost_choice', 'final_submit', 'post_task_submit',
      'task_experience_submit', 'session_complete'
    )
  ),
  candidate_id TEXT CHECK (
    candidate_id IS NULL OR candidate_id IN ('A', 'B', 'C', 'D', 'E')
  ),
  stage TEXT CHECK (
    stage IS NULL OR stage IN (
      'T1', 'T1_COMPLETE', 'T2', 'T3', 'DECISION', 'final'
    )
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
FROM game_events_v6;

DROP TABLE game_events_v6;

CREATE INDEX game_events_session_sequence_idx
ON game_events (session_id, server_sequence);

UPDATE app_metadata
SET value = '7', updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE key = 'schema_version';
