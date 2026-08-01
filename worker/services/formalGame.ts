import type { AuthenticatedSession } from '../auth/sessionAuth'
import { isCandidateDisplayOrder } from '../domain/candidateOrder'
import { FormalGameError } from '../domain/formalGameError'
import {
  createFormalDeadline,
  createGameClockSnapshot,
  FORMAL_GAME_DURATION_SEC,
} from '../domain/gameClock'
import { deriveFormalStageStatus } from '../domain/formalStage'
import type {
  FormalRatingInput,
  FormalRatingStage,
  FormalStageChoiceInput,
  StartGameInput,
} from '../validation/formalGameRequest'
import {
  loadEvidenceUnlockRows,
  projectEvidenceUnlockForResume,
} from './formalEvidence'
import { assertNoPendingSunkCost, finalizeExpiredFormalGame } from './sunkCostFinal'
import { loadSafeFinalDecision, loadSafeSunkCost } from './sunkCostFinal'

export { FormalGameError } from '../domain/formalGameError'

type GameRunRow = {
  session_id: string
  start_event_id: string
  current_stage: string
  duration_sec: number
  points_total: number
  points_remaining: number
  last_sequence_no: number
  started_at: string
  deadline_at: string
  time_expired_at: string | null
  t1_completed_at: string | null
  updated_at: string
}

type RatingRow = {
  rating_id: string
  event_id: string
  session_id: string
  candidate_id: string
  stage: FormalRatingStage
  rating_value: number
  evidence_ids_seen: string
  client_submitted_at: string
  server_submitted_at: string
  sequence_no: number
}

type ChoiceRow = {
  choice_id: string
  event_id: string
  session_id: string
  stage: FormalRatingStage
  candidate_id: string
  confidence: number
  client_submitted_at: string
  server_submitted_at: string
  sequence_no: number
}

function conflict(code: string, message: string): FormalGameError {
  return new FormalGameError(409, code, message)
}

function failed(code = 'FORMAL_GAME_SAVE_FAILED', message = 'The formal game request could not be saved.') {
  return new FormalGameError(500, code, message)
}

async function findRun(db: D1Database, sessionId: string): Promise<GameRunRow | null> {
  return db.prepare(`SELECT session_id, start_event_id, current_stage,
    duration_sec, points_total, points_remaining, last_sequence_no,
    started_at, deadline_at, time_expired_at, t1_completed_at, updated_at
    FROM game_runs WHERE session_id = ?`)
    .bind(sessionId)
    .first<GameRunRow>()
}

async function findRunByStartEvent(db: D1Database, eventId: string): Promise<GameRunRow | null> {
  return db.prepare(`SELECT session_id, start_event_id, current_stage,
    duration_sec, points_total, points_remaining, last_sequence_no,
    started_at, deadline_at, time_expired_at, t1_completed_at, updated_at
    FROM game_runs WHERE start_event_id = ?`)
    .bind(eventId)
    .first<GameRunRow>()
}

async function loadPointTotal(db: D1Database, pointRuleVersion: string): Promise<number> {
  const row = await db.prepare(`SELECT total_points FROM point_rules
    WHERE point_rule_version = ? AND status = 'published'`)
    .bind(pointRuleVersion).first<{ total_points: number }>()
  if (!row) {
    throw new FormalGameError(503, 'POINT_RULE_NOT_READY', 'The point rule is not available.')
  }
  return row.total_points
}

async function findRatingByEvent(db: D1Database, eventId: string): Promise<RatingRow | null> {
  return db.prepare(`SELECT rating_id, event_id, session_id, candidate_id,
    stage, rating_value, evidence_ids_seen, client_submitted_at,
    server_submitted_at, sequence_no FROM stage_ratings WHERE event_id = ?`)
    .bind(eventId).first<RatingRow>()
}

