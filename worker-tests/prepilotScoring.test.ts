import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { Miniflare } from 'miniflare'
import { createWorkerRuntime } from './runtime'
import {
  buildPrepilotScoringSnapshot,
  ScoringInputError,
} from '../worker/services/scoringInput'
import {
  ensurePrepilotScoringRun,
  recomputeCompletedSession,
} from '../worker/services/prepilotScoring'

type CandidateId = 'A' | 'B' | 'C' | 'D' | 'E'
type FixtureOptions = {
  withRisk?: boolean
  withSecondRiskCandidate?: boolean
  withT3?: boolean
  sunkStatus?: 'answered' | 'not_triggered' | 'timeout_unanswered'
  sunkChoice?: 'stop_loss' | 'give_up' | 'continue'
  submitMode?: 'active' | 'timeout'
  finalCandidateId?: CandidateId
  finalPointsOverride?: number
  evidenceMaterialVersionOverride?: string
  evidenceItemMaterialVersionOverride?: string
}

let runtime: Miniflare
let db: D1Database

beforeEach(async () => {
  const created = await createWorkerRuntime()
  runtime = created.runtime
  db = created.db
})

afterEach(async () => runtime.dispose())

const iso = (seconds: number) =>
  new Date(Date.parse('2026-08-02T01:00:00.000Z') + seconds * 1000).toISOString()

async function insertEvidence(options: {
  sessionId: string
  candidateId: CandidateId
  level: 'shallow' | 'deep'
  sequenceNo: number
  pointsBefore: number
  pointsCost: number
  containsKeyRisk: boolean
  materialVersion?: string
  itemMaterialVersion?: string
  pointRuleVersion?: string
  serverAt?: string
}) {
  const eventId = crypto.randomUUID()
  const stage = options.level === 'shallow' ? 'T2' : 'T3'
  const evidenceIds = [1, 2].map((item) =>
    `${options.candidateId}-t${options.level === 'shallow' ? '2' : '3'}-${item}`)
  const pointsAfter = options.pointsBefore - options.pointsCost
  const serverAt = options.serverAt ?? iso(options.sequenceNo * 10)
  const statements: D1PreparedStatement[] = [
    db.prepare(`INSERT INTO evidence_events (
      event_id,session_id,candidate_id,evidence_level,rating_stage,material_version,
      point_rule_version,evidence_ids_json,points_before,points_cost,points_after,
      contains_key_risk,client_at,server_at,sequence_no
    ) VALUES (?,?,?,?,?,?,?,json(?),?,?,?,?,?,?,?)`)
      .bind(eventId, options.sessionId, options.candidateId, options.level, stage,
        options.materialVersion ?? 'material-1.0.0',
        options.pointRuleVersion ?? 'points-5-v1', JSON.stringify(evidenceIds),
        options.pointsBefore, options.pointsCost,
        pointsAfter, options.containsKeyRisk ? 1 : 0, serverAt, serverAt,
        options.sequenceNo),
    db.prepare(`INSERT INTO point_ledger (
      ledger_id,session_id,event_id,reason,candidate_id,evidence_level,
      points_before,points_delta,points_after,sequence_no,created_at
    ) VALUES (?,?,?,'evidence_unlock',?,?,?,?,?,?,?)`)
      .bind(crypto.randomUUID(), options.sessionId, eventId, options.candidateId,
        options.level, options.pointsBefore, -options.pointsCost, pointsAfter,
        options.sequenceNo, serverAt),
  ]
  if (options.itemMaterialVersion && options.itemMaterialVersion !== 'material-1.0.0') {
    for (const evidenceId of evidenceIds) {
      statements.push(db.prepare(`INSERT INTO candidate_evidence_items (
        material_version,evidence_id,candidate_id,evidence_level,item_order,
        title,content,polarity,is_key_risk,created_at
      ) SELECT ?,evidence_id,candidate_id,evidence_level,item_order,title,content,
        polarity,is_key_risk,created_at FROM candidate_evidence_items
        WHERE material_version='material-1.0.0' AND evidence_id=?`)
        .bind(options.itemMaterialVersion, evidenceId))
    }
  }
  for (const [index, evidenceId] of evidenceIds.entries()) {
    statements.push(db.prepare(`INSERT INTO evidence_event_items (
      event_id,material_version,evidence_id,item_order
    ) VALUES (?,?,?,?)`).bind(
      eventId,
      options.itemMaterialVersion ?? 'material-1.0.0',
      evidenceId,
      index + 1,
    ))
  }
  await db.batch(statements)
  return { eventId, evidenceIds, pointsAfter, serverAt }
}

