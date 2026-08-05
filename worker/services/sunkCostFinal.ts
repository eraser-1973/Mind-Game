import type { AuthenticatedSession } from '../auth/sessionAuth'
import { isCandidateDisplayOrder } from '../domain/candidateOrder'
import { deriveFinalDecisionEligibility, type FinalSourceStage } from '../domain/finalDecisionEligibility'
import { FormalGameError } from '../domain/formalGameError'
import { createGameClockSnapshot } from '../domain/gameClock'
import { deriveFormalStageStatus } from '../domain/formalStage'
import {
  buildSunkCostSnapshot,
  calculatePointsAfterChoice,
  calculateSunkCostEligibility,
  chooseSunkCostTarget,
  type SunkCostCandidateFacts,
} from '../domain/sunkCost'
import type {
  ActiveFinalDecisionInput,
  SunkCostChoiceInput,
  SunkCostShowInput,
  TimeoutFinalDecisionInput,
} from '../validation/sunkCostFinalRequest'
import type { FormalCandidateId } from '../validation/formalGameRequest'

type RunRow = {
  session_id: string
  current_stage: string
  duration_sec: number
  points_total: number
  points_remaining: number
  last_sequence_no: number
  started_at: string
  deadline_at: string
  time_expired_at: string | null
  finalized_at: string | null
}

type SunkRow = {
  sunk_event_id: string
  session_id: string
  show_event_id: string | null
  choice_event_id: string | null
  target_candidate_id: FormalCandidateId | null
  trigger_rule_version: string
  points_invested_before: number
  points_remaining_at_show: number | null
  shown_at: string | null
  show_sequence_no: number | null
  choice: 'continue' | 'stop_loss' | 'give_up' | 'not_triggered' | null
  choice_submitted_at: string | null
  choice_sequence_no: number | null
  points_remaining_at_choice: number | null
  points_after_choice: number | null
  choice_status: 'pending' | 'answered' | 'not_triggered' | 'timeout_unanswered'
}

type FinalRow = {
  final_decision_id: string
  event_id: string
  session_id: string
  candidate_id: FormalCandidateId
  confidence: number
  submit_mode: 'active' | 'timeout'
  source_stage: FinalSourceStage
  selection_origin: 'active_user' | 'timeout_latest_sealed_choice'
  auto_selected: number
  client_submitted_at: string | null
  server_submitted_at: string
  sequence_no: number
  remaining_sec_at_submit: number
  points_remaining_at_submit: number
  sunk_cost_choice: string | null
}

type ChoiceRow = {
  stage: FinalSourceStage
  candidate_id: FormalCandidateId
  confidence: number
  sequence_no: number
}

function conflict(code: string, message: string): FormalGameError {
  return new FormalGameError(409, code, message)
}

function failed(): FormalGameError {
  return new FormalGameError(500, 'STAGE6_SAVE_FAILED', 'The decision could not be saved.')
}

async function findRun(db: D1Database, sessionId: string): Promise<RunRow | null> {
  return db.prepare(`SELECT session_id,current_stage,duration_sec,points_total,points_remaining,
    last_sequence_no,started_at,deadline_at,time_expired_at,finalized_at
    FROM game_runs WHERE session_id=?`).bind(sessionId).first<RunRow>()
}

async function findSunk(db: D1Database, sessionId: string): Promise<SunkRow | null> {
  return db.prepare(`SELECT sunk_event_id,session_id,show_event_id,choice_event_id,
    target_candidate_id,trigger_rule_version,points_invested_before,
    points_remaining_at_show,shown_at,show_sequence_no,choice,choice_submitted_at,
    choice_sequence_no,points_remaining_at_choice,points_after_choice,choice_status
    FROM sunk_cost_events WHERE session_id=?`).bind(sessionId).first<SunkRow>()
}

async function findSunkByShowEvent(db: D1Database, eventId: string): Promise<SunkRow | null> {
  return db.prepare(`SELECT sunk_event_id,session_id,show_event_id,choice_event_id,
    target_candidate_id,trigger_rule_version,points_invested_before,
    points_remaining_at_show,shown_at,show_sequence_no,choice,choice_submitted_at,
    choice_sequence_no,points_remaining_at_choice,points_after_choice,choice_status
    FROM sunk_cost_events WHERE show_event_id=?`).bind(eventId).first<SunkRow>()
}