async function findRating(
  db: D1Database,
  sessionId: string,
  candidateId: string,
  stage: FormalRatingStage,
): Promise<RatingRow | null> {
  return db.prepare(`SELECT rating_id, event_id, session_id, candidate_id,
    stage, rating_value, evidence_ids_seen, client_submitted_at,
    server_submitted_at, sequence_no FROM stage_ratings
    WHERE session_id = ? AND candidate_id = ? AND stage = ?`)
    .bind(sessionId, candidateId, stage).first<RatingRow>()
}

async function findChoiceByEvent(db: D1Database, eventId: string): Promise<ChoiceRow | null> {
  return db.prepare(`SELECT choice_id, event_id, session_id, stage,
    candidate_id, confidence, client_submitted_at, server_submitted_at,
    sequence_no FROM stage_choices WHERE event_id = ?`)
    .bind(eventId).first<ChoiceRow>()
}

async function findChoice(
  db: D1Database,
  sessionId: string,
  stage: FormalRatingStage,
): Promise<ChoiceRow | null> {
  return db.prepare(`SELECT choice_id, event_id, session_id, stage,
    candidate_id, confidence, client_submitted_at, server_submitted_at,
    sequence_no FROM stage_choices WHERE session_id = ? AND stage = ?`)
    .bind(sessionId, stage).first<ChoiceRow>()
}

async function eventOwner(db: D1Database, eventId: string): Promise<string | null> {
  const row = await db.prepare('SELECT session_id FROM game_events WHERE event_id = ?')
    .bind(eventId).first<{ session_id: string }>()
  return row?.session_id ?? null
}

function parseOrder(session: AuthenticatedSession) {
  try {
    const value: unknown = JSON.parse(session.candidateDisplayOrder)
    if (isCandidateDisplayOrder(value)) return value
  } catch {
    // Fall through to the sanitized integrity error.
  }
  throw failed()
}

function parseEvidenceIds(value: string): string[] {
  try {
    const parsed: unknown = JSON.parse(value)
    if (Array.isArray(parsed) && parsed.every((item) => typeof item === 'string')) {
      return parsed
    }
  } catch {
    // Fall through to the sanitized integrity error.
  }
  throw failed()
}

function ratingProjection(row: RatingRow) {
  return {
    candidateId: row.candidate_id,
    stage: row.stage,
    ratingValue: row.rating_value,
    evidenceIdsSeen: parseEvidenceIds(row.evidence_ids_seen),
    sealed: true as const,
    sequenceNo: row.sequence_no,
    serverSubmittedAt: row.server_submitted_at,
  }
}

function choiceProjection(row: ChoiceRow) {
  return {
    stage: row.stage,
    candidateId: row.candidate_id,
    confidence: row.confidence,
    sealed: true as const,
    sequenceNo: row.sequence_no,
    serverSubmittedAt: row.server_submitted_at,
  }
}

async function loadRatings(db: D1Database, sessionId: string): Promise<RatingRow[]> {
  const result = await db.prepare(`SELECT rating_id, event_id, session_id,
    candidate_id, stage, rating_value, evidence_ids_seen, client_submitted_at,
    server_submitted_at, sequence_no FROM stage_ratings
    WHERE session_id = ? ORDER BY sequence_no`)
    .bind(sessionId).all<RatingRow>()
  return result.results
}

async function loadChoices(db: D1Database, sessionId: string): Promise<ChoiceRow[]> {
  const result = await db.prepare(`SELECT choice_id, event_id, session_id,
    stage, candidate_id, confidence, client_submitted_at, server_submitted_at,
    sequence_no FROM stage_choices WHERE session_id = ? ORDER BY sequence_no`)
    .bind(sessionId).all<ChoiceRow>()
  return result.results
}

