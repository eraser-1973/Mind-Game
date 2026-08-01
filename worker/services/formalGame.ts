import type { AuthenticatedSession } from '../auth/sessionAuth'
import { isCandidateDisplayOrder } from '../domain/candidateOrder'
import {
  createFormalDeadline,
  createGameClockSnapshot,
  FORMAL_GAME_DURATION_SEC,
} from '../domain/gameClock'
import type {
  StartGameInput,
  T1RatingInput,
  T1StageChoiceInput,
} from '../validation/formalGameRequest'

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
  stage: string
  rating_value: number
  client_submitted_at: string
  server_submitted_at: string
  sequence_no: number
}

type ChoiceRow = {
  choice_id: string
  event_id: string
  session_id: string
  stage: string
  candidate_id: string
  confidence: number
  client_submitted_at: string
  server_submitted_at: string
  sequence_no: number
}

export class FormalGameError extends Error {
  constructor(
    readonly status: 409 | 500,
    readonly code: string,
    message: string,
  ) {
    super(message)
    this.name = 'FormalGameError'
  }
}

function conflict(code: string, message: string): FormalGameError {
  return new FormalGameError(409, code, message)
}

function failed(): FormalGameError {
  return new FormalGameError(
    500,
    'FORMAL_GAME_SAVE_FAILED',
    'The formal game request could not be saved.',
  )
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

async function findRatingByEvent(db: D1Database, eventId: string): Promise<RatingRow | null> {
  return db.prepare(`SELECT rating_id, event_id, session_id, candidate_id,
    stage, rating_value, client_submitted_at, server_submitted_at, sequence_no
    FROM stage_ratings WHERE event_id = ?`)
    .bind(eventId)
    .first<RatingRow>()
}

async function findRating(
  db: D1Database,
  sessionId: string,
  candidateId: string,
): Promise<RatingRow | null> {
  return db.prepare(`SELECT rating_id, event_id, session_id, candidate_id,
    stage, rating_value, client_submitted_at, server_submitted_at, sequence_no
    FROM stage_ratings
    WHERE session_id = ? AND candidate_id = ? AND stage = 'T1'`)
    .bind(sessionId, candidateId)
    .first<RatingRow>()
}

async function findChoiceByEvent(db: D1Database, eventId: string): Promise<ChoiceRow | null> {
  return db.prepare(`SELECT choice_id, event_id, session_id, stage,
    candidate_id, confidence, client_submitted_at, server_submitted_at,
    sequence_no FROM stage_choices WHERE event_id = ?`)
    .bind(eventId)
    .first<ChoiceRow>()
}

async function findChoice(db: D1Database, sessionId: string): Promise<ChoiceRow | null> {
  return db.prepare(`SELECT choice_id, event_id, session_id, stage,
    candidate_id, confidence, client_submitted_at, server_submitted_at,
    sequence_no FROM stage_choices WHERE session_id = ? AND stage = 'T1'`)
    .bind(sessionId)
    .first<ChoiceRow>()
}

async function eventOwner(db: D1Database, eventId: string): Promise<string | null> {
  const row = await db.prepare('SELECT session_id FROM game_events WHERE event_id = ?')
    .bind(eventId)
    .first<{ session_id: string }>()
  return row?.session_id ?? null
}

function parseOrder(session: AuthenticatedSession) {
  let value: unknown
  try {
    value = JSON.parse(session.candidateDisplayOrder)
  } catch {
    throw failed()
  }
  if (!isCandidateDisplayOrder(value)) throw failed()
  return value
}

function ratingProjection(row: RatingRow) {
  return {
    candidateId: row.candidate_id,
    stage: 'T1' as const,
    ratingValue: row.rating_value,
    sealed: true as const,
    sequenceNo: row.sequence_no,
    serverSubmittedAt: row.server_submitted_at,
  }
}

function choiceProjection(row: ChoiceRow | null) {
  return row ? {
    stage: 'T1' as const,
    candidateId: row.candidate_id,
    confidence: row.confidence,
    sealed: true as const,
    sequenceNo: row.sequence_no,
    serverSubmittedAt: row.server_submitted_at,
  } : null
}

async function loadRatings(db: D1Database, sessionId: string): Promise<RatingRow[]> {
  const result = await db.prepare(`SELECT rating_id, event_id, session_id,
    candidate_id, stage, rating_value, client_submitted_at,
    server_submitted_at, sequence_no FROM stage_ratings
    WHERE session_id = ? AND stage = 'T1' ORDER BY sequence_no`)
    .bind(sessionId)
    .all<RatingRow>()
  return result.results
}

async function projectRun(
  db: D1Database,
  session: AuthenticatedSession,
  run: GameRunRow,
  serverNow = new Date(),
) {
  if (
    session.startedAt !== run.started_at ||
    session.deadlineAt !== run.deadline_at ||
    run.duration_sec !== FORMAL_GAME_DURATION_SEC ||
    run.points_total !== 5 ||
    run.points_remaining !== 5
  ) throw failed()

  const [ratings, choice] = await Promise.all([
    loadRatings(db, session.sessionId),
    findChoice(db, session.sessionId),
  ])
  const clock = createGameClockSnapshot(run.started_at, run.deadline_at, serverNow)
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
    points: { total: run.points_total, remaining: run.points_remaining },
    ratings: ratings.map(ratingProjection),
    stageChoice: choiceProjection(choice),
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
    const game = await projectRun(db, session, replay)
    return startProjection(session, game, false)
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

  const serverNow = new Date()
  const startedAt = serverNow.toISOString()
  const deadlineAt = createFormalDeadline(serverNow).toISOString()
  try {
    await db.batch([
      db.prepare(`INSERT INTO game_runs (
        session_id, start_event_id, current_stage, duration_sec,
        points_total, points_remaining, last_sequence_no,
        started_at, deadline_at, updated_at
      ) VALUES (?, ?, 'T1', 900, 5, 5, 1, ?, ?, ?)`)
        .bind(session.sessionId, input.eventId, startedAt, deadlineAt, startedAt),
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

async function requireWritableT1(
  db: D1Database,
  session: AuthenticatedSession,
): Promise<GameRunRow> {
  if (session.currentStep !== 'playing') {
    throw conflict('GAME_NOT_PLAYING', 'The formal game is not accepting T1 submissions.')
  }
  const run = await findRun(db, session.sessionId)
  if (!run) throw conflict('GAME_NOT_STARTED', 'The formal game has not started.')
  if (run.current_stage !== 'T1') {
    throw conflict('T1_STAGE_SEALED', 'The T1 stage is already sealed.')
  }
  const now = new Date()
  if (createGameClockSnapshot(run.started_at, run.deadline_at, now).expired) {
    await recordExpiry(db, run, now)
    throw conflict('GAME_TIME_EXPIRED', 'The formal game time has expired.')
  }
  return run
}

function ratingResponse(row: RatingRow, created: boolean, ratedCandidateCount: number) {
  return {
    created,
    sessionId: row.session_id,
    candidateId: row.candidate_id,
    stage: 'T1' as const,
    ratingValue: row.rating_value,
    sealed: true as const,
    sequenceNo: row.sequence_no,
    serverSubmittedAt: row.server_submitted_at,
    ratedCandidateCount,
    requiredCandidateCount: 5,
    allT1Rated: ratedCandidateCount === 5,
  }
}

async function ratingCount(db: D1Database, sessionId: string): Promise<number> {
  const row = await db.prepare(`SELECT COUNT(*) AS count FROM stage_ratings
    WHERE session_id = ? AND stage = 'T1'`).bind(sessionId).first<{ count: number }>()
  return row?.count ?? 0
}

export async function saveT1Rating(
  db: D1Database,
  session: AuthenticatedSession,
  input: T1RatingInput,
) {
  if (input.requestedStage !== 'T1') {
    throw conflict('RATING_STAGE_NOT_AVAILABLE', 'Only T1 ratings are available in this stage.')
  }
  const replay = await findRatingByEvent(db, input.eventId)
  if (replay) {
    if (replay.session_id !== session.sessionId) {
      throw conflict('IDEMPOTENCY_CONFLICT', 'The idempotency key cannot be reused.')
    }
    return ratingResponse(replay, false, await ratingCount(db, session.sessionId))
  }
  if (await eventOwner(db, input.eventId)) {
    throw conflict('IDEMPOTENCY_CONFLICT', 'The idempotency key cannot be reused.')
  }
  const existing = await findRating(db, session.sessionId, input.candidateId)
  if (existing) {
    throw conflict('RATING_ALREADY_SEALED', 'This T1 rating is already sealed.')
  }
  const order = parseOrder(session)
  if (!order.includes(input.candidateId)) {
    throw conflict('CANDIDATE_NOT_IN_SESSION', 'The candidate is not part of this session.')
  }
  let run = await requireWritableT1(db, session)

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const sequence = run.last_sequence_no + 1
    const serverSubmittedAt = new Date().toISOString()
    const ratingId = crypto.randomUUID()
    try {
      await db.batch([
        db.prepare(`INSERT INTO game_events (
          event_id, session_id, event_type, candidate_id, stage,
          client_sequence, server_sequence, client_at, server_at, payload_json
        ) VALUES (?, ?, 'rating_submit', ?, 'T1', ?, ?, ?, ?, json(?))`)
          .bind(
            input.eventId,
            session.sessionId,
            input.candidateId,
            input.clientSequence,
            sequence,
            input.clientSubmittedAt,
            serverSubmittedAt,
            JSON.stringify({ ratingValue: input.ratingValue }),
          ),
        db.prepare(`INSERT INTO stage_ratings (
          rating_id, event_id, session_id, candidate_id, stage, rating_value,
          evidence_ids_seen, client_submitted_at, server_submitted_at, sequence_no
        ) VALUES (?, ?, ?, ?, 'T1', ?, json('[]'), ?, ?, ?)`)
          .bind(
            ratingId,
            input.eventId,
            session.sessionId,
            input.candidateId,
            input.ratingValue,
            input.clientSubmittedAt,
            serverSubmittedAt,
            sequence,
          ),
        db.prepare(`UPDATE game_runs SET last_sequence_no = ?, updated_at = ?
          WHERE session_id = ? AND last_sequence_no = ?`)
          .bind(sequence, serverSubmittedAt, session.sessionId, run.last_sequence_no),
      ])
      const row = await findRatingByEvent(db, input.eventId)
      if (!row) throw failed()
      return ratingResponse(row, true, await ratingCount(db, session.sessionId))
    } catch {
      const replayAfterRace = await findRatingByEvent(db, input.eventId)
      if (replayAfterRace?.session_id === session.sessionId) {
        return ratingResponse(replayAfterRace, false, await ratingCount(db, session.sessionId))
      }
      if (await findRating(db, session.sessionId, input.candidateId)) {
        throw conflict('RATING_ALREADY_SEALED', 'This T1 rating is already sealed.')
      }
      const latest = await findRun(db, session.sessionId)
      if (!latest || latest.current_stage !== 'T1') throw failed()
      run = latest
    }
  }
  throw failed()
}

function choiceResponse(row: ChoiceRow, created: boolean) {
  return {
    created,
    sessionId: row.session_id,
    stage: 'T1' as const,
    candidateId: row.candidate_id,
    confidence: row.confidence,
    sealed: true as const,
    currentStage: 'T1_COMPLETE' as const,
    sequenceNo: row.sequence_no,
    serverSubmittedAt: row.server_submitted_at,
  }
}

export async function saveT1StageChoice(
  db: D1Database,
  session: AuthenticatedSession,
  input: T1StageChoiceInput,
) {
  if (input.requestedStage !== 'T1') {
    throw conflict('CHOICE_STAGE_NOT_AVAILABLE', 'Only the T1 stage choice is available.')
  }
  const replay = await findChoiceByEvent(db, input.eventId)
  if (replay) {
    if (replay.session_id !== session.sessionId) {
      throw conflict('IDEMPOTENCY_CONFLICT', 'The idempotency key cannot be reused.')
    }
    return choiceResponse(replay, false)
  }
  if (await eventOwner(db, input.eventId)) {
    throw conflict('IDEMPOTENCY_CONFLICT', 'The idempotency key cannot be reused.')
  }
  if (await findChoice(db, session.sessionId)) {
    throw conflict('STAGE_CHOICE_ALREADY_SEALED', 'The T1 stage choice is already sealed.')
  }
  if ((await ratingCount(db, session.sessionId)) !== 5) {
    throw conflict('T1_RATINGS_INCOMPLETE', 'Five sealed T1 ratings are required.')
  }
  const order = parseOrder(session)
  if (!order.includes(input.candidateId)) {
    throw conflict('CANDIDATE_NOT_IN_SESSION', 'The candidate is not part of this session.')
  }
  const run = await requireWritableT1(db, session)
  const sequence = run.last_sequence_no + 1
  const serverSubmittedAt = new Date().toISOString()
  const choiceId = crypto.randomUUID()
  try {
    await db.batch([
      db.prepare(`INSERT INTO game_events (
        event_id, session_id, event_type, candidate_id, stage,
        client_sequence, server_sequence, client_at, server_at, payload_json
      ) VALUES (?, ?, 'stage_choice_submit', ?, 'T1', ?, ?, ?, ?, json(?))`)
        .bind(
          input.eventId,
          session.sessionId,
          input.candidateId,
          input.clientSequence,
          sequence,
          input.clientSubmittedAt,
          serverSubmittedAt,
          JSON.stringify({ confidence: input.confidence }),
        ),
      db.prepare(`INSERT INTO stage_choices (
        choice_id, event_id, session_id, stage, candidate_id, confidence,
        submit_mode, client_submitted_at, server_submitted_at, sequence_no
      ) VALUES (?, ?, ?, 'T1', ?, ?, 'active', ?, ?, ?)`)
        .bind(
          choiceId,
          input.eventId,
          session.sessionId,
          input.candidateId,
          input.confidence,
          input.clientSubmittedAt,
          serverSubmittedAt,
          sequence,
        ),
      db.prepare(`UPDATE game_runs SET current_stage = 'T1_COMPLETE',
        t1_completed_at = ?, last_sequence_no = ?, updated_at = ?
        WHERE session_id = ? AND current_stage = 'T1' AND last_sequence_no = ?`)
        .bind(
          serverSubmittedAt,
          sequence,
          serverSubmittedAt,
          session.sessionId,
          run.last_sequence_no,
        ),
    ])
  } catch {
    const winner = await findChoiceByEvent(db, input.eventId)
    if (winner?.session_id === session.sessionId) return choiceResponse(winner, false)
    if (await findChoice(db, session.sessionId)) {
      throw conflict('STAGE_CHOICE_ALREADY_SEALED', 'The T1 stage choice is already sealed.')
    }
    throw failed()
  }
  const row = await findChoiceByEvent(db, input.eventId)
  if (!row) throw failed()
  return choiceResponse(row, true)
}

export async function loadFormalGameResume(
  db: D1Database,
  session: AuthenticatedSession,
) {
  if (session.currentStep !== 'playing') {
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
        scoring: session.scoringVersion,
        benchmark: session.benchmarkVersion,
        norm: session.normVersion,
      },
      candidateDisplayOrder,
      initialOpenedCandidate: session.initialOpenedCandidate,
      currentStep: 'playing' as const,
      createdAt: session.createdAt,
    },
    consent: null,
    demographics: null,
    preTask: null,
    game: await projectRun(db, session, run),
  }
}