async function findSunkByChoiceEvent(db: D1Database, eventId: string): Promise<SunkRow | null> {
  return db.prepare(`SELECT sunk_event_id,session_id,show_event_id,choice_event_id,
    target_candidate_id,trigger_rule_version,points_invested_before,
    points_remaining_at_show,shown_at,show_sequence_no,choice,choice_submitted_at,
    choice_sequence_no,points_remaining_at_choice,points_after_choice,choice_status
    FROM sunk_cost_events WHERE choice_event_id=?`).bind(eventId).first<SunkRow>()
}

async function findFinal(db: D1Database, sessionId: string): Promise<FinalRow | null> {
  return db.prepare(`SELECT final_decision_id,event_id,session_id,candidate_id,confidence,
    submit_mode,source_stage,selection_origin,auto_selected,client_submitted_at,
    server_submitted_at,sequence_no,remaining_sec_at_submit,points_remaining_at_submit,
    sunk_cost_choice FROM final_decisions WHERE session_id=?`).bind(sessionId).first<FinalRow>()
}

async function findFinalByEvent(db: D1Database, eventId: string): Promise<FinalRow | null> {
  return db.prepare(`SELECT final_decision_id,event_id,session_id,candidate_id,confidence,
    submit_mode,source_stage,selection_origin,auto_selected,client_submitted_at,
    server_submitted_at,sequence_no,remaining_sec_at_submit,points_remaining_at_submit,
    sunk_cost_choice FROM final_decisions WHERE event_id=?`).bind(eventId).first<FinalRow>()
}

function displayOrder(session: AuthenticatedSession): readonly FormalCandidateId[] {
  try {
    const parsed: unknown = JSON.parse(session.candidateDisplayOrder)
    if (isCandidateDisplayOrder(parsed)) return parsed
  } catch {
    // Sanitized below.
  }
  throw failed()
}

async function loadSunkFacts(db: D1Database, session: AuthenticatedSession) {
  const points = await db.prepare(`SELECT candidate_id,SUM(points_cost) points_invested
    FROM evidence_events WHERE session_id=? GROUP BY candidate_id`)
    .bind(session.sessionId).all<{ candidate_id: FormalCandidateId; points_invested: number }>()
  const risks = await db.prepare(`SELECT e.candidate_id,i.evidence_id,e.sequence_no
    FROM evidence_events e JOIN evidence_event_items i ON i.event_id=e.event_id
    JOIN candidate_evidence_items c ON c.material_version=i.material_version
      AND c.evidence_id=i.evidence_id
    WHERE e.session_id=? AND c.is_key_risk=1 ORDER BY e.sequence_no,i.item_order`)
    .bind(session.sessionId).all<{
      candidate_id: FormalCandidateId; evidence_id: string; sequence_no: number
    }>()
  const pointsByCandidate = new Map(points.results.map((row) => [row.candidate_id, row.points_invested]))
  return displayOrder(session).map((candidateId): SunkCostCandidateFacts => {
    const candidateRisks = risks.results.filter((row) => row.candidate_id === candidateId)
    return {
      candidateId,
      pointsInvested: pointsByCandidate.get(candidateId) ?? 0,
      firstKeyRiskSequence: candidateRisks[0]?.sequence_no ?? null,
      riskEvidenceIdsSeen: candidateRisks.map(({ evidence_id }) => evidence_id),
    }
  })
}

async function loadRule(db: D1Database, version: string) {
  const rule = await db.prepare(`SELECT trigger_remaining_sec,minimum_candidate_investment,
    requires_key_risk,status FROM sunk_cost_rules WHERE sunk_cost_rule_version=?`)
    .bind(version).first<{
      trigger_remaining_sec: number
      minimum_candidate_investment: number
      requires_key_risk: number
      status: string
    }>()
  if (!rule || rule.status !== 'published') {
    throw new FormalGameError(503, 'SUNK_COST_RULE_NOT_READY', 'The sunk cost rule is not available.')
  }
  return rule
}