async function projectRun(
  db: D1Database,
  session: AuthenticatedSession,
  run: GameRunRow,
  serverNow = new Date(),
) {
  const configuredTotal = await loadPointTotal(db, session.pointRuleVersion)
  if (
    session.startedAt !== run.started_at ||
    session.deadlineAt !== run.deadline_at ||
    run.duration_sec !== FORMAL_GAME_DURATION_SEC ||
    run.points_total !== configuredTotal ||
    run.points_remaining < 0 ||
    run.points_remaining > run.points_total
  ) throw failed('SESSION_DATA_INTEGRITY_ERROR', 'The formal game state is internally inconsistent.')

  const [ratings, choices, unlockRows] = await Promise.all([
    loadRatings(db, session.sessionId),
    loadChoices(db, session.sessionId),
    loadEvidenceUnlockRows(db, session.sessionId),
  ])
  const clock = createGameClockSnapshot(run.started_at, run.deadline_at, serverNow)
  const stageChoices = choices.map(choiceProjection)
  const t1Choice = stageChoices.find(({ stage }) => stage === 'T1') ?? null
  return {
    started: true as const,
    resumeSupported: true as const,
    durationSec: run.duration_sec,
    startedAt: run.started_at,
    deadlineAt: run.deadline_at,
    serverNow: serverNow.toISOString(),
    remainingSec: clock.remainingSec,
    expired: clock.expired,
    currentStage: run.current_stage,
    stageStatus: run.current_stage === 'DECISION'
      ? 'DECISION_COMPLETE' as const
      : deriveFormalStageStatus(run.current_stage, choices.map(({ stage }) => stage)),
    points: { total: run.points_total, remaining: run.points_remaining },
    ratings: ratings.map(ratingProjection),
    stageChoice: t1Choice,
    stageChoices,
    evidenceUnlocks: await Promise.all(
      unlockRows.map((row) => projectEvidenceUnlockForResume(db, row)),
    ),
    lastSequenceNo: run.last_sequence_no,
  }
}

async function intakeComplete(db: D1Database, sessionId: string): Promise<boolean> {
  const row = await db.prepare(`SELECT
    (SELECT COUNT(*) FROM consent_records WHERE session_id = ? AND accepted = 1) AS consent_count,
    (SELECT COUNT(*) FROM demographic_revisions WHERE session_id = ? AND is_current = 1) AS demographic_count,
    (SELECT COUNT(*) FROM questionnaire_submissions WHERE session_id = ? AND phase = 'pre') AS submission_count,
    (SELECT COUNT(*) FROM questionnaire_answers qa
      JOIN questionnaire_submissions qs ON qs.submission_id = qa.submission_id
      WHERE qs.session_id = ? AND qs.phase = 'pre' AND qa.touched = 1) AS answer_count`)
    .bind(sessionId, sessionId, sessionId, sessionId)
    .first<Record<string, number>>()
  return row?.consent_count === 1 && row.demographic_count === 1 &&
    row.submission_count === 1 && row.answer_count === 5
}

