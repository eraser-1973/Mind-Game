import type {
  ConsentInput,
  DemographicsInput,
  PostGameQuestionnaireInput,
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
  sequence_no: number | null
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
            server_submitted_at, item_count, sequence_no
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
            server_submitted_at, item_count, sequence_no
     FROM questionnaire_submissions
     WHERE session_id = ? AND phase = 'pre'`,
  ).bind(sessionId).first<QuestionnaireSubmissionRow>()
}

export async function findQuestionnaireForPhase(
  db: D1Database,
  sessionId: string,
  phase: 'post' | 'task_experience',
): Promise<QuestionnaireSubmissionRow | null> {
  return db.prepare(
    `SELECT submission_id, event_id, session_id, phase,
            instrument_version, client_started_at, client_submitted_at,
            server_submitted_at, item_count, sequence_no
     FROM questionnaire_submissions
     WHERE session_id = ? AND phase = ?`,
  ).bind(sessionId, phase).first<QuestionnaireSubmissionRow>()
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

export async function insertPostGameQuestionnaire(
  db: D1Database,
  input: PostGameQuestionnaireInput,
  submissionId: string,
  sequenceNo: number,
  previousSequenceNo: number,
  serverSubmittedAt: string,
): Promise<void> {
  const eventType = input.phase === 'post'
    ? 'post_task_submit'
    : 'task_experience_submit'
  const currentStep = input.phase === 'post' ? 'post_task' : 'task_experience'
  const nextStep = input.phase === 'post' ? 'task_experience' : 'completion_pending'
  const sessionUpdate = input.phase === 'post'
    ? `UPDATE sessions SET current_step=?,post_task_completed_at=?
       WHERE session_id=? AND current_step=? AND post_task_completed_at IS NULL`
    : `UPDATE sessions SET current_step=?,task_experience_completed_at=?
       WHERE session_id=? AND current_step=? AND task_experience_completed_at IS NULL`
  await db.batch([
    db.prepare(
      `INSERT INTO questionnaire_submissions (
        submission_id,event_id,session_id,phase,instrument_version,
        client_started_at,client_submitted_at,server_submitted_at,item_count,
        sequence_no
      ) VALUES (?,?,?,?,?,?,?,?,?,?)`,
    ).bind(
      submissionId,
      input.eventId,
      input.sessionId,
      input.phase,
      input.instrumentVersion,
      input.clientSubmittedAt,
      input.clientSubmittedAt,
      serverSubmittedAt,
      input.answers.length,
      sequenceNo,
    ),
    ...input.answers.map((answer) => db.prepare(
      `INSERT INTO questionnaire_answers (
        answer_id,submission_id,item_id,value,touched,answered_at
      ) VALUES (?,?,?,?,1,?)`,
    ).bind(
      crypto.randomUUID(),
      submissionId,
      answer.itemId,
      answer.value,
      answer.answeredAt,
    )),
    db.prepare(
      `INSERT INTO game_events (
        event_id,session_id,event_type,candidate_id,stage,client_sequence,
        server_sequence,client_at,server_at,payload_json
      ) VALUES (?,?,?,NULL,NULL,NULL,?,?,?,json(?))`,
    ).bind(
      input.eventId,
      input.sessionId,
      eventType,
      sequenceNo,
      input.clientSubmittedAt,
      serverSubmittedAt,
      JSON.stringify({
        phase: input.phase,
        instrumentVersion: input.instrumentVersion,
        itemCount: input.answers.length,
      }),
    ),
    db.prepare(
      `UPDATE game_runs SET last_sequence_no=?,updated_at=?
       WHERE session_id=? AND last_sequence_no=?`,
    ).bind(sequenceNo, serverSubmittedAt, input.sessionId, previousSequenceNo),
    db.prepare(sessionUpdate).bind(
      nextStep,
      serverSubmittedAt,
      input.sessionId,
      currentStep,
    ),
  ])
}