async function updatePointsAfterChoice(db: D1Database, row: SunkRow): Promise<number | null> {
  if (row.choice_sequence_no === null || row.choice_status !== 'answered') return row.points_after_choice
  const ledger = await db.prepare(`SELECT sequence_no,points_delta FROM point_ledger
    WHERE session_id=? ORDER BY sequence_no`).bind(row.session_id)
    .all<{ sequence_no: number; points_delta: number }>()
  const value = calculatePointsAfterChoice(
    ledger.results.map((item) => ({ sequenceNo: item.sequence_no, pointsDelta: item.points_delta })),
    row.choice_sequence_no,
  )
  if (value !== row.points_after_choice) {
    await db.prepare('UPDATE sunk_cost_events SET points_after_choice=?,updated_at=? WHERE sunk_event_id=?')
      .bind(value, new Date().toISOString(), row.sunk_event_id).run()
  }
  return value
}

async function sunkProjection(db: D1Database, row: SunkRow, created: boolean) {
  const pointsAfterChoice = await updatePointsAfterChoice(db, row)
  return {
    created,
    ...buildSunkCostSnapshot({
      sunkEventId: row.sunk_event_id,
      targetCandidateId: row.target_candidate_id,
      pointsInvestedBefore: row.points_invested_before,
      shownAt: row.shown_at,
      showSequenceNo: row.show_sequence_no,
      choice: row.choice,
      choiceSubmittedAt: row.choice_submitted_at,
      pointsAfterChoice,
      choiceStatus: row.choice_status,
    }),
  }
}

export async function loadSafeSunkCost(db: D1Database, sessionId: string) {
  const row = await findSunk(db, sessionId)
  return row ? sunkProjection(db, row, false) : null
}

export async function assertNoPendingSunkCost(db: D1Database, sessionId: string): Promise<void> {
  const sunk = await findSunk(db, sessionId)
  if (sunk?.choice_status === 'pending') {
    throw conflict('SUNK_COST_RESPONSE_REQUIRED', 'The sunk cost response must be submitted first.')
  }
}