export async function startFormalGame(
  db: D1Database,
  session: AuthenticatedSession,
  input: StartGameInput,
) {
  const replay = await findRunByStartEvent(db, input.eventId)
  if (replay) {
    if (replay.session_id !== session.sessionId) {
      throw conflict('IDEMPOTENCY_CONFLICT', 'The idempotency key cannot be reused.')
    }
    return startProjection(session, await projectRun(db, session, replay), false)
  }
  if (await eventOwner(db, input.eventId)) {
    throw conflict('IDEMPOTENCY_CONFLICT', 'The idempotency key cannot be reused.')
  }
  if (session.currentStep !== 'game_ready') {
    throw conflict('GAME_ALREADY_STARTED', 'This formal game cannot be started again.')
  }
  if (!(await intakeComplete(db, session.sessionId))) {
    throw conflict('RESEARCH_INTAKE_INCOMPLETE', 'The formal research intake is incomplete.')
  }

  const totalPoints = await loadPointTotal(db, session.pointRuleVersion)
  const serverNow = new Date()
  const startedAt = serverNow.toISOString()
  const deadlineAt = createFormalDeadline(serverNow).toISOString()
  try {
    await db.batch([
      db.prepare(`INSERT INTO game_runs (
        session_id, start_event_id, current_stage, duration_sec,
        points_total, points_remaining, last_sequence_no,
        started_at, deadline_at, updated_at
      ) VALUES (?, ?, 'T1', 900, ?, ?, 1, ?, ?, ?)`)
        .bind(session.sessionId, input.eventId, totalPoints, totalPoints, startedAt, deadlineAt, startedAt),
      db.prepare(`INSERT INTO game_events (
        event_id, session_id, event_type, candidate_id, stage,
        client_sequence, server_sequence, client_at, server_at, payload_json
      ) VALUES (?, ?, 'game_start', NULL, 'T1', NULL, 1, ?, ?, json(?))`)
        .bind(
          input.eventId,
          session.sessionId,
          input.clientStartedAt,
          startedAt,
          JSON.stringify({ clientVersion: input.clientVersion }),
        ),
      db.prepare(`UPDATE sessions SET current_step = 'playing',
        client_version = ?, started_at = ?, deadline_at = ?
        WHERE session_id = ? AND current_step = 'game_ready'
          AND started_at IS NULL AND deadline_at IS NULL`)
        .bind(input.clientVersion, startedAt, deadlineAt, session.sessionId),
    ])
  } catch {
    const winner = await findRunByStartEvent(db, input.eventId)
    if (winner?.session_id === session.sessionId) {
      const refreshed = { ...session, currentStep: 'playing', startedAt: winner.started_at, deadlineAt: winner.deadline_at }
      return startProjection(refreshed, await projectRun(db, refreshed, winner), false)
    }
    throw failed()
  }
  const refreshed = { ...session, currentStep: 'playing', startedAt, deadlineAt }
  const run = await findRun(db, session.sessionId)
  if (!run) throw failed()
  return startProjection(refreshed, await projectRun(db, refreshed, run, serverNow), true)
}

function startProjection(
  session: AuthenticatedSession,
  game: Awaited<ReturnType<typeof projectRun>>,
  created: boolean,
) {
  return {
    created,
    sessionId: session.sessionId,
    currentStep: 'playing' as const,
    currentStage: game.currentStage,
    stageStatus: game.stageStatus,
    durationSec: game.durationSec,
    startedAt: game.startedAt,
    deadlineAt: game.deadlineAt,
    serverNow: game.serverNow,
    remainingSec: game.remainingSec,
    expired: game.expired,
    points: game.points,
    candidateDisplayOrder: parseOrder(session),
    initialOpenedCandidate: session.initialOpenedCandidate,
    ratings: game.ratings,
    stageChoice: game.stageChoice,
    stageChoices: game.stageChoices,
    evidenceUnlocks: game.evidenceUnlocks,
  }
}

async function recordExpiry(db: D1Database, run: GameRunRow, serverNow: Date): Promise<void> {
  if (run.time_expired_at !== null) return
  const sequence = run.last_sequence_no + 1
  const at = serverNow.toISOString()
  try {
    await db.batch([
      db.prepare(`INSERT INTO game_events (
        event_id, session_id, event_type, candidate_id, stage,
        client_sequence, server_sequence, client_at, server_at, payload_json
      ) VALUES (?, ?, 'timer_expired', NULL, ?, NULL, ?, ?, ?, json('{}'))`)
        .bind(crypto.randomUUID(), run.session_id, run.current_stage, sequence, at, at),
      db.prepare(`UPDATE game_runs SET time_expired_at = ?,
        last_sequence_no = ?, updated_at = ?
        WHERE session_id = ? AND time_expired_at IS NULL AND last_sequence_no = ?`)
        .bind(at, sequence, at, run.session_id, run.last_sequence_no),
    ])
  } catch {
    const winner = await findRun(db, run.session_id)
    if (winner?.time_expired_at !== null) return
    throw failed()
  }
}

async function requireWritableRun(
  db: D1Database,
  session: AuthenticatedSession,
): Promise<GameRunRow> {
  if (session.currentStep !== 'playing') {
    throw conflict('GAME_NOT_PLAYING', 'The formal game is not accepting submissions.')
  }
  const run = await findRun(db, session.sessionId)
  if (!run) throw conflict('GAME_NOT_STARTED', 'The formal game has not started.')
  const now = new Date()
  if (createGameClockSnapshot(run.started_at, run.deadline_at, now).expired) {
    try {
      await finalizeExpiredFormalGame(
        db, session, crypto.randomUUID(), now.toISOString(), null,
      )
    } catch {
      // The session may have no sealed stage choice; expiry is still authoritative.
    }
    throw conflict('GAME_EXPIRED', 'The formal game time has expired.')
  }
  await assertNoPendingSunkCost(db, session.sessionId)
  return run
}

