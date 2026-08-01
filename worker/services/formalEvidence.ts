import type { AuthenticatedSession } from '../auth/sessionAuth'
import { isCandidateDisplayOrder } from '../domain/candidateOrder'
import { createGameClockSnapshot } from '../domain/gameClock'
import { deriveFormalStageStatus } from '../domain/formalStage'
import { FormalGameError } from '../domain/formalGameError'
import type { EvidenceUnlockInput } from '../validation/formalGameRequest'

type EvidenceLevel = 'shallow' | 'deep'

type GameRunRow = {
  session_id: string
  current_stage: string
  points_total: number
  points_remaining: number
  last_sequence_no: number
  started_at: string
  deadline_at: string
  time_expired_at: string | null
}

type PointRuleRow = {
  point_rule_version: string
  total_points: number
  shallow_cost: number
  deep_cost: number
  status: string
}

type EvidenceCatalogRow = {
  material_version: string
  evidence_id: string
  candidate_id: string
  evidence_level: EvidenceLevel
  item_order: number
  title: string
  content: string
  polarity: 'positive' | 'negative'
  is_key_risk: number
}

export type EvidenceEventRow = {
  event_id: string
  session_id: string
  candidate_id: string
  evidence_level: EvidenceLevel
  rating_stage: 'T2' | 'T3'
  material_version: string
  point_rule_version: string
  evidence_ids_json: string
  points_before: number
  points_cost: number
  points_after: number
  contains_key_risk: number
  client_at: string
  server_at: string
  sequence_no: number
}

function conflict(code: string, message: string): FormalGameError {
  return new FormalGameError(409, code, message)
}

function unavailable(code: string, message: string): FormalGameError {
  return new FormalGameError(503, code, message)
}

function internal(code = 'FORMAL_GAME_SAVE_FAILED', message = 'The formal game request could not be saved.') {
  return new FormalGameError(500, code, message)
}

async function findRun(db: D1Database, sessionId: string): Promise<GameRunRow | null> {
  return db.prepare(`SELECT session_id, current_stage, points_total,
    points_remaining, last_sequence_no, started_at, deadline_at, time_expired_at
    FROM game_runs WHERE session_id = ?`).bind(sessionId).first<GameRunRow>()
}

async function findUnlockByEvent(db: D1Database, eventId: string) {
  return db.prepare(`SELECT event_id, session_id, candidate_id, evidence_level,
    rating_stage, material_version, point_rule_version, evidence_ids_json,
    points_before, points_cost, points_after, contains_key_risk,
    client_at, server_at, sequence_no FROM evidence_events WHERE event_id = ?`)
    .bind(eventId).first<EvidenceEventRow>()
}

async function findUnlock(
  db: D1Database,
  sessionId: string,
  candidateId: string,
  level: EvidenceLevel,
) {
  return db.prepare(`SELECT event_id, session_id, candidate_id, evidence_level,
    rating_stage, material_version, point_rule_version, evidence_ids_json,
    points_before, points_cost, points_after, contains_key_risk,
    client_at, server_at, sequence_no FROM evidence_events
    WHERE session_id = ? AND candidate_id = ? AND evidence_level = ?`)
    .bind(sessionId, candidateId, level).first<EvidenceEventRow>()
}

async function eventOwner(db: D1Database, eventId: string): Promise<string | null> {
  const row = await db.prepare('SELECT session_id FROM game_events WHERE event_id = ?')
    .bind(eventId).first<{ session_id: string }>()
  return row?.session_id ?? null
}

async function loadPointRule(db: D1Database, version: string): Promise<PointRuleRow> {
  const row = await db.prepare(`SELECT point_rule_version, total_points,
    shallow_cost, deep_cost, status FROM point_rules WHERE point_rule_version = ?`)
    .bind(version).first<PointRuleRow>()
  if (!row || row.status !== 'published') {
    throw unavailable('POINT_RULE_NOT_READY', 'The point rule is not available.')
  }
  return row
}

async function loadCatalog(
  db: D1Database,
  materialVersion: string,
  candidateId: string,
  level: EvidenceLevel,
): Promise<EvidenceCatalogRow[]> {
  const result = await db.prepare(`SELECT material_version, evidence_id,
    candidate_id, evidence_level, item_order, title, content, polarity,
    is_key_risk FROM candidate_evidence_items
    WHERE material_version = ? AND candidate_id = ? AND evidence_level = ?
    ORDER BY item_order`)
    .bind(materialVersion, candidateId, level).all<EvidenceCatalogRow>()
  if (result.results.length === 0) {
    throw unavailable('MATERIAL_NOT_READY', 'The evidence material is not available.')
  }
  return result.results
}

