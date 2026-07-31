import type {
  ConsentInput,
  DemographicsInput,
  PreTaskQuestionnaireInput,
} from '../validation/researchIntakeRequest'

export type ConsentRow = {
  event_id: string
  session_id: string
  consent_version: string
  client_accepted_at: string
  server_accepted_at: string
}

export type DemographicRow = {
  event_id: string
  session_id: string
  revision_no: number
  age_range: string
  gender: string
  education: string
  grade: string
  major_category: string
  related_experience_json: string
  client_submitted_at: string
  server_submitted_at: string
}

export type QuestionnaireSubmissionRow = {
  submission_id: string
  event_id: string
  session_id: string
  phase: string
  instrument_version: string
  client_started_at: string
  client_submitted_at: string
  server_submitted_at: string
  item_count: number
}

export type QuestionnaireAnswerRow = {
  item_id: string
  value: number
  touched: number
  answered_at: string
}

export async function findConsentByEvent(
  db: D1Database,
  eventId: string,
): Promise<ConsentRow | null> {
  return db.prepare(
    `SELECT event_id, session_id, consent_version,
            client_accepted_at, server_accepted_at
     FROM consent_records WHERE event_id = ?`,
  ).bind(eventId).first<ConsentRow>()
}

export async function findConsentForSession(
  db: D1Database,
  sessionId: string,
): Promise<ConsentRow | null> {
  return db.prepare(
    `SELECT event_id, session_id, consent_version,
            client_accepted_at, server_accepted_at
     FROM consent_records WHERE session_id = ?`,
  ).bind(sessionId).first<ConsentRow>()
}

export async function insertConsentAndAdvance(
  db: D1Database,
  input: ConsentInput,
  serverAcceptedAt: string,
): Promise<void> {
  await db.batch([
    db.prepare(
      `INSERT INTO consent_records (
        consent_id, event_id, session_id, consent_version, accepted,
        client_accepted_at, server_accepted_at
      ) VALUES (?, ?, ?, ?, 1, ?, ?)`,
    ).bind(
      crypto.randomUUID(),
      input.eventId,
      input.sessionId,
      input.consentVersion,
      input.clientAcceptedAt,
      serverAcceptedAt,
    ),
    db.prepare(
      `UPDATE sessions SET current_step = 'demographics'
       WHERE session_id = ? AND current_step = 'consent_pending'`,
    ).bind(input.sessionId),
  ])
}

export async function findDemographicByEvent(
  db: D1Database,
  eventId: string,
): Promise<DemographicRow | null> {
  return db.prepare(
    `SELECT event_id, session_id, revision_no, age_range, gender,
            education, grade, major_category, related_experience_json,
            client_submitted_at, server_submitted_at
     FROM demographic_revisions WHERE event_id = ?`,
  ).bind(eventId).first<DemographicRow>()
}

export async function findCurrentDemographics(
  db: D1Database,
  sessionId: string,
): Promise<DemographicRow | null> {
  return db.prepare(
    `SELECT event_id, session_id, revision_no, age_range, gender,
            education, grade, major_category, related_experience_json,
            client_submitted_at, server_submitted_at
     FROM demographic_revisions
     WHERE session_id = ? AND is_current = 1`,
  ).bind(sessionId).first<DemographicRow>()
}

export async function insertDemographicRevision(
  db: D1Database,
  input: DemographicsInput,
  revisionNo: number,
  serverSubmittedAt: string,
): Promise<void> {
  await db.batch([
    db.prepare(
      `UPDATE demographic_revisions SET is_current = 0
       WHERE session_id = ? AND is_current = 1`,
    ).bind(input.sessionId),
    db.prepare(
      `INSERT INTO demographic_revisions (
        demographic_revision_id, event_id, session_id, revision_no,
        is_current, age_range, gender, education, grade, major_category,
        related_experience_json, client_submitted_at, server_submitted_at
      ) VALUES (?, ?, ?, ?, 1, ?, ?, ?, ?, ?, json(?), ?, ?)`,
    ).bind(
      crypto.randomUUID(),
      input.eventId,
      input.sessionId,
      revisionNo,
      input.demographics.ageRange,
      input.demographics.gender,
      input.demographics.education,
      input.demographics.grade,
      input.demographics.majorCategory,
      JSON.stringify(input.demographics.relatedExperience),
      input.clientSubmittedAt,
      serverSubmittedAt,
    ),
    db.prepare(
      `UPDATE sessions SET current_step = CASE
         WHEN current_step = 'demographics' THEN 'pre_task'
         ELSE current_step END
       WHERE session_id = ? AND current_step IN ('demographics', 'pre_task')`,
    ).bind(input.sessionId),
  ])
}

export async function findQuestionnaireByEvent(
  db: D1Database,
  eventId: string,
): Promise<QuestionnaireSubmissionRow | null> {
  return db.prepare(
    `SELECT submission_id, event_id, session_id, phase,
            instrument_version, client_started_at, client_submitted_at,
            server_submitted_at, item_count
     FROM questionnaire_submissions WHERE event_id = ?`,
  ).bind(eventId).first<QuestionnaireSubmissionRow>()
}

export async function findPreTaskQuestionnaire(
  db: D1Database,
  sessionId: string,
): Promise<QuestionnaireSubmissionRow | null> {
  return db.prepare(
    `SELECT submission_id, event_id, session_id, phase,
            instrument_version, client_started_at, client_submitted_at,
            server_submitted_at, item_count
     FROM questionnaire_submissions
     WHERE session_id = ? AND phase = 'pre'`,
  ).bind(sessionId).first<QuestionnaireSubmissionRow>()
}

export async function findQuestionnaireAnswers(
  db: D1Database,
  submissionId: string,
): Promise<QuestionnaireAnswerRow[]> {
  const result = await db.prepare(
    `SELECT item_id, value, touched, answered_at
     FROM questionnaire_answers
     WHERE submission_id = ? ORDER BY item_id`,
  ).bind(submissionId).all<QuestionnaireAnswerRow>()
  return result.results
}

export async function insertPreTaskQuestionnaire(
  db: D1Database,
  input: PreTaskQuestionnaireInput,
  submissionId: string,
  serverSubmittedAt: string,
): Promise<void> {
  const statements: D1PreparedStatement[] = [
    db.prepare(
      `INSERT INTO questionnaire_submissions (
        submission_id, event_id, session_id, phase, instrument_version,
        client_started_at, client_submitted_at, server_submitted_at, item_count
      ) VALUES (?, ?, ?, 'pre', ?, ?, ?, ?, ?)`,
    ).bind(
      submissionId,
      input.eventId,
      input.sessionId,
      input.instrumentVersion,
      input.clientStartedAt,
      input.clientSubmittedAt,
      serverSubmittedAt,
      input.answers.length,
    ),
    ...input.answers.map((answer) => db.prepare(
      `INSERT INTO questionnaire_answers (
        answer_id, submission_id, item_id, value, touched, answered_at
      ) VALUES (?, ?, ?, ?, 1, ?)`,
    ).bind(
      crypto.randomUUID(),
      submissionId,
      answer.itemId,
      answer.value,
      answer.answeredAt,
    )),
    db.prepare(
      `UPDATE sessions SET current_step = 'game_ready'
       WHERE session_id = ? AND current_step = 'pre_task'`,
    ).bind(input.sessionId),
  ]
  await db.batch(statements)
}