async function requireWritableStage(
  db: D1Database,
  session: AuthenticatedSession,
  stage: FormalRatingStage,
): Promise<GameRunRow> {
  const run = await requireWritableRun(db, session)
  if (stage === 'T1' && run.current_stage !== 'T1') {
    throw conflict('T1_STAGE_SEALED', 'The T1 stage is already sealed.')
  }
  if (stage === 'T2') {
    if (await findChoice(db, session.sessionId, 'T2')) {
      throw conflict('T2_STAGE_ALREADY_SEALED', 'The T2 stage is already sealed.')
    }
    if (run.current_stage !== 'T2') {
      throw conflict('RATING_STAGE_NOT_AVAILABLE', 'T2 ratings are not available in this stage.')
    }
  }
  if (stage === 'T3') {
    if (await findChoice(db, session.sessionId, 'T3')) {
      throw conflict('T3_STAGE_ALREADY_SEALED', 'The T3 stage is already sealed.')
    }
    if (run.current_stage !== 'T3') {
      throw conflict('RATING_STAGE_NOT_AVAILABLE', 'T3 ratings are not available in this stage.')
    }
  }
  return run
}

async function evidenceIdsForRating(
  db: D1Database,
  sessionId: string,
  candidateId: string,
  stage: FormalRatingStage,
): Promise<string[]> {
  if (stage === 'T1') return []
  const levelFilter = stage === 'T2' ? "e.evidence_level = 'shallow'" : "e.evidence_level IN ('shallow', 'deep')"
  const result = await db.prepare(`SELECT i.evidence_id FROM evidence_events e
    JOIN evidence_event_items i ON i.event_id = e.event_id
    WHERE e.session_id = ? AND e.candidate_id = ? AND ${levelFilter}
    ORDER BY e.sequence_no, i.item_order`)
    .bind(sessionId, candidateId).all<{ evidence_id: string }>()
  return result.results.map(({ evidence_id }) => evidence_id)
}

async function requireRatingPrerequisites(
  db: D1Database,
  sessionId: string,
  candidateId: string,
  stage: FormalRatingStage,
) {
  if (stage === 'T1') return
  const shallow = await db.prepare(`SELECT 1 AS present FROM evidence_events
    WHERE session_id = ? AND candidate_id = ? AND evidence_level = 'shallow'`)
    .bind(sessionId, candidateId).first<{ present: number }>()
  if (!shallow) {
    throw conflict('SHALLOW_EVIDENCE_REQUIRED', 'Shallow evidence is required for this rating.')
  }
  if (!(await findRating(db, sessionId, candidateId, 'T1'))) {
    throw conflict('T1_RATING_REQUIRED', 'A sealed T1 rating is required.')
  }
  if (stage === 'T2') return
  const deep = await db.prepare(`SELECT 1 AS present FROM evidence_events
    WHERE session_id = ? AND candidate_id = ? AND evidence_level = 'deep'`)
    .bind(sessionId, candidateId).first<{ present: number }>()
  if (!deep) throw conflict('DEEP_EVIDENCE_REQUIRED', 'Deep evidence is required for a T3 rating.')
  if (!(await findRating(db, sessionId, candidateId, 'T2'))) {
    throw conflict('T2_RATING_REQUIRED', 'A sealed T2 rating is required.')
  }
}

async function ratingCount(db: D1Database, sessionId: string, stage: FormalRatingStage): Promise<number> {
  const row = await db.prepare(`SELECT COUNT(*) AS count FROM stage_ratings
    WHERE session_id = ? AND stage = ?`).bind(sessionId, stage).first<{ count: number }>()
  return row?.count ?? 0
}