export async function showSunkCost(
  db: D1Database,
  session: AuthenticatedSession,
  input: SunkCostShowInput,
) {
  const replay = await findSunkByShowEvent(db, input.eventId)
  if (replay) {
    if (replay.session_id !== session.sessionId) throw conflict('IDEMPOTENCY_CONFLICT', 'The key is already used.')
    return sunkProjection(db, replay, false)
  }
  const existing = await findSunk(db, session.sessionId)
  if (existing) return sunkProjection(db, existing, false)
  if (session.currentStep !== 'playing') throw conflict('GAME_NOT_PLAYING', 'The game is not active.')
  let run = await findRun(db, session.sessionId)
  if (!run) throw conflict('GAME_NOT_STARTED', 'The game has not started.')
  const clock = createGameClockSnapshot(run.started_at, run.deadline_at)
  if (clock.expired) {
    try {
      await finalizeExpiredFormalGame(db, session, crypto.randomUUID(), input.clientShownAt, input.clientSequence)
    } catch {
      // The timer expiry remains authoritative even when no sealed stage choice
      // exists yet, so the original show request must never continue.
    }
    throw conflict('GAME_EXPIRED', 'The formal game time has expired.')
  }
  const rule = await loadRule(db, session.sunkCostRuleVersion)
  const facts = await loadSunkFacts(db, session)
  const eligibility = calculateSunkCostEligibility({
    remainingSec: clock.remainingSec,
    triggerRemainingSec: rule.trigger_remaining_sec,
    minimumCandidateInvestment: rule.minimum_candidate_investment,
    requiresKeyRisk: rule.requires_key_risk === 1,
    candidates: facts,
    alreadyRecorded: false,
    finalSubmitted: Boolean(await findFinal(db, session.sessionId)),
  })
  if (!eligibility.eligible) return { created: false, triggered: false, required: false }
  const eligibleFacts = facts.filter(({ candidateId }) => eligibility.eligibleCandidateIds.includes(candidateId))
  const target = chooseSunkCostTarget(eligibleFacts, displayOrder(session))
  if (!target) throw failed()

  for (let attempt = 0; attempt < 4; attempt += 1) {
    const at = new Date().toISOString()
    const sequence = run.last_sequence_no + 1
    const sunkEventId = crypto.randomUUID()
    try {
      await db.batch([
        db.prepare(`INSERT INTO sunk_cost_events (
          sunk_event_id,session_id,show_event_id,choice_event_id,target_candidate_id,
          trigger_rule_version,trigger_reason,risk_evidence_ids_seen,points_invested_before,
          points_remaining_at_show,shown_at,show_sequence_no,choice,choice_status,created_at,updated_at
        ) VALUES (?,?,?,NULL,?,?,?,json(?),?,?,?, ?,NULL,'pending',?,?)`)
          .bind(sunkEventId, session.sessionId, input.eventId, target.candidateId,
            session.sunkCostRuleVersion, 'key_risk_investment_under_time_pressure',
            JSON.stringify(target.riskEvidenceIdsSeen), target.pointsInvested, run.points_remaining,
            at, sequence, at, at),
        db.prepare(`INSERT INTO game_events (
          event_id,session_id,event_type,candidate_id,stage,client_sequence,server_sequence,
          client_at,server_at,payload_json
        ) VALUES (?,?,'sunk_cost_show',?,?,?, ?,?,?,json(?))`)
          .bind(input.eventId, session.sessionId, target.candidateId, run.current_stage,
            input.clientSequence, sequence, input.clientShownAt, at,
            JSON.stringify({ sunkEventId, targetCandidateId: target.candidateId,
              pointsInvestedBefore: target.pointsInvested })),
        db.prepare(`UPDATE game_runs SET last_sequence_no=?,updated_at=?
          WHERE session_id=? AND last_sequence_no=?`)
          .bind(sequence, at, session.sessionId, run.last_sequence_no),
      ])
      const created = await findSunkByShowEvent(db, input.eventId)
      if (!created) throw failed()
      return sunkProjection(db, created, true)
    } catch {
      const winner = await findSunk(db, session.sessionId)
      if (winner) return sunkProjection(db, winner, false)
      const latest = await findRun(db, session.sessionId)
      if (!latest) throw failed()
      run = latest
    }
  }
  throw failed()
}

export async function saveSunkCostChoice(
  db: D1Database,
  session: AuthenticatedSession,
  input: SunkCostChoiceInput,
) {
  const replay = await findSunkByChoiceEvent(db, input.eventId)
  if (replay) {
    if (replay.session_id !== session.sessionId) throw conflict('IDEMPOTENCY_CONFLICT', 'The key is already used.')
    return sunkProjection(db, replay, false)
  }
  const sunk = await findSunk(db, session.sessionId)
  if (!sunk || sunk.sunk_event_id !== input.sunkEventId) {
    throw conflict('SUNK_COST_NOT_SHOWN', 'No matching sunk cost prompt is available.')
  }
  if (sunk.choice_status !== 'pending') throw conflict('SUNK_COST_CHOICE_SEALED', 'The sunk cost choice is sealed.')
  let run = await findRun(db, session.sessionId)
  if (!run) throw conflict('GAME_NOT_STARTED', 'The game has not started.')
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const at = new Date().toISOString()
    const sequence = run.last_sequence_no + 1
    try {
      await db.batch([
        db.prepare(`UPDATE sunk_cost_events SET choice_event_id=?,choice=?,choice_client_at=?,
          choice_submitted_at=?,choice_sequence_no=?,points_remaining_at_choice=?,
          points_after_choice=0,choice_status='answered',updated_at=?
          WHERE sunk_event_id=? AND choice_status='pending'`)
          .bind(input.eventId, input.choice, input.clientSubmittedAt, at, sequence,
            run.points_remaining, at, sunk.sunk_event_id),
        db.prepare(`INSERT INTO game_events (
          event_id,session_id,event_type,candidate_id,stage,client_sequence,server_sequence,
          client_at,server_at,payload_json
        ) VALUES (?,?,'sunk_cost_choice',?,?,?, ?,?,?,json(?))`)
          .bind(input.eventId, session.sessionId, sunk.target_candidate_id, run.current_stage,
            input.clientSequence, sequence, input.clientSubmittedAt, at,
            JSON.stringify({ sunkEventId: sunk.sunk_event_id, choice: input.choice })),
        db.prepare(`UPDATE game_runs SET current_stage=?,last_sequence_no=?,updated_at=?
          WHERE session_id=? AND last_sequence_no=?`)
          .bind(input.choice === 'give_up' ? 'DECISION' : run.current_stage,
            sequence, at, session.sessionId, run.last_sequence_no),
      ])
      const saved = await findSunkByChoiceEvent(db, input.eventId)
      if (!saved) throw failed()
      return sunkProjection(db, saved, true)
    } catch {
      const winner = await findSunk(db, session.sessionId)
      if (winner?.choice_event_id === input.eventId) return sunkProjection(db, winner, false)
      if (winner?.choice_status !== 'pending') throw conflict('SUNK_COST_CHOICE_SEALED', 'The sunk cost choice is sealed.')
      const latest = await findRun(db, session.sessionId)
      if (!latest) throw failed()
      run = latest
    }
  }
  throw failed()
}