function parseCandidateOrder(session: AuthenticatedSession): readonly string[] {
  try {
    const order: unknown = JSON.parse(session.candidateDisplayOrder)
    if (isCandidateDisplayOrder(order)) return order
  } catch {
    // Fall through to the sanitized integrity error.
  }
  throw internal()
}

async function loadSealedStages(db: D1Database, sessionId: string): Promise<string[]> {
  const result = await db.prepare(
    'SELECT stage FROM stage_choices WHERE session_id = ? ORDER BY sequence_no',
  ).bind(sessionId).all<{ stage: string }>()
  return result.results.map(({ stage }) => stage)
}

async function assertLedgerConsistent(
  db: D1Database,
  sessionId: string,
  run: GameRunRow,
): Promise<void> {
  const result = await db.prepare(`SELECT points_before, points_delta,
    points_after FROM point_ledger WHERE session_id = ? ORDER BY sequence_no`)
    .bind(sessionId).all<{
      points_before: number
      points_delta: number
      points_after: number
    }>()
  let expected = run.points_total
  let consistent = run.points_total >= 0
  for (const row of result.results) {
    if (
      row.points_before !== expected ||
      row.points_after !== row.points_before + row.points_delta ||
      row.points_delta >= 0
    ) {
      consistent = false
      break
    }
    expected = row.points_after
  }
  if (expected !== run.points_remaining) consistent = false
  if (consistent) return

  await db.prepare('UPDATE sessions SET error_count = error_count + 1 WHERE session_id = ?')
    .bind(sessionId).run()
  console.error('POINT_LEDGER_INCONSISTENT')
  throw internal(
    'POINT_LEDGER_INCONSISTENT',
    'The point ledger is inconsistent and the request was rejected.',
  )
}

async function requireBaseState(
  db: D1Database,
  session: AuthenticatedSession,
  input: EvidenceUnlockInput,
) {
  if (session.currentStep !== 'playing') {
    throw conflict('GAME_NOT_PLAYING', 'The formal game is not accepting evidence requests.')
  }
  if (!parseCandidateOrder(session).includes(input.candidateId)) {
    throw conflict('CANDIDATE_NOT_IN_SESSION', 'The candidate is not part of this session.')
  }
  const run = await findRun(db, session.sessionId)
  if (!run) throw conflict('GAME_NOT_STARTED', 'The formal game has not started.')
  if (createGameClockSnapshot(run.started_at, run.deadline_at, new Date()).expired) {
    throw conflict('GAME_TIME_EXPIRED', 'The formal game time has expired.')
  }
  const t1 = await db.prepare(`SELECT
    (SELECT COUNT(*) FROM stage_ratings WHERE session_id = ? AND stage = 'T1') AS rating_count,
    (SELECT COUNT(*) FROM stage_choices WHERE session_id = ? AND stage = 'T1') AS choice_count`)
    .bind(session.sessionId, session.sessionId).first<{ rating_count: number; choice_count: number }>()
  if (t1?.rating_count !== 5 || t1.choice_count !== 1) {
    throw conflict('T1_STAGE_INCOMPLETE', 'Five T1 ratings and the T1 stage choice are required.')
  }
  return run
}

async function requireLevelState(
  db: D1Database,
  sessionId: string,
  run: GameRunRow,
  input: EvidenceUnlockInput,
) {
  const sealedStages = await loadSealedStages(db, sessionId)
  if (input.level === 'shallow') {
    if (sealedStages.includes('T2')) {
      throw conflict('T2_STAGE_ALREADY_SEALED', 'The T2 stage is already sealed.')
    }
    if (run.current_stage !== 'T1_COMPLETE' && run.current_stage !== 'T2') {
      throw conflict('SHALLOW_EVIDENCE_NOT_AVAILABLE', 'Shallow evidence is not available in this stage.')
    }
    return { nextStage: 'T2' as const, sealedStages }
  }

  if (!sealedStages.includes('T2')) {
    throw conflict('T2_STAGE_CHOICE_REQUIRED', 'The T2 stage choice is required before deep verification.')
  }
  if (sealedStages.includes('T3')) {
    throw conflict('T3_STAGE_ALREADY_SEALED', 'The T3 stage is already sealed.')
  }
  if (run.current_stage !== 'T2' && run.current_stage !== 'T3') {
    throw conflict('DEEP_EVIDENCE_NOT_AVAILABLE', 'Deep evidence is not available in this stage.')
  }
  if (!(await findUnlock(db, sessionId, input.candidateId, 'shallow'))) {
    throw conflict('SHALLOW_EVIDENCE_REQUIRED', 'Shallow evidence is required before deep verification.')
  }
  const t2 = await db.prepare(`SELECT 1 AS present FROM stage_ratings
    WHERE session_id = ? AND candidate_id = ? AND stage = 'T2'`)
    .bind(sessionId, input.candidateId).first<{ present: number }>()
  if (!t2) throw conflict('T2_RATING_REQUIRED', 'A sealed T2 rating is required before deep verification.')
  return { nextStage: 'T3' as const, sealedStages }
}