async function requiredRatingCount(db: D1Database, sessionId: string, stage: FormalRatingStage) {
  if (stage === 'T1') return 5
  const level = stage === 'T2' ? 'shallow' : 'deep'
  const row = await db.prepare(`SELECT COUNT(*) AS count FROM evidence_events
    WHERE session_id = ? AND evidence_level = ?`)
    .bind(sessionId, level).first<{ count: number }>()
  return row?.count ?? 0
}

async function ratingResponse(db: D1Database, row: RatingRow, created: boolean) {
  const [ratedCandidateCount, requiredCandidateCount] = await Promise.all([
    ratingCount(db, row.session_id, row.stage),
    requiredRatingCount(db, row.session_id, row.stage),
  ])
  return {
    created,
    sessionId: row.session_id,
    ...ratingProjection(row),
    ratedCandidateCount,
    requiredCandidateCount,
    allStageRated: requiredCandidateCount > 0 && ratedCandidateCount === requiredCandidateCount,
    allT1Rated: row.stage === 'T1' && ratedCandidateCount === 5,
  }
}

export async function saveFormalRating(
  db: D1Database,
  session: AuthenticatedSession,
  input: FormalRatingInput,
) {
  const replay = await findRatingByEvent(db, input.eventId)
  if (replay) {
    if (replay.session_id !== session.sessionId) {
      throw conflict('IDEMPOTENCY_CONFLICT', 'The idempotency key cannot be reused.')
    }
    return ratingResponse(db, replay, false)
  }
  if (await eventOwner(db, input.eventId)) {
    throw conflict('IDEMPOTENCY_CONFLICT', 'The idempotency key cannot be reused.')
  }
  if (await findRating(db, session.sessionId, input.candidateId, input.stage)) {
    throw conflict('RATING_ALREADY_SEALED', 'This stage rating is already sealed.')
  }
  if (!parseOrder(session).includes(input.candidateId)) {
    throw conflict('CANDIDATE_NOT_IN_SESSION', 'The candidate is not part of this session.')
  }
  await requireRatingPrerequisites(db, session.sessionId, input.candidateId, input.stage)
  const evidenceIds = await evidenceIdsForRating(db, session.sessionId, input.candidateId, input.stage)
  let run = await requireWritableStage(db, session, input.stage)

  for (let attempt = 0; attempt < 4; attempt += 1) {
    const sequence = run.last_sequence_no + 1
    const serverSubmittedAt = new Date().toISOString()
    try {
      await db.batch([
        db.prepare(`INSERT INTO game_events (
          event_id, session_id, event_type, candidate_id, stage,
          client_sequence, server_sequence, client_at, server_at, payload_json
        ) VALUES (?, ?, 'rating_submit', ?, ?, ?, ?, ?, ?, json(?))`)
          .bind(
            input.eventId,
            session.sessionId,
            input.candidateId,
            input.stage,
            input.clientSequence,
            sequence,
            input.clientSubmittedAt,
            serverSubmittedAt,
            JSON.stringify({ ratingValue: input.ratingValue, evidenceIdsSeen: evidenceIds }),
          ),
        db.prepare(`INSERT INTO stage_ratings (
          rating_id, event_id, session_id, candidate_id, stage, rating_value,
          evidence_ids_seen, client_submitted_at, server_submitted_at, sequence_no
        ) VALUES (?, ?, ?, ?, ?, ?, json(?), ?, ?, ?)`)
          .bind(
            crypto.randomUUID(), input.eventId, session.sessionId,
            input.candidateId, input.stage, input.ratingValue,
            JSON.stringify(evidenceIds), input.clientSubmittedAt,
            serverSubmittedAt, sequence,
          ),
        db.prepare(`UPDATE game_runs SET last_sequence_no = ?, updated_at = ?
          WHERE session_id = ? AND last_sequence_no = ?`)
          .bind(sequence, serverSubmittedAt, session.sessionId, run.last_sequence_no),
      ])
      const row = await findRatingByEvent(db, input.eventId)
      if (!row) throw failed()
      return ratingResponse(db, row, true)
    } catch {
      const replayAfterRace = await findRatingByEvent(db, input.eventId)
      if (replayAfterRace?.session_id === session.sessionId) {
        return ratingResponse(db, replayAfterRace, false)
      }
      if (await findRating(db, session.sessionId, input.candidateId, input.stage)) {
        throw conflict('RATING_ALREADY_SEALED', 'This stage rating is already sealed.')
      }
      run = await requireWritableStage(db, session, input.stage)
    }
  }
  throw failed()
}