async function choiceRows(db: D1Database, sessionId: string): Promise<ChoiceRow[]> {
  const result = await db.prepare(`SELECT stage,candidate_id,confidence,sequence_no FROM stage_choices
    WHERE session_id=? ORDER BY sequence_no`).bind(sessionId).all<ChoiceRow>()
  return result.results
}

/**
 * T2 no longer collects a candidate choice. A participant may proceed to the
 * final decision only once every actually shallow-verified candidate has a
 * sealed T2 rating and the server confirms that a deep verification cannot be
 * afforded from the session's pinned point rule.
 */
async function canFinalizeAtT2WithoutChoice(
  db: D1Database,
  session: AuthenticatedSession,
  run: Pick<RunRow, 'current_stage' | 'points_remaining'>,
): Promise<boolean> {
  if (run.current_stage !== 'T2') return false
  const [rule, counts] = await Promise.all([
    db.prepare(`SELECT deep_cost,status FROM point_rules WHERE point_rule_version=?`)
      .bind(session.pointRuleVersion).first<{ deep_cost: number; status: string }>(),
    db.prepare(`SELECT
      (SELECT COUNT(DISTINCT candidate_id) FROM evidence_events
        WHERE session_id=? AND evidence_level='shallow') AS shallow_count,
      (SELECT COUNT(DISTINCT r.candidate_id) FROM stage_ratings r
        JOIN evidence_events e ON e.session_id=r.session_id
          AND e.candidate_id=r.candidate_id AND e.evidence_level='shallow'
        WHERE r.session_id=? AND r.stage='T2') AS t2_rated_count,
      (SELECT COUNT(*) FROM evidence_events
        WHERE session_id=? AND evidence_level='deep') AS deep_count`)
      .bind(session.sessionId, session.sessionId, session.sessionId)
      .first<{ shallow_count: number; t2_rated_count: number; deep_count: number }>(),
  ])
  return rule?.status === 'published' &&
    Number.isInteger(rule.deep_cost) &&
    run.points_remaining < rule.deep_cost &&
    (counts?.shallow_count ?? 0) > 0 &&
    counts?.shallow_count === counts?.t2_rated_count &&
    (counts?.deep_count ?? 0) === 0
}