async function loadPublicEvidenceForEvent(db: D1Database, eventId: string) {
  const result = await db.prepare(`SELECT c.evidence_id, c.title, c.content,
    c.polarity, i.item_order FROM evidence_event_items i
    JOIN candidate_evidence_items c
      ON c.material_version = i.material_version AND c.evidence_id = i.evidence_id
    WHERE i.event_id = ? ORDER BY i.item_order`)
    .bind(eventId).all<{
      evidence_id: string
      title: string
      content: string
      polarity: 'positive' | 'negative'
      item_order: number
    }>()
  return result.results.map((row) => ({
    id: row.evidence_id,
    title: row.title,
    content: row.content,
    polarity: row.polarity,
    order: row.item_order,
  }))
}

async function unlockProjection(
  db: D1Database,
  row: EvidenceEventRow,
  created: boolean,
  alreadyUnlocked: boolean,
) {
  const run = await findRun(db, row.session_id)
  if (!run) throw internal()
  const sealedStages = await loadSealedStages(db, row.session_id)
  return {
    created,
    alreadyUnlocked,
    sessionId: row.session_id,
    candidateId: row.candidate_id,
    level: row.evidence_level,
    ratingStage: row.rating_stage,
    sequenceNo: row.sequence_no,
    serverAt: row.server_at,
    points: {
      before: row.points_before,
      cost: row.points_cost,
      after: row.points_after,
      total: run.points_total,
    },
    currentStage: run.current_stage,
    stageStatus: deriveFormalStageStatus(run.current_stage, sealedStages),
    evidence: await loadPublicEvidenceForEvent(db, row.event_id),
  }
}