async function requireChoicePrerequisites(
  db: D1Database,
  sessionId: string,
  stage: FormalRatingStage,
) {
  if (stage === 'T1') {
    if (await ratingCount(db, sessionId, 'T1') !== 5) {
      throw conflict('T1_RATINGS_INCOMPLETE', 'Five sealed T1 ratings are required.')
    }
    return
  }
  const level = stage === 'T2' ? 'shallow' : 'deep'
  const unlockCount = await requiredRatingCount(db, sessionId, stage)
  if (unlockCount === 0) {
    throw conflict(
      stage === 'T2' ? 'SHALLOW_EVIDENCE_REQUIRED' : 'DEEP_EVIDENCE_REQUIRED',
      `${level} evidence is required before this stage choice.`,
    )
  }
  if (stage === 'T2') {
    const deep = await db.prepare(`SELECT COUNT(*) AS count FROM evidence_events
      WHERE session_id = ? AND evidence_level = 'deep'`)
      .bind(sessionId).first<{ count: number }>()
    if ((deep?.count ?? 0) > 0) {
      throw conflict('T2_STAGE_ALREADY_SEALED', 'T2 must be sealed before deep verification.')
    }
  }
  if (await ratingCount(db, sessionId, stage) !== unlockCount) {
    throw conflict(
      stage === 'T2' ? 'T2_RATINGS_INCOMPLETE' : 'T3_RATINGS_INCOMPLETE',
      `Every ${level}-verified candidate requires a sealed ${stage} rating.`,
    )
  }
}

async function choiceResponse(
  db: D1Database,
  row: ChoiceRow,
  created: boolean,
) {
  const run = await findRun(db, row.session_id)
  if (!run) throw failed()
  const choices = await loadChoices(db, row.session_id)
  return {
    created,
    sessionId: row.session_id,
    ...choiceProjection(row),
    currentStage: run.current_stage,
    stageStatus: deriveFormalStageStatus(run.current_stage, choices.map(({ stage }) => stage)),
  }
}