export async function loadFinalDecisionAvailability(
  db: D1Database,
  session: AuthenticatedSession,
  run: Pick<RunRow, 'current_stage' | 'points_remaining' | 'started_at' | 'deadline_at'>,
) {
  const [choices, sunk, final] = await Promise.all([
    choiceRows(db, session.sessionId),
    findSunk(db, session.sessionId),
    findFinal(db, session.sessionId),
  ])
  const sealed = choices.map(({ stage }) => stage)
  const stageStatus = run.current_stage === 'DECISION'
    ? 'DECISION_COMPLETE'
    : deriveFormalStageStatus(run.current_stage, sealed)
  return deriveFinalDecisionEligibility({
    stageStatus,
    sunkChoice: sunk?.choice === 'continue' || sunk?.choice === 'stop_loss' || sunk?.choice === 'give_up'
      ? sunk.choice : null,
    hasT1Choice: sealed.includes('T1'),
    hasT2Choice: sealed.includes('T2'),
    hasT3Choice: sealed.includes('T3'),
    canFinalizeAtT2: await canFinalizeAtT2WithoutChoice(db, session, run),
    sunkResponsePending: sunk?.choice_status === 'pending',
    finalSubmitted: Boolean(final),
    completionStatus: session.completionStatus,
    currentStep: session.currentStep,
    expired: createGameClockSnapshot(run.started_at, run.deadline_at).expired,
  })
}

function latestChoice(rows: ChoiceRow[]): ChoiceRow | null {
  return rows.find(({ stage }) => stage === 'T3') ??
    rows.find(({ stage }) => stage === 'T2') ??
    rows.find(({ stage }) => stage === 'T1') ?? null
}

function finalProjection(row: FinalRow, created: boolean) {
  return {
    created,
    finalDecisionId: row.final_decision_id,
    candidateId: row.candidate_id,
    confidence: row.confidence,
    submitMode: row.submit_mode,
    sourceStage: row.source_stage,
    selectionOrigin: row.selection_origin,
    autoSelected: row.auto_selected === 1,
    serverSubmittedAt: row.server_submitted_at,
    sequenceNo: row.sequence_no,
    remainingSec: row.remaining_sec_at_submit,
    pointsRemaining: row.points_remaining_at_submit,
    currentStep: 'post_task' as const,
  }
}

async function insertNotTriggered(
  db: D1Database,
  session: AuthenticatedSession,
  run: RunRow,
  at: string,
) {
  await db.prepare(`INSERT INTO sunk_cost_events (
    sunk_event_id,session_id,show_event_id,choice_event_id,target_candidate_id,
    trigger_rule_version,trigger_reason,risk_evidence_ids_seen,points_invested_before,
    points_remaining_at_show,shown_at,show_sequence_no,choice,choice_status,created_at,updated_at
  ) VALUES (?,?,NULL,NULL,NULL,?,'active_final_not_eligible',json('[]'),0,NULL,NULL,NULL,
    'not_triggered','not_triggered',?,?)`)
    .bind(crypto.randomUUID(), session.sessionId, session.sunkCostRuleVersion, at, at).run()
  return run
}

