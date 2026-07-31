CREATE TABLE consent_records (
  consent_id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL UNIQUE,
  session_id TEXT NOT NULL UNIQUE,
  consent_version TEXT NOT NULL CHECK (length(trim(consent_version)) > 0),
  accepted INTEGER NOT NULL CHECK (accepted = 1),
  client_accepted_at TEXT NOT NULL,
  server_accepted_at TEXT NOT NULL,
  FOREIGN KEY (session_id) REFERENCES sessions(session_id) ON DELETE CASCADE
);

CREATE INDEX consent_records_session_id_idx
ON consent_records (session_id);

CREATE TABLE demographic_revisions (
  demographic_revision_id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL UNIQUE,
  session_id TEXT NOT NULL,
  revision_no INTEGER NOT NULL CHECK (revision_no >= 1),
  is_current INTEGER NOT NULL CHECK (is_current IN (0, 1)),
  age_range TEXT NOT NULL CHECK (
    age_range IN ('18–20', '21–23', '24及以上', '不愿透露')
  ),
  gender TEXT NOT NULL CHECK (
    gender IN ('男', '女', '其他', '不愿透露')
  ),
  education TEXT NOT NULL CHECK (
    education IN ('本科', '硕士', '其他', '不愿透露')
  ),
  grade TEXT NOT NULL CHECK (
    grade IN ('大一', '大二', '大三', '大四', '研究生', '不愿透露')
  ),
  major_category TEXT NOT NULL CHECK (
    major_category IN (
      '心理学', '计算机或人工智能', '经管', '理工科',
      '人文社科', '其他', '不愿透露'
    )
  ),
  related_experience_json TEXT NOT NULL CHECK (
    json_valid(related_experience_json)
    AND json_type(related_experience_json) = 'array'
    AND json_array_length(related_experience_json) >= 1
  ),
  client_submitted_at TEXT NOT NULL,
  server_submitted_at TEXT NOT NULL,
  FOREIGN KEY (session_id) REFERENCES sessions(session_id) ON DELETE CASCADE,
  UNIQUE (session_id, revision_no)
);

CREATE INDEX demographic_revisions_session_id_idx
ON demographic_revisions (session_id);

CREATE UNIQUE INDEX demographic_revisions_one_current_idx
ON demographic_revisions (session_id)
WHERE is_current = 1;

CREATE TABLE questionnaire_submissions (
  submission_id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL UNIQUE,
  session_id TEXT NOT NULL,
  phase TEXT NOT NULL CHECK (
    phase IN ('pre', 'post', 'manipulation', 'task_experience')
  ),
  instrument_version TEXT NOT NULL CHECK (
    length(trim(instrument_version)) > 0
  ),
  client_started_at TEXT NOT NULL,
  client_submitted_at TEXT NOT NULL,
  server_submitted_at TEXT NOT NULL,
  item_count INTEGER NOT NULL CHECK (item_count >= 1),
  FOREIGN KEY (session_id) REFERENCES sessions(session_id) ON DELETE CASCADE
);

CREATE INDEX questionnaire_submissions_session_id_idx
ON questionnaire_submissions (session_id);

CREATE UNIQUE INDEX questionnaire_submissions_one_pre_idx
ON questionnaire_submissions (session_id)
WHERE phase = 'pre';

CREATE TABLE questionnaire_answers (
  answer_id TEXT PRIMARY KEY,
  submission_id TEXT NOT NULL,
  item_id TEXT NOT NULL CHECK (length(trim(item_id)) > 0),
  value INTEGER NOT NULL CHECK (value BETWEEN 0 AND 10),
  touched INTEGER NOT NULL CHECK (touched IN (0, 1)),
  answered_at TEXT NOT NULL,
  FOREIGN KEY (submission_id) REFERENCES questionnaire_submissions(submission_id) ON DELETE CASCADE,
  UNIQUE (submission_id, item_id)
);

CREATE INDEX questionnaire_answers_submission_id_idx
ON questionnaire_answers (submission_id);

UPDATE app_metadata
SET value = '3',
    updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE key = 'schema_version';
