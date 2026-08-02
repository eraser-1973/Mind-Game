import type { AuthenticatedSession } from '../auth/sessionAuth'
import {
  POST_TASK_INSTRUMENT,
  TASK_EXPERIENCE_INSTRUMENT,
  type QuestionnaireInstrument,
} from '../domain/questionnaireInstruments'
import type { FormalCompletionInput } from '../validation/formalCompletionRequest'
import { ensurePrepilotScoringRun } from './prepilotScoring'

type CompletionRow = {
  completion_id: string
  event_id: string
  session_id: string
  completion_status: 'completed' | 'timeout'
  final_submit_mode: 'active' | 'timeout'
  server_completed_at: string
  sequence_no: number
}

type FinalRow = {
  final_decision_id: string
  submit_mode: 'active' | 'timeout'
  server_submitted_at: string
}

type SubmissionRow = {
  submission_id: string
  event_id: string
  phase: string
  instrument_version: string
  item_count: number
  sequence_no: number | null
}

type RunRow = {
  points_total: number
  points_remaining: number
  last_sequence_no: number
  finalized_at: string | null
}

export class FormalCompletionError extends Error {
  constructor(
    readonly status: 409 | 500,
    readonly code: string,
    message: string,
  ) {
    super(message)
    this.name = 'FormalCompletionError'
  }
}

function conflict(code: string, message: string) {
  return new FormalCompletionError(409, code, message)
}

function inconsistent() {
  return new FormalCompletionError(
    500,
    'SESSION_DATA_INCONSISTENT',
    'The formal session data is inconsistent and cannot be completed.',
  )
}

async function markInconsistent(db: D1Database, sessionId: string): Promise<never> {
  await db.prepare(
    'UPDATE sessions SET error_count=error_count+1 WHERE session_id=?',
  ).bind(sessionId).run()
  throw inconsistent()
}

async function findCompletionByEvent(db: D1Database, eventId: string) {
  return db.prepare(`SELECT completion_id,event_id,session_id,completion_status,
    final_submit_mode,server_completed_at,sequence_no FROM completion_records
    WHERE event_id=?`).bind(eventId).first<CompletionRow>()
}

async function findCompletionForSession(db: D1Database, sessionId: string) {
  return db.prepare(`SELECT completion_id,event_id,session_id,completion_status,
    final_submit_mode,server_completed_at,sequence_no FROM completion_records
    WHERE session_id=?`).bind(sessionId).first<CompletionRow>()
}

function projection(row: CompletionRow, created: boolean) {
  return {
    created,
    alreadyCompleted: !created,
    sessionId: row.session_id,
    currentStep: 'completed' as const,
    completionStatus: row.completion_status,
    finalSubmitMode: row.final_submit_mode,
    serverCompletedAt: row.server_completed_at,
    sequenceNo: row.sequence_no,
  }
}

async function projectionAfterScoring(
  db: D1Database,
  row: CompletionRow,
  created: boolean,
) {
  const safeProjection = projection(row, created)
  try {
    await ensurePrepilotScoringRun(db, row.session_id)
  } catch {
    // Formal completion is the durable source fact. Stage 8 scoring is an
    // isolated internal follow-up and must never change the participant reply.
    console.error('PREPILOT_SCORING_FOLLOW_UP_FAILED')
  }
  return safeProjection
}

async function loadSubmission(
  db: D1Database,
  sessionId: string,
  phase: 'post' | 'task_experience',
) {
  return db.prepare(`SELECT submission_id,event_id,phase,instrument_version,
    item_count,sequence_no FROM questionnaire_submissions
    WHERE session_id=? AND phase=?`).bind(sessionId, phase).first<SubmissionRow>()
}

async function submissionIsValid(
  db: D1Database,
  sessionId: string,
  submission: SubmissionRow | null,
  instrument: QuestionnaireInstrument,
  eventType: 'post_task_submit' | 'task_experience_submit',
) {
  if (!submission || submission.phase !== instrument.phase ||
    submission.instrument_version !== instrument.version ||
    submission.item_count !== instrument.items.length ||
    submission.sequence_no === null || submission.sequence_no < 1) return false
  const answers = await db.prepare(`SELECT item_id,value,touched FROM questionnaire_answers
    WHERE submission_id=? ORDER BY item_id`).bind(submission.submission_id)
    .all<{ item_id: string; value: number; touched: number }>()
  if (answers.results.length !== instrument.items.length) return false
  const byId = new Map(answers.results.map((answer) => [answer.item_id, answer]))
  if (!instrument.items.every((item) => {
    const answer = byId.get(item.id)
    return answer?.touched === 1 && Number.isInteger(answer.value) &&
      answer.value >= item.min && answer.value <= item.max
  })) return false
  const event = await db.prepare(`SELECT server_sequence FROM game_events
    WHERE event_id=? AND session_id=? AND event_type=?`)
    .bind(submission.event_id, sessionId, eventType)
    .first<{ server_sequence: number }>()
  return event?.server_sequence === submission.sequence_no
}

async function pointLedgerIsValid(
  db: D1Database,
  sessionId: string,
  run: RunRow,
) {
  const ledger = await db.prepare(`SELECT points_before,points_delta,points_after
    FROM point_ledger WHERE session_id=? ORDER BY sequence_no`)
    .bind(sessionId).all<{
      points_before: number
      points_delta: number
      points_after: number
    }>()
  let expected = run.points_total
  for (const row of ledger.results) {
    if (row.points_before !== expected || row.points_delta >= 0 ||
      row.points_after !== row.points_before + row.points_delta) return false
    expected = row.points_after
  }
  return expected === run.points_remaining
}