async function persistFinal(
  db: D1Database,
  session: AuthenticatedSession,
  input: {
    eventId: string
    candidateId: FormalCandidateId
    confidence: number
    submitMode: 'active' | 'timeout'
    sourceStage: FinalSourceStage
    clientAt: string
    clientSubmittedAt: string | null
    clientSequence: number | null
    autoSelected: boolean
  },
  run: RunRow,
  timerNeeded: boolean,
) {
  const at = new Date().toISOString()
  const clock = createGameClockSnapshot(run.started_at, run.deadline_at, new Date(at))
  const timerSequence = timerNeeded ? run.last_sequence_no + 1 : null
  const sequence = run.last_sequence_no + (timerNeeded ? 2 : 1)
  const finalDecisionId = crypto.randomUUID()
  const sunk = await findSunk(db, session.sessionId)
  if (sunk?.choice_status === 'answered') await updatePointsAfterChoice(db, sunk)
  const statements: D1PreparedStatement[] = []
  if (timerNeeded) {
    statements.push(db.prepare(`INSERT INTO game_events (
      event_id,session_id,event_type,candidate_id,stage,client_sequence,server_sequence,
      client_at,server_at,payload_json
    ) VALUES (?,?,'timer_expired',NULL,?,NULL,?,?,?,json('{}'))`)
      .bind(crypto.randomUUID(), session.sessionId, run.current_stage, timerSequence, at, at))
  }
  if (sunk?.choice_status === 'pending') {
    statements.push(db.prepare(`UPDATE sunk_cost_events SET choice_status='timeout_unanswered',
      updated_at=? WHERE session_id=? AND choice_status='pending'`).bind(at, session.sessionId))
  }
  statements.push(
    db.prepare(`INSERT INTO final_decisions (
      final_decision_id,event_id,session_id,candidate_id,confidence,submit_mode,source_stage,
      selection_origin,auto_selected,client_submitted_at,server_submitted_at,sequence_no,
      remaining_sec_at_submit,points_remaining_at_submit,sunk_cost_choice,created_at
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .bind(finalDecisionId, input.eventId, session.sessionId, input.candidateId, input.confidence,
        input.submitMode, input.sourceStage,
        input.autoSelected ? 'timeout_latest_sealed_choice' : 'active_user',
        input.autoSelected ? 1 : 0, input.clientSubmittedAt, at, sequence,
        clock.remainingSec, run.points_remaining, sunk?.choice ?? null, at),
    db.prepare(`INSERT INTO game_events (
      event_id,session_id,event_type,candidate_id,stage,client_sequence,server_sequence,
      client_at,server_at,payload_json
    ) VALUES (?,?,'final_submit',?,'final',?,?,?,?,json(?))`)
      .bind(input.eventId, session.sessionId, input.candidateId, input.clientSequence,
        sequence, input.clientAt, at, JSON.stringify({ confidence: input.confidence,
          submitMode: input.submitMode, sourceStage: input.sourceStage,
          autoSelected: input.autoSelected })),
    db.prepare(`UPDATE game_runs SET current_stage='DECISION',time_expired_at=COALESCE(time_expired_at,?),
      finalized_at=?,last_sequence_no=?,updated_at=? WHERE session_id=? AND last_sequence_no=?`)
      .bind(input.submitMode === 'timeout' ? at : null, at, sequence, at,
        session.sessionId, run.last_sequence_no),
    db.prepare(`UPDATE sessions SET current_step='post_task',completion_status=?,
      final_submit_mode=? WHERE session_id=? AND current_step='playing'`)
      .bind(input.submitMode === 'timeout' ? 'timeout' : 'in_progress', input.submitMode,
        session.sessionId),
  )
  await db.batch(statements)
  const row = await findFinalByEvent(db, input.eventId)
  if (!row) throw failed()
  return finalProjection(row, true)
}

export async function saveActiveFinalDecision(
  db: D1Database,
  session: AuthenticatedSession,
  input: ActiveFinalDecisionInput,
) {
  const replay = await findFinalByEvent(db, input.eventId)
  if (replay) {
    if (replay.session_id !== session.sessionId) throw conflict('IDEMPOTENCY_CONFLICT', 'The key is already used.')
    return finalProjection(replay, false)
  }
  if (await findFinal(db, session.sessionId)) throw conflict('FINAL_ALREADY_SUBMITTED', 'The final decision is sealed.')
  let run = await findRun(db, session.sessionId)
  if (!run) throw conflict('GAME_NOT_STARTED', 'The game has not started.')
  const clock = createGameClockSnapshot(run.started_at, run.deadline_at)
  if (clock.expired) {
    await finalizeExpiredFormalGame(db, session, crypto.randomUUID(), input.clientSubmittedAt, input.clientSequence)
    throw conflict('GAME_EXPIRED', 'The formal game time has expired.')
  }
  if (!displayOrder(session).includes(input.candidateId)) throw conflict('CANDIDATE_NOT_IN_SESSION', 'Invalid candidate.')
  const sunk = await findSunk(db, session.sessionId)
  const result = await loadFinalDecisionAvailability(db, session, run)
  if (!result.allowed || !result.sourceStage) throw conflict(result.reason ?? 'FINAL_NOT_AVAILABLE', 'The final decision is not available.')

  if (!sunk) {
    const rule = await loadRule(db, session.sunkCostRuleVersion)
    const facts = await loadSunkFacts(db, session)
    const eligible = calculateSunkCostEligibility({
      remainingSec: clock.remainingSec, triggerRemainingSec: rule.trigger_remaining_sec,
      minimumCandidateInvestment: rule.minimum_candidate_investment,
      requiresKeyRisk: rule.requires_key_risk === 1, candidates: facts,
      alreadyRecorded: false, finalSubmitted: false,
    }).eligible
    if (eligible) throw conflict('SUNK_COST_SHOW_REQUIRED', 'The sunk cost prompt must be shown first.')
    await insertNotTriggered(db, session, run, new Date().toISOString())
    run = (await findRun(db, session.sessionId)) ?? run
  }
  try {
    return await persistFinal(db, session, {
      ...input, submitMode: 'active', sourceStage: result.sourceStage,
      clientAt: input.clientSubmittedAt, clientSubmittedAt: input.clientSubmittedAt,
      autoSelected: false,
    }, run, false)
  } catch {
    const winner = await findFinalByEvent(db, input.eventId)
    if (winner) return finalProjection(winner, false)
    if (await findFinal(db, session.sessionId)) throw conflict('FINAL_ALREADY_SUBMITTED', 'The final decision is sealed.')
    throw failed()
  }
}

export async function finalizeExpiredFormalGame(
  db: D1Database,
  session: AuthenticatedSession,
  eventId: string,
  clientObservedAt: string,
  clientSequence: number | null,
) {
  const replay = await findFinalByEvent(db, eventId)
  if (replay) return finalProjection(replay, false)
  const existing = await findFinal(db, session.sessionId)
  if (existing) return finalProjection(existing, false)
  let run = await findRun(db, session.sessionId)
  if (!run) throw conflict('GAME_NOT_STARTED', 'The game has not started.')
  if (!createGameClockSnapshot(run.started_at, run.deadline_at).expired) {
    throw conflict('GAME_NOT_EXPIRED', 'The formal game deadline has not been reached.')
  }
  if (run.time_expired_at === null) {
    const at = new Date().toISOString()
    const sequence = run.last_sequence_no + 1
    try {
      await db.batch([
        db.prepare(`INSERT INTO game_events (
          event_id,session_id,event_type,candidate_id,stage,client_sequence,server_sequence,
          client_at,server_at,payload_json
        ) VALUES (?,?,'timer_expired',NULL,?,NULL,?,?,?,json('{}'))`)
          .bind(crypto.randomUUID(), session.sessionId, run.current_stage, sequence, at, at),
        db.prepare(`UPDATE game_runs SET time_expired_at=?,last_sequence_no=?,updated_at=?
          WHERE session_id=? AND time_expired_at IS NULL AND last_sequence_no=?`)
          .bind(at, sequence, at, session.sessionId, run.last_sequence_no),
      ])
    } catch {
      // A concurrent timeout request may have recorded the same server fact.
    }
    const refreshed = await findRun(db, session.sessionId)
    if (!refreshed?.time_expired_at) throw failed()
    run = refreshed
  }
  const choice = latestChoice(await choiceRows(db, session.sessionId))
  if (!choice) throw conflict('T1_CHOICE_REQUIRED', 'A sealed stage choice is required.')
  if (!(await findSunk(db, session.sessionId))) {
    await insertNotTriggered(db, session, run, new Date().toISOString())
  }
  try {
    return await persistFinal(db, session, {
      eventId, candidateId: choice.candidate_id, confidence: choice.confidence,
      submitMode: 'timeout', sourceStage: choice.stage, clientAt: clientObservedAt,
      clientSubmittedAt: null, clientSequence, autoSelected: true,
    }, run, false)
  } catch {
    const winner = await findFinal(db, session.sessionId)
    if (winner) return finalProjection(winner, false)
    throw failed()
  }
}

export async function saveTimeoutFinalDecision(
  db: D1Database,
  session: AuthenticatedSession,
  input: TimeoutFinalDecisionInput,
) {
  return finalizeExpiredFormalGame(
    db, session, input.eventId, input.clientObservedAt, input.clientSequence,
  )
}

export async function loadSafeFinalDecision(db: D1Database, sessionId: string) {
  const row = await findFinal(db, sessionId)
  return row ? finalProjection(row, false) : null
}