async function seedCompletedSession(options: FixtureOptions = {}) {
  const withRisk = options.withRisk ?? true
  const withSecondRiskCandidate = options.withSecondRiskCandidate ?? false
  const withT3 = options.withT3 ?? true
  const sunkStatus = options.sunkStatus ?? 'answered'
  const sunkChoice = options.sunkChoice ?? 'stop_loss'
  const submitMode = options.submitMode ?? 'active'
  const finalCandidateId = options.finalCandidateId ?? 'B'
  const participantId = crypto.randomUUID()
  const sessionId = crypto.randomUUID()
  const postId = crypto.randomUUID()
  const taskId = crypto.randomUUID()
  const finalDecisionId = crypto.randomUUID()
  const finalAt = iso(600)
  const completedAt = iso(660)

  await db.batch([
    db.prepare('INSERT INTO participants (participant_id,created_at) VALUES (?,?)')
      .bind(participantId, iso(0)),
    db.prepare(`INSERT INTO sessions (
      session_id,participant_id,creation_key,mode,config_set_id,task_version,
      material_version,point_rule_version,scoring_version,benchmark_version,
      norm_version,candidate_display_order,initial_opened_candidate,
      completion_status,current_step,final_submit_mode,created_at,started_at,
      deadline_at,ended_at,sunk_cost_rule_version,post_task_completed_at,
      task_experience_completed_at
    ) VALUES (?,?,?,'formal','config-2026-07-v1','task-1.0.0','material-1.0.0',
      'points-5-v1','RDI-2.0-prepilot','benchmark-1.0.0',NULL,
      json('["C","A","E","B","D"]'),'C',?,'completed',?,?,?, ?,?,
      'sunk-1.0.0',?,?)`)
      .bind(sessionId, participantId, crypto.randomUUID(),
        submitMode === 'active' ? 'completed' : 'timeout', submitMode, iso(0),
        iso(0), iso(900), completedAt, iso(620), iso(640)),
  ])

  const t1Values: Record<CandidateId, number> = {
    A: 80, B: 60, C: 78, D: 65, E: 70,
  }
  const ratingStatements: D1PreparedStatement[] = []
  for (const [index, candidateId] of (['A', 'B', 'C', 'D', 'E'] as const).entries()) {
    ratingStatements.push(db.prepare(`INSERT INTO stage_ratings (
      rating_id,event_id,session_id,candidate_id,stage,rating_value,evidence_ids_seen,
      client_submitted_at,server_submitted_at,sequence_no
    ) VALUES (?,?,?,?,'T1',?,json('[]'),?,?,?)`)
      .bind(crypto.randomUUID(), crypto.randomUUID(), sessionId, candidateId,
        t1Values[candidateId], iso(10 + index), iso(10 + index), 2 + index))
  }
  ratingStatements.push(db.prepare(`INSERT INTO stage_choices (
    choice_id,event_id,session_id,stage,candidate_id,confidence,submit_mode,
    client_submitted_at,server_submitted_at,sequence_no
  ) VALUES (?,?,?,'T1','A',75,'active',?,?,7)`)
    .bind(crypto.randomUUID(), crypto.randomUUID(), sessionId, iso(20), iso(20)))
  await db.batch(ratingStatements)

  let pointsRemaining = 5
  let sequenceNo = 7
  const shallowCandidates: CandidateId[] = withRisk ?
    ['A', withSecondRiskCandidate ? 'C' : 'B'] : ['B', 'D']
  const evidenceByCandidate = new Map<CandidateId, string[]>()
  for (const candidateId of shallowCandidates) {
    sequenceNo += 1
    const result = await insertEvidence({
      sessionId,
      candidateId,
      level: 'shallow',
      sequenceNo,
      pointsBefore: pointsRemaining,
      pointsCost: 1,
      containsKeyRisk: withRisk &&
        (candidateId === 'A' || (withSecondRiskCandidate && candidateId === 'C')),
      materialVersion: options.evidenceMaterialVersionOverride,
      itemMaterialVersion: options.evidenceItemMaterialVersionOverride,
    })
    pointsRemaining = result.pointsAfter
    evidenceByCandidate.set(candidateId, result.evidenceIds)
  }

  const t2Values: Record<CandidateId, number> = {
    A: 65, B: 74, C: 68, D: 76, E: 70,
  }
  for (const candidateId of shallowCandidates) {
    sequenceNo += 1
    await db.prepare(`INSERT INTO stage_ratings (
      rating_id,event_id,session_id,candidate_id,stage,rating_value,evidence_ids_seen,
      client_submitted_at,server_submitted_at,sequence_no
    ) VALUES (?,?,?,?,'T2',?,json(?),?,?,?)`)
      .bind(crypto.randomUUID(), crypto.randomUUID(), sessionId, candidateId,
        t2Values[candidateId], JSON.stringify(evidenceByCandidate.get(candidateId)),
        iso(120 + sequenceNo), iso(120 + sequenceNo), sequenceNo).run()
  }
  sequenceNo += 1
  await db.prepare(`INSERT INTO stage_choices (
    choice_id,event_id,session_id,stage,candidate_id,confidence,submit_mode,
    client_submitted_at,server_submitted_at,sequence_no
  ) VALUES (?,?,?,'T2',?,80,'active',?,?,?)`)
    .bind(crypto.randomUUID(), crypto.randomUUID(), sessionId,
      shallowCandidates[1], iso(180), iso(180), sequenceNo).run()

  let t3Candidate: CandidateId | null = null
  if (withT3) {
    t3Candidate = withRisk ? 'A' : 'B'
    sequenceNo += 1
    const result = await insertEvidence({
      sessionId,
      candidateId: t3Candidate,
      level: 'deep',
      sequenceNo,
      pointsBefore: pointsRemaining,
      pointsCost: 3,
      containsKeyRisk: withRisk,
      materialVersion: options.evidenceMaterialVersionOverride,
      itemMaterialVersion: options.evidenceItemMaterialVersionOverride,
      serverAt: iso(200),
    })
    pointsRemaining = result.pointsAfter
    evidenceByCandidate.set(t3Candidate, [
      ...(evidenceByCandidate.get(t3Candidate) ?? []),
      ...result.evidenceIds,
    ])
    sequenceNo += 1
    const t3Value = t3Candidate === 'A' ? 50 : 86
    await db.prepare(`INSERT INTO stage_ratings (
      rating_id,event_id,session_id,candidate_id,stage,rating_value,evidence_ids_seen,
      client_submitted_at,server_submitted_at,sequence_no
    ) VALUES (?,?,?,?,'T3',?,json(?),?,?,?)`)
      .bind(crypto.randomUUID(), crypto.randomUUID(), sessionId, t3Candidate,
        t3Value, JSON.stringify(evidenceByCandidate.get(t3Candidate)),
        iso(240), iso(240), sequenceNo).run()
    sequenceNo += 1
    await db.prepare(`INSERT INTO stage_choices (
      choice_id,event_id,session_id,stage,candidate_id,confidence,submit_mode,
      client_submitted_at,server_submitted_at,sequence_no
    ) VALUES (?,?,?,'T3',?,85,'active',?,?,?)`)
      .bind(crypto.randomUUID(), crypto.randomUUID(), sessionId, t3Candidate,
        iso(250), iso(250), sequenceNo).run()
  }

  let showSequence: number | null = null
  let choiceSequence: number | null = null
  if (sunkStatus === 'answered' || sunkStatus === 'timeout_unanswered') {
    sequenceNo += 1
    showSequence = sequenceNo
    if (sunkStatus === 'answered') {
      sequenceNo += 1
      choiceSequence = sequenceNo
    }
  }
  const sunkEventId = crypto.randomUUID()
  const targetCandidateId = withRisk ? 'A' : null
  const riskIds = withRisk ? ['A-t2-1', 'A-t2-2'] : []
  await db.prepare(`INSERT INTO sunk_cost_events (
    sunk_event_id,session_id,show_event_id,choice_event_id,target_candidate_id,
    trigger_rule_version,trigger_reason,risk_evidence_ids_seen,
    points_invested_before,points_remaining_at_show,shown_at,show_sequence_no,
    choice,choice_client_at,choice_submitted_at,choice_sequence_no,
    points_remaining_at_choice,points_after_choice,choice_status,created_at,updated_at
  ) VALUES (?,?,?,?,?,'sunk-1.0.0',?,json(?),?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .bind(sunkEventId, sessionId,
      showSequence === null ? null : crypto.randomUUID(),
      choiceSequence === null ? null : crypto.randomUUID(),
      targetCandidateId,
      sunkStatus === 'not_triggered' ? 'rule_not_eligible' : 'server_rule_eligible',
      JSON.stringify(riskIds), withRisk ? 4 : 0,
      showSequence === null ? null : pointsRemaining,
      showSequence === null ? null : iso(400), showSequence,
      sunkStatus === 'answered' ? sunkChoice :
        sunkStatus === 'not_triggered' ? 'not_triggered' : null,
      choiceSequence === null ? null : iso(410),
      choiceSequence === null ? null : iso(410), choiceSequence,
      choiceSequence === null ? null : pointsRemaining,
      sunkStatus === 'not_triggered' ? 0 : pointsRemaining,
      sunkStatus, iso(400), iso(410)).run()

  sequenceNo += 1
  const finalSequence = sequenceNo
  await db.prepare(`INSERT INTO final_decisions (
    final_decision_id,event_id,session_id,candidate_id,confidence,submit_mode,
    source_stage,selection_origin,auto_selected,client_submitted_at,
    server_submitted_at,sequence_no,remaining_sec_at_submit,
    points_remaining_at_submit,sunk_cost_choice,created_at
  ) VALUES (?,?,?,?,88,?,?,?,?,?,?,?,?,?,?,?)`)
    .bind(finalDecisionId, crypto.randomUUID(), sessionId, finalCandidateId,
      submitMode, withT3 ? 'T3' : 'T2',
      submitMode === 'active' ? 'active_user' : 'timeout_latest_sealed_choice',
      submitMode === 'active' ? 0 : 1,
      submitMode === 'active' ? finalAt : null, finalAt, finalSequence,
      submitMode === 'active' ? 300 : 0,
      options.finalPointsOverride ?? pointsRemaining,
      sunkStatus === 'answered' ? sunkChoice :
        sunkStatus === 'not_triggered' ? 'not_triggered' : null,
      finalAt).run()

  const postSequence = finalSequence + 1
  const taskSequence = finalSequence + 2
  const completionSequence = finalSequence + 3
  await db.batch([
    db.prepare(`INSERT INTO questionnaire_submissions (
      submission_id,event_id,session_id,phase,instrument_version,client_started_at,
      client_submitted_at,server_submitted_at,item_count,sequence_no
    ) VALUES (?,?,?,'post','state-assessment-post-1.0.0',?,?,?,5,?)`)
      .bind(postId, crypto.randomUUID(), sessionId, iso(610), iso(620), iso(620),
        postSequence),
    db.prepare(`INSERT INTO questionnaire_submissions (
      submission_id,event_id,session_id,phase,instrument_version,client_started_at,
      client_submitted_at,server_submitted_at,item_count,sequence_no
    ) VALUES (?,?,?,'task_experience','task-experience-1.0.0',?,?,?,15,?)`)
      .bind(taskId, crypto.randomUUID(), sessionId, iso(630), iso(640), iso(640),
        taskSequence),
  ])
  await db.batch([
    db.prepare(`INSERT INTO completion_records (
      completion_id,event_id,session_id,final_decision_id,post_submission_id,
      task_experience_submission_id,completion_status,final_submit_mode,
      client_completed_at,server_completed_at,sequence_no,created_at
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`)
      .bind(crypto.randomUUID(), crypto.randomUUID(), sessionId, finalDecisionId,
        postId, taskId, submitMode === 'active' ? 'completed' : 'timeout',
        submitMode, completedAt, completedAt, completionSequence, completedAt),
    db.prepare(`INSERT INTO game_runs (
      session_id,start_event_id,current_stage,duration_sec,points_total,points_remaining,
      last_sequence_no,started_at,deadline_at,time_expired_at,t1_completed_at,
      updated_at,finalized_at
    ) VALUES (?,?,'DECISION',900,5,?,?,?, ?,?,?,?,?)`)
      .bind(sessionId, crypto.randomUUID(), pointsRemaining, completionSequence,
        iso(0), iso(900), submitMode === 'timeout' ? finalAt : null, iso(20),
        completedAt, finalAt),
  ])
  return {
    participantId,
    sessionId,
    pointsRemaining,
    finalSequence,
    primaryRiskSequence: withRisk ? 8 : null,
    t3Candidate,
  }
}

async function getRun(runId: string) {
  return db.prepare(`SELECT scoring_run_id,session_id,scoring_version,
    benchmark_version,run_status,is_pre_pilot,interpretation_status,rdi_status,
    failure_code,is_current,source_fingerprint FROM scoring_runs
    WHERE scoring_run_id=?`).bind(runId).first<Record<string, unknown>>()
}

describe('prepilot scoring input', () => {
  it('builds a privacy-minimized canonical snapshot from sealed server facts', async () => {
    const fixture = await seedCompletedSession()
    const snapshot = await buildPrepilotScoringSnapshot(db, fixture.sessionId)

    expect(snapshot.session).toMatchObject({
      sessionId: fixture.sessionId,
      completionStatus: 'completed',
      totalPoints: 5,
      pointsRemaining: 0,
      candidateDisplayOrder: ['C', 'A', 'E', 'B', 'D'],
    })
    expect(snapshot.finalDecision).toMatchObject({
      candidateId: 'B',
      confidence: 88,
      submitMode: 'active',
      serverSubmittedAt: iso(600),
    })
    expect(snapshot.calculationAnchors.primaryRisk).toMatchObject({
      candidateId: 'A',
      sequenceNo: fixture.primaryRiskSequence,
      evidenceIds: ['A-t2-1', 'A-t2-2'],
    })
    expect(snapshot.calculationAnchors.riskExposures).toHaveLength(2)
    expect(snapshot.calculationAnchors.costAfterPrimaryRisk).toBe(3)
    expect(snapshot.calculationAnchors.totalTimeSec).toBe(600)
    expect(snapshot.calculationAnchors.timeAfterPrimaryRiskSec).toBe(520)
    expect(snapshot.calculationAnchors.shallowCandidateIds).toEqual(['A', 'B'])
    const serialized = JSON.stringify(snapshot)
    expect(serialized).not.toMatch(
      /full_name|student_id|phone|participant_identity|cookie|token|trueAbility|trueFit|isToxic|riskFlags|resumeSummary|evidenceText/i,
    )
  })

  it('keeps every A/C risk exposure but anchors added cost to the earliest risk candidate', async () => {
    const fixture = await seedCompletedSession({ withSecondRiskCandidate: true })
    const snapshot = await buildPrepilotScoringSnapshot(db, fixture.sessionId)

    expect(snapshot.calculationAnchors.riskExposures.map((risk) => ({
      candidateId: risk.candidateId,
      sequenceNo: risk.sequenceNo,
    }))).toEqual([
      { candidateId: 'A', sequenceNo: 8 },
      { candidateId: 'C', sequenceNo: 9 },
      { candidateId: 'A', sequenceNo: 13 },
    ])
    expect(snapshot.calculationAnchors.primaryRisk).toMatchObject({
      candidateId: 'A',
      sequenceNo: 8,
    })
    // C's later key-risk unlock is retained for audit but excluded from this
    // formula version; A's later deep unlock contributes three points.
    expect(snapshot.calculationAnchors.costAfterPrimaryRisk).toBe(3)
  })

  it('rejects a broken point ledger without silently correcting it', async () => {
    const fixture = await seedCompletedSession()
    await db.prepare('UPDATE game_runs SET points_remaining=1 WHERE session_id=?')
      .bind(fixture.sessionId).run()
    await expect(buildPrepilotScoringSnapshot(db, fixture.sessionId))
      .rejects.toMatchObject({ code: 'POINT_LEDGER_INCONSISTENT' } satisfies Partial<ScoringInputError>)
  })

  it('rejects a final decision whose point balance differs from the sealed run', async () => {
    const fixture = await seedCompletedSession({ finalPointsOverride: 1 })

    await expect(buildPrepilotScoringSnapshot(db, fixture.sessionId))
      .rejects.toMatchObject({ code: 'POINT_LEDGER_INCONSISTENT' } satisfies Partial<ScoringInputError>)
  })

  it('rejects a run whose last sequence does not equal the completion sequence', async () => {
    const fixture = await seedCompletedSession()
    await db.prepare(`UPDATE game_runs SET last_sequence_no=last_sequence_no+1
      WHERE session_id=?`).bind(fixture.sessionId).run()

    await expect(buildPrepilotScoringSnapshot(db, fixture.sessionId))
      .rejects.toMatchObject({ code: 'SEQUENCE_INCONSISTENT' } satisfies Partial<ScoringInputError>)
  })

  it('rejects evidence facts bound to a different material version', async () => {
    const fixture = await seedCompletedSession({
      evidenceMaterialVersionOverride: 'material-tampered',
    })

    await expect(buildPrepilotScoringSnapshot(db, fixture.sessionId))
      .rejects.toMatchObject({ code: 'VERSION_NOT_READY' } satisfies Partial<ScoringInputError>)
  })

  it('rejects evidence items whose material version differs from their event and session', async () => {
    const fixture = await seedCompletedSession({
      evidenceItemMaterialVersionOverride: 'material-review-mismatch',
    })

    await expect(buildPrepilotScoringSnapshot(db, fixture.sessionId))
      .rejects.toMatchObject({ code: 'VERSION_NOT_READY' } satisfies Partial<ScoringInputError>)
  })

  it.each([
    ['rating', 'stage_ratings', 'server_submitted_at'],
    ['evidence', 'evidence_events', 'server_at'],
    ['stage choice', 'stage_choices', 'server_submitted_at'],
  ] as const)('rejects a %s timestamp outside the sealed game interval', async (
    _label,
    table,
    column,
  ) => {
    const fixture = await seedCompletedSession()
    await db.prepare(`DROP TRIGGER ${table}_no_update`).run()
    await db.prepare(`UPDATE ${table} SET ${column}=? WHERE session_id=? AND sequence_no=(
      SELECT MIN(sequence_no) FROM ${table} WHERE session_id=?
    )`).bind(iso(700), fixture.sessionId, fixture.sessionId).run()

    await expect(buildPrepilotScoringSnapshot(db, fixture.sessionId))
      .rejects.toMatchObject({ code: 'TIME_INCONSISTENT' } satisfies Partial<ScoringInputError>)
  })

  it('rejects sunk-cost timestamps outside the sealed game interval', async () => {
    const fixture = await seedCompletedSession()
    await db.prepare('DROP TRIGGER sunk_cost_show_fields_immutable').run()
    await db.prepare(`UPDATE sunk_cost_events SET shown_at=? WHERE session_id=?`)
      .bind(iso(700), fixture.sessionId).run()

    await expect(buildPrepilotScoringSnapshot(db, fixture.sessionId))
      .rejects.toMatchObject({ code: 'TIME_INCONSISTENT' } satisfies Partial<ScoringInputError>)
  })

  it('rejects server timestamps that run backwards relative to event sequence', async () => {
    const fixture = await seedCompletedSession()
    await db.prepare('DROP TRIGGER stage_ratings_no_update').run()
    await db.prepare(`UPDATE stage_ratings SET server_submitted_at=?
      WHERE session_id=? AND sequence_no=2`).bind(iso(500), fixture.sessionId).run()

    await expect(buildPrepilotScoringSnapshot(db, fixture.sessionId))
      .rejects.toMatchObject({ code: 'TIME_INCONSISTENT' } satisfies Partial<ScoringInputError>)
  })
})

describe('prepilot scoring persistence', () => {
  it('persists provisional metrics, components, and unavailable RCI/RDI values', async () => {
    const fixture = await seedCompletedSession()
    const result = await ensurePrepilotScoringRun(db, fixture.sessionId)
    expect(result).toMatchObject({ created: true, runStatus: 'partial' })
    expect(await getRun(result.runId)).toMatchObject({
      session_id: fixture.sessionId,
      scoring_version: 'RDI-2.0-prepilot',
      benchmark_version: 'benchmark-1.0.0',
      run_status: 'partial',
      is_pre_pilot: 1,
      interpretation_status: 'research_only',
      rdi_status: 'norms_unavailable',
      failure_code: null,
      is_current: 1,
      source_fingerprint: expect.stringMatching(/^[0-9a-f]{64}$/),
    })
    const metrics = await db.prepare(`SELECT metric_code,numeric_value,
      calculation_status,coverage_count,required_count,missing_reason,input_json
      FROM derived_metric_values WHERE scoring_run_id=? ORDER BY metric_code`)
      .bind(result.runId).all<Record<string, unknown>>()
    const byCode = new Map(metrics.results.map((row) => [row.metric_code, row]))
    expect(byCode.get('RES')).toMatchObject({ numeric_value: 34.4, calculation_status: 'partial' })
    expect(byCode.get('EAC')).toMatchObject({ numeric_value: 30, calculation_status: 'partial', coverage_count: 1, required_count: 4 })
    expect(byCode.get('EACS')).toMatchObject({ calculation_status: 'partial', coverage_count: 1, required_count: 4 })
    expect(byCode.get('DDS')).toMatchObject({ numeric_value: expect.closeTo(26.6666666667, 8), calculation_status: 'calculated' })
    expect(byCode.get('GDS')).toMatchObject({ numeric_value: 34.4, calculation_status: 'partial' })
    expect(byCode.get('SLS')).toMatchObject({ numeric_value: 100, calculation_status: 'calculated' })
    expect(byCode.get('RCI')).toMatchObject({ numeric_value: null, calculation_status: 'pending_parameters', missing_reason: 'reliability_parameters_unavailable' })
    expect(byCode.get('RDIz')).toMatchObject({ numeric_value: null, calculation_status: 'norms_unavailable' })
    expect(byCode.get('RDIT')).toMatchObject({ numeric_value: null, calculation_status: 'norms_unavailable' })
    const components = await db.prepare(`SELECT candidate_id,eac_i,eacs_i,rci_i,
      calculation_status,missing_reason FROM candidate_metric_components
      WHERE scoring_run_id=? ORDER BY candidate_id`).bind(result.runId)
      .all<Record<string, unknown>>()
    expect(components.results).toHaveLength(5)
    expect(components.results[0]).toMatchObject({ candidate_id: 'A', eac_i: 30, rci_i: null, calculation_status: 'calculated' })
    expect(components.results[4]).toMatchObject({ candidate_id: 'E', eac_i: null, rci_i: null, calculation_status: 'excluded', missing_reason: 'excluded_direction_zero' })
  })

  it('does not substitute T2 when T3 is absent', async () => {
    const fixture = await seedCompletedSession({ withT3: false })
    const result = await ensurePrepilotScoringRun(db, fixture.sessionId)
    const metrics = await db.prepare(`SELECT metric_code,numeric_value,
      calculation_status,coverage_count FROM derived_metric_values
      WHERE scoring_run_id=? AND metric_code IN ('EAC','EACS') ORDER BY metric_code`)
      .bind(result.runId).all<Record<string, unknown>>()
    expect(metrics.results).toEqual([
      { metric_code: 'EAC', numeric_value: null, calculation_status: 'unavailable', coverage_count: 0 },
      { metric_code: 'EACS', numeric_value: null, calculation_status: 'unavailable', coverage_count: 0 },
    ])
  })

  it('keeps no-risk DDS and not-triggered SLS null instead of awarding 100', async () => {
    const fixture = await seedCompletedSession({
      withRisk: false,
      sunkStatus: 'not_triggered',
    })
    const result = await ensurePrepilotScoringRun(db, fixture.sessionId)
    const metrics = await db.prepare(`SELECT metric_code,numeric_value,
      calculation_status,missing_reason FROM derived_metric_values
      WHERE scoring_run_id=? AND metric_code IN ('DDS','SLS') ORDER BY metric_code`)
      .bind(result.runId).all<Record<string, unknown>>()
    expect(metrics.results).toEqual([
      { metric_code: 'DDS', numeric_value: null, calculation_status: 'not_applicable', missing_reason: 'no_key_risk_exposure' },
      { metric_code: 'SLS', numeric_value: null, calculation_status: 'not_applicable', missing_reason: 'sunk_cost_not_triggered' },
    ])
  })

  it('scores timeout completion while preserving unanswered sunk cost as unavailable', async () => {
    const fixture = await seedCompletedSession({
      submitMode: 'timeout',
      sunkStatus: 'timeout_unanswered',
      withT3: false,
    })
    const result = await ensurePrepilotScoringRun(db, fixture.sessionId)
    const sls = await db.prepare(`SELECT numeric_value,calculation_status,
      missing_reason,input_json FROM derived_metric_values
      WHERE scoring_run_id=? AND metric_code='SLS'`).bind(result.runId)
      .first<Record<string, unknown>>()
    expect(sls).toMatchObject({
      numeric_value: null,
      calculation_status: 'unavailable',
      missing_reason: 'sunk_cost_timeout_unanswered',
    })
    expect(JSON.parse(String(sls?.input_json))).toMatchObject({
      choiceStatus: 'timeout_unanswered',
      choice: null,
    })
  })

  it('is idempotent for the same versions and canonical source fingerprint', async () => {
    const fixture = await seedCompletedSession()
    const first = await ensurePrepilotScoringRun(db, fixture.sessionId)
    const replay = await ensurePrepilotScoringRun(db, fixture.sessionId)
    expect(replay).toEqual({ ...first, created: false })
    expect((await db.prepare(`SELECT COUNT(*) count FROM scoring_runs
      WHERE session_id=?`).bind(fixture.sessionId).first<{ count: number }>())?.count)
      .toBe(1)
    expect((await db.prepare(`SELECT COUNT(*) count FROM derived_metric_values
      WHERE scoring_run_id=?`).bind(first.runId).first<{ count: number }>())?.count)
      .toBe(9)
  })

  it('creates a new current run for an explicit new scoring version and preserves history', async () => {
    const fixture = await seedCompletedSession()
    const first = await ensurePrepilotScoringRun(db, fixture.sessionId)
    await db.prepare(`INSERT INTO scoring_definitions (
      scoring_version,display_name,formula_family,status,is_pre_pilot,
      total_rdi_enabled,level_enabled,formula_config_json,weights_json,time_unit,
      created_at,published_at
    ) SELECT 'RDI-2.0-prepilot-test-2','test recompute',formula_family,status,
      is_pre_pilot,total_rdi_enabled,level_enabled,formula_config_json,weights_json,
      time_unit,created_at,published_at FROM scoring_definitions
      WHERE scoring_version='RDI-2.0-prepilot'`).run()

    const second = await recomputeCompletedSession(db, fixture.sessionId, {
      scoringVersion: 'RDI-2.0-prepilot-test-2',
      benchmarkVersion: 'benchmark-1.0.0',
    })
    expect(second.created).toBe(true)
    expect(second.runId).not.toBe(first.runId)
    const runs = await db.prepare(`SELECT scoring_run_id,scoring_version,is_current
      FROM scoring_runs WHERE session_id=? ORDER BY started_at,scoring_run_id`)
      .bind(fixture.sessionId).all<Record<string, unknown>>()
    expect(runs.results).toEqual(expect.arrayContaining([
      expect.objectContaining({ scoring_run_id: first.runId, scoring_version: 'RDI-2.0-prepilot', is_current: 0 }),
      expect.objectContaining({ scoring_run_id: second.runId, scoring_version: 'RDI-2.0-prepilot-test-2', is_current: 1 }),
    ]))
    await expect(db.prepare(`UPDATE derived_metric_values SET numeric_value=99
      WHERE scoring_run_id=? AND metric_code='RES'`).bind(first.runId).run())
      .rejects.toThrow()
  })

  it('rejects a published scoring definition whose formula contract is unsupported', async () => {
    const fixture = await seedCompletedSession()
    await db.prepare(`INSERT INTO scoring_definitions (
      scoring_version,display_name,formula_family,status,is_pre_pilot,
      total_rdi_enabled,level_enabled,formula_config_json,weights_json,time_unit,
      created_at,published_at
    ) SELECT 'RDI-2.0-prepilot-unsupported','unsupported test',formula_family,
      status,is_pre_pilot,total_rdi_enabled,level_enabled,
      json_set(formula_config_json,'$.primaryRiskAnchor','client_guess'),
      weights_json,time_unit,created_at,published_at FROM scoring_definitions
      WHERE scoring_version='RDI-2.0-prepilot'`).run()

    const result = await recomputeCompletedSession(db, fixture.sessionId, {
      scoringVersion: 'RDI-2.0-prepilot-unsupported',
      benchmarkVersion: 'benchmark-1.0.0',
    })
    expect(result.runStatus).toBe('failed')
    expect(await getRun(result.runId)).toMatchObject({
      failure_code: 'VERSION_NOT_READY',
      is_current: 0,
    })
    const metricCount = await db.prepare(`SELECT COUNT(*) AS count
      FROM derived_metric_values WHERE scoring_run_id=?`).bind(result.runId)
      .first<{ count: number }>()
    expect(metricCount?.count).toBe(0)
  })

  it('records a safe failed run without replacing a successful current run', async () => {
    const fixture = await seedCompletedSession()
    const success = await ensurePrepilotScoringRun(db, fixture.sessionId)
    await db.prepare('UPDATE game_runs SET points_remaining=1 WHERE session_id=?')
      .bind(fixture.sessionId).run()
    const failed = await ensurePrepilotScoringRun(db, fixture.sessionId)
    expect(failed).toMatchObject({ created: true, runStatus: 'failed' })
    expect(await getRun(failed.runId)).toMatchObject({
      run_status: 'failed',
      failure_code: 'POINT_LEDGER_INCONSISTENT',
      is_current: 0,
    })
    expect(await getRun(success.runId)).toMatchObject({ is_current: 1 })
    expect((await db.prepare('SELECT completion_status,current_step,error_count FROM sessions WHERE session_id=?')
      .bind(fixture.sessionId).first<Record<string, unknown>>())).toMatchObject({
      completion_status: 'completed',
      current_step: 'completed',
      error_count: 1,
    })
    const replay = await ensurePrepilotScoringRun(db, fixture.sessionId)
    expect(replay).toEqual({ ...failed, created: false })
  })

  it('fingerprints distinct broken facts, reuses exact failures, and recovers safely', async () => {
    const fixture = await seedCompletedSession()
    await db.prepare('UPDATE game_runs SET points_remaining=1 WHERE session_id=?')
      .bind(fixture.sessionId).run()
    const firstFailure = await ensurePrepilotScoringRun(db, fixture.sessionId)

    await db.prepare('UPDATE game_runs SET points_remaining=2 WHERE session_id=?')
      .bind(fixture.sessionId).run()
    const secondFailure = await ensurePrepilotScoringRun(db, fixture.sessionId)
    expect(secondFailure.runId).not.toBe(firstFailure.runId)
    expect(secondFailure).toMatchObject({ created: true, runStatus: 'failed' })
    expect(await ensurePrepilotScoringRun(db, fixture.sessionId))
      .toEqual({ ...secondFailure, created: false })

    await db.prepare('UPDATE game_runs SET points_remaining=0 WHERE session_id=?')
      .bind(fixture.sessionId).run()
    const recovered = await ensurePrepilotScoringRun(db, fixture.sessionId)
    expect(recovered).toMatchObject({ created: true, runStatus: 'partial' })

    const rows = await db.prepare(`SELECT run_status,is_current,failure_code
      FROM scoring_runs WHERE session_id=? ORDER BY started_at,scoring_run_id`)
      .bind(fixture.sessionId).all<{
        run_status: string
        is_current: number
        failure_code: string | null
      }>()
    expect(rows.results.filter(({ run_status }) => run_status === 'failed'))
      .toHaveLength(2)
    expect(rows.results.filter(({ is_current }) => is_current === 1)).toEqual([
      expect.objectContaining({ run_status: 'partial', failure_code: null }),
    ])
    const session = await db.prepare(`SELECT error_count FROM sessions
      WHERE session_id=?`).bind(fixture.sessionId).first<{ error_count: number }>()
    expect(session?.error_count).toBe(2)
  })

  it('fingerprints distinct evidence-item, configuration, and point-rule failures', async () => {
    const fixture = await seedCompletedSession()
    const event = await db.prepare(`SELECT event_id FROM evidence_events
      WHERE session_id=? ORDER BY sequence_no LIMIT 1`).bind(fixture.sessionId)
      .first<{ event_id: string }>()
    expect(event).not.toBeNull()

    await db.prepare(`DELETE FROM evidence_event_items
      WHERE event_id=? AND item_order=1`).bind(event!.event_id).run()
    const firstItemFailure = await ensurePrepilotScoringRun(db, fixture.sessionId)
    await db.prepare(`DELETE FROM evidence_event_items
      WHERE event_id=? AND item_order=2`).bind(event!.event_id).run()
    const secondItemFailure = await ensurePrepilotScoringRun(db, fixture.sessionId)
    expect(secondItemFailure.runId).not.toBe(firstItemFailure.runId)

    await db.prepare(`UPDATE configuration_sets SET task_version='task-review-a'
      WHERE config_set_id='config-2026-07-v1'`).run()
    const firstConfigFailure = await ensurePrepilotScoringRun(db, fixture.sessionId)
    await db.prepare(`UPDATE configuration_sets SET task_version='task-review-b'
      WHERE config_set_id='config-2026-07-v1'`).run()
    const secondConfigFailure = await ensurePrepilotScoringRun(db, fixture.sessionId)
    expect(secondConfigFailure.runId).not.toBe(firstConfigFailure.runId)

    await db.prepare(`UPDATE configuration_sets SET task_version='task-1.0.0'
      WHERE config_set_id='config-2026-07-v1'`).run()
    await db.prepare(`UPDATE point_rules SET total_points=6
      WHERE point_rule_version='points-5-v1'`).run()
    const firstRuleFailure = await ensurePrepilotScoringRun(db, fixture.sessionId)
    await db.prepare(`UPDATE point_rules SET total_points=7
      WHERE point_rule_version='points-5-v1'`).run()
    const secondRuleFailure = await ensurePrepilotScoringRun(db, fixture.sessionId)
    expect(secondRuleFailure.runId).not.toBe(firstRuleFailure.runId)

    expect(await ensurePrepilotScoringRun(db, fixture.sessionId))
      .toEqual({ ...secondRuleFailure, created: false })
  })

  it('rejects a non-provisional expert benchmark without complete stored expert rows', async () => {
    const fixture = await seedCompletedSession()
    await db.prepare(`INSERT INTO benchmark_sets (
      benchmark_version,source_type,status,is_provisional,expert_count,created_at
    ) VALUES ('benchmark-malformed-expert','expert_panel','draft',0,2,?)`)
      .bind(iso(0)).run()
    await db.prepare(`INSERT INTO benchmark_candidate_values (
      benchmark_version,candidate_id,benchmark_value,direction,
      include_in_core_eac,created_at
    ) SELECT 'benchmark-malformed-expert',candidate_id,benchmark_value,direction,
      include_in_core_eac,created_at FROM benchmark_candidate_values
      WHERE benchmark_version='benchmark-1.0.0'`).run()
    await db.prepare('DROP TRIGGER benchmark_sets_formal_publish_update_guard').run()
    await db.prepare(`UPDATE benchmark_sets SET status='published'
      WHERE benchmark_version='benchmark-malformed-expert'`).run()

    const result = await recomputeCompletedSession(db, fixture.sessionId, {
      scoringVersion: 'RDI-2.0-prepilot',
      benchmarkVersion: 'benchmark-malformed-expert',
    })
    expect(result.runStatus).toBe('failed')
    expect(await getRun(result.runId)).toMatchObject({
      failure_code: 'BENCHMARK_INCOMPLETE',
      is_current: 0,
    })
  })

  it('rejects a legacy current-app benchmark falsely marked non-provisional', async () => {
    const fixture = await seedCompletedSession()
    await db.prepare('DROP TRIGGER benchmark_sets_current_baseline_update_guard').run()
    await db.prepare('DROP TRIGGER benchmark_sets_published_immutable').run()
    await db.prepare(`UPDATE benchmark_sets SET is_provisional=0
      WHERE benchmark_version='benchmark-1.0.0'`).run()

    const result = await ensurePrepilotScoringRun(db, fixture.sessionId)
    expect(result.runStatus).toBe('failed')
    expect(await getRun(result.runId)).toMatchObject({
      failure_code: 'BENCHMARK_INCOMPLETE',
      is_current: 0,
    })
  })

  it.each([
    ['draft norm', 'norm-prepilot-draft', null],
    ['missing norm', 'norm-review-missing', null],
    ['incomplete published norm', 'norm-review-incomplete', null],
    ['draft reliability', null, 'reliability-review-draft'],
  ] as const)('fails safely for a %s override without binding unsupported parameters', async (
    _label,
    normVersion,
    reliabilityVersion,
  ) => {
    const fixture = await seedCompletedSession()
    if (normVersion === 'norm-review-incomplete') {
      await db.prepare(`INSERT INTO norm_sets (
        norm_version,scoring_version,status,sample_size,created_at,published_at
      ) VALUES (?,'RDI-2.0-prepilot','published',1,?,?)`)
        .bind(normVersion, iso(0), iso(0)).run()
    }
    if (reliabilityVersion !== null) {
      await db.prepare(`INSERT INTO reliability_parameters (
        reliability_version,scoring_version,metric_code,sd_value,reliability_value,
        status,sample_size,created_at
      ) VALUES (?,'RDI-2.0-prepilot','EAC',10,0.8,'draft',1,?)`)
        .bind(reliabilityVersion, iso(0)).run()
    }

    const options = {
      scoringVersion: 'RDI-2.0-prepilot',
      benchmarkVersion: 'benchmark-1.0.0',
      normVersion,
      reliabilityVersion,
    }
    const result = await recomputeCompletedSession(db, fixture.sessionId, options)
    expect(result).toMatchObject({ created: true, runStatus: 'failed' })
    expect(await getRun(result.runId)).toMatchObject({
      failure_code: 'VERSION_NOT_READY',
      is_current: 0,
    })
    const storedVersions = await db.prepare(`SELECT norm_version,reliability_version
      FROM scoring_runs WHERE scoring_run_id=?`).bind(result.runId)
      .first<Record<string, unknown>>()
    expect(storedVersions).toEqual({ norm_version: null, reliability_version: null })
    expect(await recomputeCompletedSession(db, fixture.sessionId, options))
      .toEqual({ ...result, created: false })
  })

  it.each([
    ['missing scoring definition', 'RDI-review-missing', 'benchmark-1.0.0'],
    ['missing benchmark set', 'RDI-2.0-prepilot', 'benchmark-review-missing'],
  ] as const)('records and reuses a safe failure for a %s', async (
    _label,
    scoringVersion,
    benchmarkVersion,
  ) => {
    const fixture = await seedCompletedSession()
    const options = { scoringVersion, benchmarkVersion }
    const result = await recomputeCompletedSession(db, fixture.sessionId, options)
    expect(result).toMatchObject({ created: true, runStatus: 'failed' })
    expect(await getRun(result.runId)).toMatchObject({
      scoring_version: 'RDI-2.0-prepilot',
      benchmark_version: 'benchmark-1.0.0',
      failure_code: 'VERSION_NOT_READY',
      is_current: 0,
    })
    expect(await recomputeCompletedSession(db, fixture.sessionId, options))
      .toEqual({ ...result, created: false })
  })

  it('does not expose scoring through a public route', async () => {
    const fixture = await seedCompletedSession()
    await ensurePrepilotScoringRun(db, fixture.sessionId)
    for (const path of [
      `/api/scoring/${fixture.sessionId}`,
      `/api/sessions/${fixture.sessionId}/scoring`,
      `/api/recompute/${fixture.sessionId}`,
    ]) {
      const response = await runtime.dispatchFetch(`http://localhost${path}`)
      expect(response.status, path).toBe(404)
      expect(await response.text(), path).not.toMatch(/RES|EAC|DDS|GDS|SLS|RDI/)
    }
  })
})