export async function saveFormalStageChoice(
  db: D1Database,
  session: AuthenticatedSession,
  input: FormalStageChoiceInput,
) {
  const replay = await findChoiceByEvent(db, input.eventId)
  if (replay) {
    if (replay.session_id !== session.sessionId) {
      throw conflict('IDEMPOTENCY_CONFLICT', 'The idempotency key cannot be reused.')
    }
    return choiceResponse(db, replay, false)
  }
  if (await eventOwner(db, input.eventId)) {
    throw conflict('IDEMPOTENCY_CONFLICT', 'The idempotency key cannot be reused.')
  }
  if (await findChoice(db, session.sessionId, input.stage)) {
    throw conflict('STAGE_CHOICE_ALREADY_SEALED', 'This stage choice is already sealed.')
  }
  if (!parseOrder(session).includes(input.candidateId)) {
    throw conflict('CANDIDATE_NOT_IN_SESSION', 'The candidate is not part of this session.')
  }
  await requireChoicePrerequisites(db, session.sessionId, input.stage)
  let run = await requireWritableStage(db, session, input.stage)

  for (let attempt = 0; attempt < 4; attempt += 1) {
    const sequence = run.last_sequence_no + 1
    const serverSubmittedAt = new Date().toISOString()
    const nextStage = input.stage === 'T1' ? 'T1_COMPLETE' : input.stage
    try {
      const update = input.stage === 'T1'
        ? db.prepare(`UPDATE game_runs SET current_stage = 'T1_COMPLETE',
            t1_completed_at = ?, last_sequence_no = ?, updated_at = ?
            WHERE session_id = ? AND current_stage = 'T1' AND last_sequence_no = ?`)
          .bind(serverSubmittedAt, sequence, serverSubmittedAt, session.sessionId, run.last_sequence_no)
        : db.prepare(`UPDATE game_runs SET last_sequence_no = ?, updated_at = ?
            WHERE session_id = ? AND current_stage = ? AND last_sequence_no = ?`)
          .bind(sequence, serverSubmittedAt, session.sessionId, input.stage, run.last_sequence_no)
      await db.batch([
        db.prepare(`INSERT INTO game_events (
          event_id, session_id, event_type, candidate_id, stage,
          client_sequence, server_sequence, client_at, server_at, payload_json
        ) VALUES (?, ?, 'stage_choice_submit', ?, ?, ?, ?, ?, ?, json(?))`)
          .bind(
            input.eventId, session.sessionId, input.candidateId, input.stage,
            input.clientSequence, sequence, input.clientSubmittedAt,
            serverSubmittedAt, JSON.stringify({ confidence: input.confidence }),
          ),
        db.prepare(`INSERT INTO stage_choices (
          choice_id, event_id, session_id, stage, candidate_id, confidence,
          submit_mode, client_submitted_at, server_submitted_at, sequence_no
        ) VALUES (?, ?, ?, ?, ?, ?, 'active', ?, ?, ?)`)
          .bind(
            crypto.randomUUID(), input.eventId, session.sessionId, input.stage,
            input.candidateId, input.confidence, input.clientSubmittedAt,
            serverSubmittedAt, sequence,
          ),
        update,
      ])
      const row = await findChoiceByEvent(db, input.eventId)
      if (!row) throw failed()
      const response = await choiceResponse(db, row, true)
      if (response.currentStage !== nextStage) throw failed()
      return response
    } catch {
      const winner = await findChoiceByEvent(db, input.eventId)
      if (winner?.session_id === session.sessionId) return choiceResponse(db, winner, false)
      if (await findChoice(db, session.sessionId, input.stage)) {
        throw conflict('STAGE_CHOICE_ALREADY_SEALED', 'This stage choice is already sealed.')
      }
      run = await requireWritableStage(db, session, input.stage)
    }
  }
  throw failed()
}

export const saveT1Rating = saveFormalRating
export const saveT1StageChoice = saveFormalStageChoice

export async function loadFormalGameResume(
  db: D1Database,
  session: AuthenticatedSession,
) {
  if (session.currentStep !== 'playing' && session.currentStep !== 'post_task') {
    throw conflict('GAME_RESUME_NOT_READY', 'The formal game is not in a resumable state.')
  }
  const run = await findRun(db, session.sessionId)
  if (!run) {
    throw conflict(
      'SESSION_DATA_INTEGRITY_ERROR',
      'The formal game state is internally inconsistent and cannot be resumed.',
    )
  }
  const candidateDisplayOrder = parseOrder(session)
  return {
    session: {
      participantId: session.participantId,
      sessionId: session.sessionId,
      mode: 'formal' as const,
      configSetId: session.configSetId,
      versions: {
        task: session.taskVersion,
        material: session.materialVersion,
        pointRule: session.pointRuleVersion,
        sunkCostRule: session.sunkCostRuleVersion,
        scoring: session.scoringVersion,
        benchmark: session.benchmarkVersion,
        norm: session.normVersion,
      },
      candidateDisplayOrder,
      initialOpenedCandidate: session.initialOpenedCandidate,
      currentStep: session.currentStep as 'playing' | 'post_task',
      createdAt: session.createdAt,
    },
    consent: null,
    demographics: null,
    preTask: null,
    game: await projectRun(db, session, run),
    sunkCost: await loadSafeSunkCost(db, session.sessionId),
    finalDecision: await loadSafeFinalDecision(db, session.sessionId),
  }
}