export async function unlockFormalEvidence(
  db: D1Database,
  session: AuthenticatedSession,
  input: EvidenceUnlockInput,
) {
  const replay = await findUnlockByEvent(db, input.eventId)
  if (replay) {
    if (replay.session_id !== session.sessionId) {
      throw conflict('IDEMPOTENCY_CONFLICT', 'The idempotency key cannot be reused.')
    }
    return unlockProjection(db, replay, false, false)
  }
  if (await eventOwner(db, input.eventId)) {
    throw conflict('IDEMPOTENCY_CONFLICT', 'The idempotency key cannot be reused.')
  }
  const duplicate = await findUnlock(db, session.sessionId, input.candidateId, input.level)
  if (duplicate) return unlockProjection(db, duplicate, false, true)

  let run = await requireBaseState(db, session, input)
  const rule = await loadPointRule(db, session.pointRuleVersion)
  if (run.points_total !== rule.total_points) throw internal('POINT_LEDGER_INCONSISTENT', 'The point ledger is inconsistent and the request was rejected.')
  const evidence = await loadCatalog(db, session.materialVersion, input.candidateId, input.level)
  const cost = input.level === 'shallow' ? rule.shallow_cost : rule.deep_cost

  for (let attempt = 0; attempt < 4; attempt += 1) {
    await assertLedgerConsistent(db, session.sessionId, run)
    const { nextStage } = await requireLevelState(db, session.sessionId, run, input)
    if (run.points_remaining < cost) {
      throw conflict('INSUFFICIENT_POINTS', 'There are not enough verification points.')
    }
    const sequence = run.last_sequence_no + 1
    const pointsAfter = run.points_remaining - cost
    const serverAt = new Date().toISOString()
    const ratingStage = input.level === 'shallow' ? 'T2' : 'T3'
    const evidenceIds = evidence.map(({ evidence_id }) => evidence_id)
    const containsKeyRisk = evidence.some(({ is_key_risk }) => is_key_risk === 1) ? 1 : 0

    try {
      await db.batch([
        db.prepare(`INSERT INTO evidence_events (
          event_id, session_id, candidate_id, evidence_level, rating_stage,
          material_version, point_rule_version, evidence_ids_json,
          points_before, points_cost, points_after, contains_key_risk,
          client_at, server_at, sequence_no
        ) SELECT ?, session_id, ?, ?, ?, ?, ?, json(?), points_remaining, ?,
          points_remaining - ?, ?, ?, ?, ? FROM game_runs
          WHERE session_id = ? AND last_sequence_no = ? AND points_remaining = ?
            AND points_remaining >= ?`)
          .bind(
            input.eventId,
            input.candidateId,
            input.level,
            ratingStage,
            session.materialVersion,
            session.pointRuleVersion,
            JSON.stringify(evidenceIds),
            cost,
            cost,
            containsKeyRisk,
            input.clientAt,
            serverAt,
            sequence,
            session.sessionId,
            run.last_sequence_no,
            run.points_remaining,
            cost,
          ),
        db.prepare(`INSERT INTO evidence_event_items (
          event_id, material_version, evidence_id, item_order
        ) SELECT ?, material_version, evidence_id, item_order
          FROM candidate_evidence_items
          WHERE material_version = ? AND candidate_id = ? AND evidence_level = ?
          ORDER BY item_order`)
          .bind(input.eventId, session.materialVersion, input.candidateId, input.level),
        db.prepare(`INSERT INTO point_ledger (
          ledger_id, session_id, event_id, reason, candidate_id,
          evidence_level, points_before, points_delta, points_after,
          sequence_no, created_at
        ) VALUES (?, ?, ?, 'evidence_unlock', ?, ?, ?, ?, ?, ?, ?)`)
          .bind(
            crypto.randomUUID(),
            session.sessionId,
            input.eventId,
            input.candidateId,
            input.level,
            run.points_remaining,
            -cost,
            pointsAfter,
            sequence,
            serverAt,
          ),
        db.prepare(`INSERT INTO game_events (
          event_id, session_id, event_type, candidate_id, stage,
          client_sequence, server_sequence, client_at, server_at, payload_json
        ) VALUES (?, ?, 'evidence_unlock', ?, ?, ?, ?, ?, ?, json(?))`)
          .bind(
            input.eventId,
            session.sessionId,
            input.candidateId,
            ratingStage,
            input.clientSequence,
            sequence,
            input.clientAt,
            serverAt,
            JSON.stringify({
              level: input.level,
              ratingStage,
              pointsBefore: run.points_remaining,
              pointsCost: cost,
              pointsAfter,
              evidenceIds,
            }),
          ),
        db.prepare(`UPDATE game_runs SET current_stage = ?, points_remaining = ?,
          last_sequence_no = ?, updated_at = ? WHERE session_id = ?
          AND last_sequence_no = ? AND points_remaining = ? AND points_remaining >= ?`)
          .bind(
            nextStage,
            pointsAfter,
            sequence,
            serverAt,
            session.sessionId,
            run.last_sequence_no,
            run.points_remaining,
            cost,
          ),
      ])
      const row = await findUnlockByEvent(db, input.eventId)
      if (!row) throw internal()
      return unlockProjection(db, row, true, false)
    } catch {
      const winner = await findUnlockByEvent(db, input.eventId)
      if (winner?.session_id === session.sessionId) {
        return unlockProjection(db, winner, false, false)
      }
      const existing = await findUnlock(db, session.sessionId, input.candidateId, input.level)
      if (existing) return unlockProjection(db, existing, false, true)
      const latest = await findRun(db, session.sessionId)
      if (!latest) throw internal()
      run = latest
    }
  }
  if (run.points_remaining < cost) {
    throw conflict('INSUFFICIENT_POINTS', 'There are not enough verification points.')
  }
  throw internal()
}

export async function loadEvidenceUnlockRows(
  db: D1Database,
  sessionId: string,
): Promise<EvidenceEventRow[]> {
  const result = await db.prepare(`SELECT event_id, session_id, candidate_id,
    evidence_level, rating_stage, material_version, point_rule_version,
    evidence_ids_json, points_before, points_cost, points_after,
    contains_key_risk, client_at, server_at, sequence_no FROM evidence_events
    WHERE session_id = ? ORDER BY sequence_no`).bind(sessionId).all<EvidenceEventRow>()
  return result.results
}

export async function projectEvidenceUnlockForResume(
  db: D1Database,
  row: EvidenceEventRow,
) {
  return {
    candidateId: row.candidate_id,
    level: row.evidence_level,
    ratingStage: row.rating_stage,
    sequenceNo: row.sequence_no,
    serverAt: row.server_at,
    points: {
      before: row.points_before,
      cost: row.points_cost,
      after: row.points_after,
    },
    evidence: await loadPublicEvidenceForEvent(db, row.event_id),
  }
}