export async function completeFormalSession(
  db: D1Database,
  session: AuthenticatedSession,
  input: FormalCompletionInput,
) {
  const replay = await findCompletionByEvent(db, input.eventId)
  if (replay) {
    if (replay.session_id !== session.sessionId) {
      throw conflict('IDEMPOTENCY_CONFLICT', 'The idempotency key cannot be reused.')
    }
    return projectionAfterScoring(db, replay, false)
  }
  const existing = await findCompletionForSession(db, session.sessionId)
  if (existing) return projectionAfterScoring(db, existing, false)
  if (session.currentStep !== 'completion_pending') {
    throw conflict('INVALID_SESSION_STEP', 'The session is not ready to be completed.')
  }

  const [finalDecision, post, taskExperience, run] = await Promise.all([
    db.prepare(`SELECT final_decision_id,submit_mode,server_submitted_at
      FROM final_decisions WHERE session_id=?`).bind(session.sessionId).first<FinalRow>(),
    loadSubmission(db, session.sessionId, 'post'),
    loadSubmission(db, session.sessionId, 'task_experience'),
    db.prepare(`SELECT points_total,points_remaining,last_sequence_no,finalized_at
      FROM game_runs WHERE session_id=?`).bind(session.sessionId).first<RunRow>(),
  ])
  if (!finalDecision || !post || !taskExperience || !run || !run.finalized_at) {
    await markInconsistent(db, session.sessionId)
  }
  const sealedFinal = finalDecision!
  const postSubmission = post!
  const taskSubmission = taskExperience!
  const sealedRun = run!

  const statusRow = await db.prepare(`SELECT final_submit_mode,completion_status
    FROM sessions WHERE session_id=?`).bind(session.sessionId).first<{
      final_submit_mode: string
      completion_status: string
    }>()
  const finalModeMatches = statusRow?.final_submit_mode === sealedFinal.submit_mode &&
    ((sealedFinal.submit_mode === 'active' && statusRow.completion_status === 'in_progress') ||
      (sealedFinal.submit_mode === 'timeout' && statusRow.completion_status === 'timeout'))
  const [postValid, taskValid, ledgerValid] = await Promise.all([
    submissionIsValid(db, session.sessionId, postSubmission, POST_TASK_INSTRUMENT, 'post_task_submit'),
    submissionIsValid(
      db,
      session.sessionId,
      taskSubmission,
      TASK_EXPERIENCE_INSTRUMENT,
      'task_experience_submit',
    ),
    pointLedgerIsValid(db, session.sessionId, sealedRun),
  ])
  if (!finalModeMatches || !postValid || !taskValid || !ledgerValid) {
    await markInconsistent(db, session.sessionId)
  }

  for (let attempt = 0; attempt < 4; attempt += 1) {
    const serverCompletedAt = new Date().toISOString()
    if (Date.parse(serverCompletedAt) < Date.parse(sealedFinal.server_submitted_at)) {
      await markInconsistent(db, session.sessionId)
    }
    const sequenceNo = sealedRun.last_sequence_no + 1
    const terminalStatus = sealedFinal.submit_mode === 'active' ? 'completed' : 'timeout'
    const completionId = crypto.randomUUID()
    try {
      await db.batch([
        db.prepare(`INSERT INTO completion_records (
          completion_id,event_id,session_id,final_decision_id,post_submission_id,
          task_experience_submission_id,completion_status,final_submit_mode,
          client_completed_at,server_completed_at,sequence_no,created_at
        ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`).bind(
          completionId,
          input.eventId,
          session.sessionId,
          sealedFinal.final_decision_id,
          postSubmission.submission_id,
          taskSubmission.submission_id,
          terminalStatus,
          sealedFinal.submit_mode,
          input.clientCompletedAt,
          serverCompletedAt,
          sequenceNo,
          serverCompletedAt,
        ),
        db.prepare(`INSERT INTO game_events (
          event_id,session_id,event_type,candidate_id,stage,client_sequence,
          server_sequence,client_at,server_at,payload_json
        ) VALUES (?,?,'session_complete',NULL,NULL,?,?,?,?,json(?))`).bind(
          input.eventId,
          session.sessionId,
          input.clientSequence,
          sequenceNo,
          input.clientCompletedAt,
          serverCompletedAt,
          JSON.stringify({
            completionStatus: terminalStatus,
            finalSubmitMode: sealedFinal.submit_mode,
          }),
        ),
        db.prepare(`UPDATE game_runs SET last_sequence_no=?,updated_at=?
          WHERE session_id=? AND last_sequence_no=?`).bind(
          sequenceNo,
          serverCompletedAt,
          session.sessionId,
          sealedRun.last_sequence_no,
        ),
        db.prepare(`UPDATE sessions SET current_step='completed',completion_status=?,
          ended_at=? WHERE session_id=? AND current_step='completion_pending'
          AND ended_at IS NULL`).bind(
          terminalStatus,
          serverCompletedAt,
          session.sessionId,
        ),
      ])
      const saved = await findCompletionByEvent(db, input.eventId)
      if (!saved) throw inconsistent()
      return projectionAfterScoring(db, saved, true)
    } catch {
      const winner = await findCompletionForSession(db, session.sessionId)
      if (winner) return projectionAfterScoring(db, winner, false)
      throw inconsistent()
    }
  }
  throw inconsistent()
}

export async function loadCompletionProjection(
  db: D1Database,
  sessionId: string,
) {
  const completion = await findCompletionForSession(db, sessionId)
  return completion ? projection(completion, false) : null
}
