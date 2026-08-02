export type CandidateId = 'A' | 'B' | 'C' | 'D' | 'E'
export type RatingStage = 'T1' | 'T2' | 'T3'

export type ScoringFailureCode =
  | 'SESSION_NOT_ELIGIBLE'
  | 'VERSION_NOT_READY'
  | 'INPUT_INCOMPLETE'
  | 'BENCHMARK_INCOMPLETE'
  | 'POINT_LEDGER_INCONSISTENT'
  | 'SEQUENCE_INCONSISTENT'
  | 'EVIDENCE_INCONSISTENT'
  | 'TIME_INCONSISTENT'
  | 'DATABASE_READ_FAILED'

export class ScoringInputError extends Error {
  constructor(
    readonly code: ScoringFailureCode,
    readonly safeDetail: string,
  ) {
    super(safeDetail)
    this.name = 'ScoringInputError'
  }
}

type ScoringInputOptions = {
  scoringVersion?: string
  benchmarkVersion?: string
  normVersion?: string | null
  reliabilityVersion?: string | null
}

type SessionRow = {
  session_id: string
  completion_status: string
  current_step: string
  final_submit_mode: string
  config_set_id: string
  task_version: string
  material_version: string
  point_rule_version: string
  scoring_version: string
  benchmark_version: string
  norm_version: string | null
  sunk_cost_rule_version: string
  candidate_display_order: string
  started_at: string | null
  deadline_at: string | null
  ended_at: string | null
  config_task_version: string
  config_material_version: string
  config_point_rule_version: string
  config_scoring_version: string
  config_benchmark_version: string
  config_norm_version: string | null
  config_sunk_cost_rule_version: string
  completion_id: string | null
  completion_record_status: string | null
  completion_record_mode: string | null
  completion_sequence_no: number | null
  server_completed_at: string | null
  run_started_at: string | null
  run_deadline_at: string | null
  finalized_at: string | null
  points_total: number | null
  points_remaining: number | null
  last_sequence_no: number | null
  rule_total_points: number | null
}

type FinalRow = {
  candidate_id: CandidateId
  confidence: number
  submit_mode: 'active' | 'timeout'
  source_stage: RatingStage
  selection_origin: string
  auto_selected: number
  server_submitted_at: string
  sequence_no: number
  points_remaining_at_submit: number
}

type RatingRow = {
  candidate_id: CandidateId
  stage: RatingStage
  rating_value: number
  evidence_ids_seen: string
  server_submitted_at: string
  sequence_no: number
}

type EvidenceRow = {
  event_id: string
  candidate_id: CandidateId
  evidence_level: 'shallow' | 'deep'
  material_version: string
  point_rule_version: string
  evidence_ids_json: string
  points_before: number
  points_cost: number
  points_after: number
  contains_key_risk: number
  server_at: string
  sequence_no: number
}

type EvidenceItemRow = {
  event_id: string
  material_version: string
  evidence_id: string
  item_order: number
}

type LedgerRow = {
  event_id: string
  candidate_id: CandidateId
  evidence_level: 'shallow' | 'deep'
  points_before: number
  points_delta: number
  points_after: number
  sequence_no: number
}

type ChoiceRow = {
  stage: 'T1' | 'T2' | 'T3' | 'final'
  candidate_id: CandidateId
  confidence: number
  server_submitted_at: string
  sequence_no: number
}

type SunkRow = {
  target_candidate_id: CandidateId | null
  risk_evidence_ids_seen: string
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

type BenchmarkSetRow = {
  source_type: string
  status: string
  is_provisional: number
  expert_count: number
  validated_at: string | null
}

type BenchmarkExpertStatsRow = {
  score_count: number
  actual_expert_count: number
  candidate_count: number
}

type ScoringDefinitionRow = {
  scoring_version: string
  formula_family: string
  formula_config_json: string
  weights_json: string
  time_unit: string
}

type BenchmarkValueRow = {
  candidate_id: CandidateId
  benchmark_value: number
  direction: -1 | 0 | 1
  include_in_core_eac: number
}

export type PrepilotScoringSnapshot = {
  inputSchemaVersion: 'prepilot-input-1'
  session: {
    sessionId: string
    completionStatus: 'completed' | 'timeout'
    finalSubmitMode: 'active' | 'timeout'
    taskVersion: string
    materialVersion: string
    pointRuleVersion: string
    sessionScoringVersion: string
    sessionBenchmarkVersion: string
    sessionNormVersion: string | null
    sunkCostRuleVersion: string
    scoringVersion: string
    benchmarkVersion: string
    normVersion: string | null
    reliabilityVersion: string | null
    startedAt: string
    deadlineAt: string
    finalizedAt: string
    endedAt: string
    totalPoints: number
    pointsRemaining: number
    candidateDisplayOrder: CandidateId[]
  }
  finalDecision: {
    candidateId: CandidateId
    confidence: number
    sourceStage: RatingStage
    submitMode: 'active' | 'timeout'
    selectionOrigin: string
    autoSelected: boolean
    serverSubmittedAt: string
    sequenceNo: number
    pointsRemainingAtSubmit: number
  }
  ratings: Array<{
    candidateId: CandidateId
    stage: RatingStage
    value: number
    evidenceIdsSeen: string[]
    serverSubmittedAt: string
    sequenceNo: number
  }>
  evidenceEvents: Array<{
    eventId: string
    candidateId: CandidateId
    level: 'shallow' | 'deep'
    materialVersion: string
    pointRuleVersion: string
    evidenceIds: string[]
    containsKeyRisk: boolean
    pointsBefore: number
    cost: number
    pointsAfter: number
    serverAt: string
    sequenceNo: number
  }>
  pointLedger: Array<{
    eventId: string
    candidateId: CandidateId
    level: 'shallow' | 'deep'
    before: number
    delta: number
    after: number
    sequenceNo: number
  }>
  stageChoices: Array<{
    stage: 'T1' | 'T2' | 'T3' | 'final'
    candidateId: CandidateId
    confidence: number
    serverSubmittedAt: string
    sequenceNo: number
  }>
  sunkCost: {
    triggered: boolean
    targetCandidateId: CandidateId | null
    choice: 'continue' | 'stop_loss' | 'give_up' | 'not_triggered' | null
    choiceStatus: 'pending' | 'answered' | 'not_triggered' | 'timeout_unanswered'
    shownAt: string | null
    choiceSubmittedAt: string | null
    pointsInvestedBefore: number
    pointsRemainingAtShow: number | null
    pointsRemainingAtChoice: number | null
    pointsAfterChoice: number | null
    riskEvidenceIdsSeen: string[]
  }
  benchmark: {
    sourceType: string
    provisional: boolean
    expertCount: number
  }
  benchmarkValues: Array<{
    candidateId: CandidateId
    benchmarkValue: number
    direction: -1 | 0 | 1
    includeInCore: boolean
    provisional: boolean
  }>
  calculationAnchors: {
    riskExposure: boolean
    riskExposures: Array<{
      candidateId: CandidateId
      sequenceNo: number
      serverAt: string
      evidenceIds: string[]
    }>
    primaryRisk: {
      candidateId: CandidateId
      sequenceNo: number
      serverAt: string
      evidenceIds: string[]
    } | null
    costAfterPrimaryRisk: number
    totalTimeSec: number
    timeAfterPrimaryRiskSec: number | null
    shallowCandidateIds: CandidateId[]
  }
}

function fail(code: ScoringFailureCode, detail: string): never {
  throw new ScoringInputError(code, detail)
}

function parseStringArray(value: string, label: string): string[] {
  try {
    const parsed = JSON.parse(value) as unknown
    if (!Array.isArray(parsed) || !parsed.every((item) => typeof item === 'string') ||
      new Set(parsed).size !== parsed.length) {
      return fail('EVIDENCE_INCONSISTENT', `${label} must be a unique string array.`)
    }
    return parsed
  } catch (error) {
    if (error instanceof ScoringInputError) throw error
    return fail('EVIDENCE_INCONSISTENT', `${label} is not valid JSON.`)
  }
}

function parseCandidateOrder(value: string): CandidateId[] {
  const order = parseStringArray(value, 'candidate display order')
  const expected = ['A', 'B', 'C', 'D', 'E']
  if (order.length !== expected.length ||
    !expected.every((candidateId) => order.includes(candidateId))) {
    return fail('INPUT_INCOMPLETE', 'Candidate display order must contain A-E exactly once.')
  }
  return order as CandidateId[]
}

function parseTime(value: string | null, label: string): number {
  if (value === null) return fail('TIME_INCONSISTENT', `${label} is missing.`)
  const parsed = Date.parse(value)
  if (!Number.isFinite(parsed)) return fail('TIME_INCONSISTENT', `${label} is invalid.`)
  return parsed
}

function arraysEqual(left: readonly string[], right: readonly string[]) {
  return left.length === right.length && left.every((value, index) => value === right[index])
}

function isSupportedPrepilotDefinition(definition: ScoringDefinitionRow): boolean {
  try {
    const config = JSON.parse(definition.formula_config_json) as Record<string, unknown>
    const weights = JSON.parse(definition.weights_json) as Record<string, unknown>
    const sls = config.sls as Record<string, unknown> | undefined
    return definition.formula_family === 'RDI-2.0' &&
      definition.time_unit === 'second' &&
      Array.isArray(config.eacCandidateIds) &&
      arraysEqual(config.eacCandidateIds as string[], ['A', 'B', 'C', 'D']) &&
      config.primaryRiskAnchor === 'earliest_server_key_risk' &&
      config.timeUnit === 'second' &&
      config.availableCaseMean === true &&
      config.ddsRequiresRiskExposure === true &&
      sls?.stop_loss === 100 && sls?.give_up === 80 && sls?.continue === 30 &&
      weights.RES === 0.35 && weights.EACS === 0.35 && weights.DDS === 0.15 &&
      weights.GDS === 0.1 && weights.SLS === 0.05
  } catch {
    return false
  }
}

function validateUniqueSequences(sequences: number[], max: number) {
  if (sequences.some((sequence) => !Number.isInteger(sequence) || sequence < 1 || sequence > max) ||
    new Set(sequences).size !== sequences.length) {
    fail('SEQUENCE_INCONSISTENT', 'Server fact sequences are duplicated or out of range.')
  }
}

export async function buildPrepilotScoringSnapshot(
  db: D1Database,
  sessionId: string,
  options: ScoringInputOptions = {},
): Promise<PrepilotScoringSnapshot> {
  try {
    const session = await db.prepare(`SELECT
      s.session_id,s.completion_status,s.current_step,s.final_submit_mode,
      s.config_set_id,s.task_version,s.material_version,s.point_rule_version,
      s.scoring_version,s.benchmark_version,s.norm_version,s.sunk_cost_rule_version,
      s.candidate_display_order,s.started_at,s.deadline_at,s.ended_at,
      c.task_version AS config_task_version,
      c.material_version AS config_material_version,
      c.point_rule_version AS config_point_rule_version,
      c.scoring_version AS config_scoring_version,
      c.benchmark_version AS config_benchmark_version,
      c.norm_version AS config_norm_version,
      c.sunk_cost_rule_version AS config_sunk_cost_rule_version,
      cr.completion_id,cr.completion_status AS completion_record_status,
      cr.final_submit_mode AS completion_record_mode,
      cr.sequence_no AS completion_sequence_no,cr.server_completed_at,
      g.started_at AS run_started_at,g.deadline_at AS run_deadline_at,
      g.finalized_at,g.points_total,g.points_remaining,g.last_sequence_no,
      p.total_points AS rule_total_points
      FROM sessions s
      JOIN configuration_sets c ON c.config_set_id=s.config_set_id
      LEFT JOIN completion_records cr ON cr.session_id=s.session_id
      LEFT JOIN game_runs g ON g.session_id=s.session_id
      LEFT JOIN point_rules p ON p.point_rule_version=s.point_rule_version
      WHERE s.session_id=?`).bind(sessionId).first<SessionRow>()
    if (!session || session.current_step !== 'completed' || !session.completion_id ||
      !['completed', 'timeout'].includes(session.completion_status)) {
      return fail('SESSION_NOT_ELIGIBLE', 'Only completed formal sessions can be scored.')
    }
    const versionPairs: Array<[unknown, unknown]> = [
      [session.task_version, session.config_task_version],
      [session.material_version, session.config_material_version],
      [session.point_rule_version, session.config_point_rule_version],
      [session.scoring_version, session.config_scoring_version],
      [session.benchmark_version, session.config_benchmark_version],
      [session.norm_version, session.config_norm_version],
      [session.sunk_cost_rule_version, session.config_sunk_cost_rule_version],
    ]
    if (versionPairs.some(([bound, configured]) => bound !== configured)) {
      return fail('VERSION_NOT_READY', 'Session versions do not match the bound configuration.')
    }
    if (session.completion_record_status !== session.completion_status ||
      session.completion_record_mode !== session.final_submit_mode ||
      session.points_total === null || session.points_remaining === null ||
      session.last_sequence_no === null || session.rule_total_points !== session.points_total) {
      return fail('INPUT_INCOMPLETE', 'Completion, run, or point-rule facts are incomplete.')
    }

    const scoringVersion = options.scoringVersion ?? session.scoring_version
    const benchmarkVersion = options.benchmarkVersion ?? session.benchmark_version
    const normVersion = options.normVersion === undefined ? session.norm_version : options.normVersion
    const reliabilityVersion = options.reliabilityVersion ?? null
    if (normVersion !== null || reliabilityVersion !== null) {
      return fail(
        'VERSION_NOT_READY',
        'Stage 8 prepilot scoring does not accept norm or reliability parameter versions.',
      )
    }
    const [definition, benchmark, benchmarkRows, benchmarkExpertStats,
      finalDecision, ratingRows,
      evidenceRows, evidenceItemRows, ledgerRows, choiceRows, sunkCost,
      questionnaireSequences] = await Promise.all([
      db.prepare(`SELECT scoring_version,formula_family,formula_config_json,
        weights_json,time_unit FROM scoring_definitions
        WHERE scoring_version=? AND status='published' AND is_pre_pilot=1
        AND total_rdi_enabled=0 AND level_enabled=0`).bind(scoringVersion)
        .first<ScoringDefinitionRow>(),
      db.prepare(`SELECT source_type,status,is_provisional,expert_count,validated_at
        FROM benchmark_sets WHERE benchmark_version=? AND status='published'`)
        .bind(benchmarkVersion).first<BenchmarkSetRow>(),
      db.prepare(`SELECT candidate_id,benchmark_value,direction,include_in_core_eac
        FROM benchmark_candidate_values WHERE benchmark_version=? ORDER BY candidate_id`)
        .bind(benchmarkVersion).all<BenchmarkValueRow>(),
      db.prepare(`SELECT COUNT(*) AS score_count,
        COUNT(DISTINCT expert_code) AS actual_expert_count,
        COUNT(DISTINCT candidate_id) AS candidate_count
        FROM benchmark_expert_scores WHERE benchmark_version=?`)
        .bind(benchmarkVersion).first<BenchmarkExpertStatsRow>(),
      db.prepare(`SELECT candidate_id,confidence,submit_mode,source_stage,
        selection_origin,auto_selected,server_submitted_at,sequence_no,
        points_remaining_at_submit FROM final_decisions WHERE session_id=?`)
        .bind(sessionId).first<FinalRow>(),
      db.prepare(`SELECT candidate_id,stage,rating_value,evidence_ids_seen,
        server_submitted_at,sequence_no FROM stage_ratings
        WHERE session_id=? ORDER BY sequence_no`).bind(sessionId).all<RatingRow>(),
      db.prepare(`SELECT event_id,candidate_id,evidence_level,material_version,
        point_rule_version,evidence_ids_json,
        points_before,points_cost,points_after,contains_key_risk,server_at,sequence_no
        FROM evidence_events WHERE session_id=? ORDER BY sequence_no`)
        .bind(sessionId).all<EvidenceRow>(),
      db.prepare(`SELECT i.event_id,i.material_version,i.evidence_id,i.item_order
        FROM evidence_event_items i JOIN evidence_events e ON e.event_id=i.event_id
        WHERE e.session_id=? ORDER BY e.sequence_no,i.item_order`)
        .bind(sessionId).all<EvidenceItemRow>(),
      db.prepare(`SELECT event_id,candidate_id,evidence_level,points_before,
        points_delta,points_after,sequence_no FROM point_ledger
        WHERE session_id=? ORDER BY sequence_no`).bind(sessionId).all<LedgerRow>(),
      db.prepare(`SELECT stage,candidate_id,confidence,server_submitted_at,sequence_no
        FROM stage_choices WHERE session_id=? ORDER BY sequence_no`)
        .bind(sessionId).all<ChoiceRow>(),
      db.prepare(`SELECT target_candidate_id,risk_evidence_ids_seen,
        points_invested_before,points_remaining_at_show,shown_at,show_sequence_no,
        choice,choice_submitted_at,choice_sequence_no,points_remaining_at_choice,
        points_after_choice,choice_status FROM sunk_cost_events WHERE session_id=?`)
        .bind(sessionId).first<SunkRow>(),
      db.prepare(`SELECT sequence_no FROM questionnaire_submissions
        WHERE session_id=? AND sequence_no IS NOT NULL ORDER BY sequence_no`)
        .bind(sessionId).all<{ sequence_no: number }>(),
    ])
    if (!definition || !isSupportedPrepilotDefinition(definition)) {
      return fail(
        'VERSION_NOT_READY',
        'The published prepilot scoring definition is unavailable or unsupported.',
      )
    }
    if (!benchmark) return fail('VERSION_NOT_READY', 'Published benchmark set is unavailable.')
    if (benchmarkRows.results.length !== 5 ||
      !['A', 'B', 'C', 'D', 'E'].every((id) =>
        benchmarkRows.results.some(({ candidate_id }) => candidate_id === id))) {
      return fail('BENCHMARK_INCOMPLETE', 'The benchmark does not contain exactly A-E.')
    }
    if (benchmark.source_type === 'current_app_baseline' && benchmark.is_provisional !== 1) {
      return fail(
        'BENCHMARK_INCOMPLETE',
        'Current-app baseline benchmarks must remain provisional.',
      )
    }
    if (benchmark.is_provisional === 0 &&
      (benchmark.source_type !== 'expert_panel' || benchmark.validated_at === null ||
        !benchmarkExpertStats || benchmark.expert_count <= 0 ||
        benchmarkExpertStats.actual_expert_count !== benchmark.expert_count ||
        benchmarkExpertStats.candidate_count !== 5 ||
        benchmarkExpertStats.score_count !== benchmark.expert_count * 5)) {
      return fail(
        'BENCHMARK_INCOMPLETE',
        'The formal expert benchmark does not contain complete stored expert coverage.',
      )
    }
    if (!finalDecision || !sunkCost) {
      return fail('INPUT_INCOMPLETE', 'Final decision or sunk-cost state is missing.')
    }
    if (finalDecision.submit_mode !== session.final_submit_mode) {
      return fail('INPUT_INCOMPLETE', 'Final decision mode does not match completion mode.')
    }
    if (finalDecision.points_remaining_at_submit !== session.points_remaining) {
      return fail(
        'POINT_LEDGER_INCONSISTENT',
        'Final decision points do not match the sealed game balance.',
      )
    }
    if (session.completion_sequence_no !== session.last_sequence_no) {
      return fail(
        'SEQUENCE_INCONSISTENT',
        'The completion record must be the final server sequence.',
      )
    }
    if (!benchmarkRows.results.some(({ candidate_id }) =>
      candidate_id === finalDecision.candidate_id)) {
      return fail('BENCHMARK_INCOMPLETE', 'The final candidate benchmark is unavailable.')
    }
    const t1CandidateIds = ratingRows.results
      .filter(({ stage }) => stage === 'T1').map(({ candidate_id }) => candidate_id)
    if (t1CandidateIds.length !== 5 || new Set(t1CandidateIds).size !== 5) {
      return fail('INPUT_INCOMPLETE', 'All five sealed T1 ratings are required.')
    }

    const evidenceItems = new Map<string, EvidenceItemRow[]>()
    for (const row of evidenceItemRows.results) {
      const existing = evidenceItems.get(row.event_id) ?? []
      existing.push(row)
      evidenceItems.set(row.event_id, existing)
    }
    const evidenceEvents = evidenceRows.results.map((row) => {
      if (row.material_version !== session.material_version ||
        row.point_rule_version !== session.point_rule_version) {
        return fail(
          'VERSION_NOT_READY',
          'Evidence facts do not match the session material and point-rule versions.',
        )
      }
      const fromEvent = parseStringArray(row.evidence_ids_json, 'evidence event IDs')
      const itemRows = evidenceItems.get(row.event_id) ?? []
      const fromItems = itemRows.map(({ evidence_id }) => evidence_id)
      if (itemRows.some(({ material_version }) =>
        material_version !== row.material_version || material_version !== session.material_version)) {
        return fail(
          'VERSION_NOT_READY',
          'Evidence item facts do not match the event and session material version.',
        )
      }
      if (!arraysEqual(fromEvent, fromItems)) {
        return fail('EVIDENCE_INCONSISTENT', 'Evidence event IDs do not match event items.')
      }
      return {
        eventId: row.event_id,
        candidateId: row.candidate_id,
        level: row.evidence_level,
        materialVersion: row.material_version,
        pointRuleVersion: row.point_rule_version,
        evidenceIds: fromEvent,
        containsKeyRisk: row.contains_key_risk === 1,
        pointsBefore: row.points_before,
        cost: row.points_cost,
        pointsAfter: row.points_after,
        serverAt: row.server_at,
        sequenceNo: row.sequence_no,
      }
    })

    const ledgerByEvent = new Map(ledgerRows.results.map((row) => [row.event_id, row]))
    let expectedPoints = session.points_total
    for (const event of evidenceEvents) {
      const ledger = ledgerByEvent.get(event.eventId)
      if (!ledger || ledger.sequence_no !== event.sequenceNo ||
        ledger.candidate_id !== event.candidateId || ledger.evidence_level !== event.level ||
        ledger.points_before !== event.pointsBefore || ledger.points_delta !== -event.cost ||
        ledger.points_after !== event.pointsAfter || event.pointsBefore !== expectedPoints ||
        event.pointsAfter !== event.pointsBefore - event.cost) {
        return fail('POINT_LEDGER_INCONSISTENT', 'Evidence costs do not match the point ledger.')
      }
      expectedPoints = event.pointsAfter
    }
    if (ledgerRows.results.length !== evidenceEvents.length ||
      expectedPoints !== session.points_remaining) {
      return fail('POINT_LEDGER_INCONSISTENT', 'Point ledger conservation failed.')
    }

    const ratings = ratingRows.results.map((row) => ({
      candidateId: row.candidate_id,
      stage: row.stage,
      value: row.rating_value,
      evidenceIdsSeen: parseStringArray(row.evidence_ids_seen, 'rating evidence IDs'),
      serverSubmittedAt: row.server_submitted_at,
      sequenceNo: row.sequence_no,
    }))
    for (const rating of ratings) {
      const expectedEvidence = evidenceEvents
        .filter((event) => event.candidateId === rating.candidateId &&
          event.sequenceNo < rating.sequenceNo)
        .flatMap(({ evidenceIds }) => evidenceIds)
      if (!arraysEqual(rating.evidenceIdsSeen, expectedEvidence)) {
        return fail('EVIDENCE_INCONSISTENT', 'Rating evidence snapshot is inconsistent.')
      }
    }

    validateUniqueSequences([
      ...ratings.map(({ sequenceNo }) => sequenceNo),
      ...evidenceEvents.map(({ sequenceNo }) => sequenceNo),
      ...choiceRows.results.map(({ sequence_no }) => sequence_no),
      ...(sunkCost.show_sequence_no === null ? [] : [sunkCost.show_sequence_no]),
      ...(sunkCost.choice_sequence_no === null ? [] : [sunkCost.choice_sequence_no]),
      finalDecision.sequence_no,
      ...questionnaireSequences.results.map(({ sequence_no }) => sequence_no),
      session.completion_sequence_no!,
    ], session.last_sequence_no)

    const startedMs = parseTime(session.run_started_at, 'game start time')
    const finalMs = parseTime(finalDecision.server_submitted_at, 'final decision time')
    const finalizedMs = parseTime(session.finalized_at, 'finalized time')
    const endedMs = parseTime(session.ended_at, 'session end time')
    if (finalMs <= startedMs || finalizedMs !== finalMs || finalizedMs > endedMs) {
      return fail('TIME_INCONSISTENT', 'Game decision timestamps are out of order.')
    }
    const timedFacts = [
      ...ratings.map((rating) => ({
        sequenceNo: rating.sequenceNo,
        serverAt: rating.serverSubmittedAt,
        label: `${rating.stage} rating`,
      })),
      ...evidenceEvents.map((event) => ({
        sequenceNo: event.sequenceNo,
        serverAt: event.serverAt,
        label: `${event.level} evidence`,
      })),
      ...choiceRows.results.map((choice) => ({
        sequenceNo: choice.sequence_no,
        serverAt: choice.server_submitted_at,
        label: `${choice.stage} choice`,
      })),
      ...(sunkCost.show_sequence_no === null ? [] : [{
        sequenceNo: sunkCost.show_sequence_no,
        serverAt: sunkCost.shown_at,
        label: 'sunk-cost show',
      }]),
      ...(sunkCost.choice_sequence_no === null ? [] : [{
        sequenceNo: sunkCost.choice_sequence_no,
        serverAt: sunkCost.choice_submitted_at,
        label: 'sunk-cost choice',
      }]),
      {
        sequenceNo: finalDecision.sequence_no,
        serverAt: finalDecision.server_submitted_at,
        label: 'final decision',
      },
    ].sort((left, right) => left.sequenceNo - right.sequenceNo)
    let priorMs = startedMs
    for (const fact of timedFacts) {
      const factMs = parseTime(fact.serverAt, `${fact.label} time`)
      if (factMs < startedMs || factMs > finalMs || factMs < priorMs) {
        return fail(
          'TIME_INCONSISTENT',
          'Game fact timestamps fall outside the sealed interval or server sequence.',
        )
      }
      priorMs = factMs
    }
    const totalTimeSec = (finalMs - startedMs) / 1000

    const riskExposures = evidenceEvents
      .filter(({ containsKeyRisk }) => containsKeyRisk)
      .map((event) => ({
        candidateId: event.candidateId,
        sequenceNo: event.sequenceNo,
        serverAt: event.serverAt,
        evidenceIds: event.evidenceIds,
      }))
    const primaryRisk = riskExposures[0] ?? null
    const costAfterPrimaryRisk = primaryRisk === null ? 0 : evidenceEvents
      .filter((event) => event.candidateId === primaryRisk.candidateId &&
        event.sequenceNo > primaryRisk.sequenceNo)
      .reduce((total, event) => total + event.cost, 0)
    let timeAfterPrimaryRiskSec: number | null = null
    if (primaryRisk !== null) {
      const riskMs = parseTime(primaryRisk.serverAt, 'primary risk time')
      timeAfterPrimaryRiskSec = (finalMs - riskMs) / 1000
      if (timeAfterPrimaryRiskSec < 0 || timeAfterPrimaryRiskSec > totalTimeSec) {
        return fail('TIME_INCONSISTENT', 'Risk-to-final time is outside the game interval.')
      }
    }

    return {
      inputSchemaVersion: 'prepilot-input-1',
      session: {
        sessionId,
        completionStatus: session.completion_status as 'completed' | 'timeout',
        finalSubmitMode: session.final_submit_mode as 'active' | 'timeout',
        taskVersion: session.task_version,
        materialVersion: session.material_version,
        pointRuleVersion: session.point_rule_version,
        sessionScoringVersion: session.scoring_version,
        sessionBenchmarkVersion: session.benchmark_version,
        sessionNormVersion: session.norm_version,
        sunkCostRuleVersion: session.sunk_cost_rule_version,
        scoringVersion,
        benchmarkVersion,
        normVersion,
        reliabilityVersion,
        startedAt: session.run_started_at!,
        deadlineAt: session.run_deadline_at!,
        finalizedAt: session.finalized_at!,
        endedAt: session.ended_at!,
        totalPoints: session.points_total,
        pointsRemaining: session.points_remaining,
        candidateDisplayOrder: parseCandidateOrder(session.candidate_display_order),
      },
      finalDecision: {
        candidateId: finalDecision.candidate_id,
        confidence: finalDecision.confidence,
        sourceStage: finalDecision.source_stage,
        submitMode: finalDecision.submit_mode,
        selectionOrigin: finalDecision.selection_origin,
        autoSelected: finalDecision.auto_selected === 1,
        serverSubmittedAt: finalDecision.server_submitted_at,
        sequenceNo: finalDecision.sequence_no,
        pointsRemainingAtSubmit: finalDecision.points_remaining_at_submit,
      },
      ratings,
      evidenceEvents,
      pointLedger: ledgerRows.results.map((row) => ({
        eventId: row.event_id,
        candidateId: row.candidate_id,
        level: row.evidence_level,
        before: row.points_before,
        delta: row.points_delta,
        after: row.points_after,
        sequenceNo: row.sequence_no,
      })),
      stageChoices: choiceRows.results.map((row) => ({
        stage: row.stage,
        candidateId: row.candidate_id,
        confidence: row.confidence,
        serverSubmittedAt: row.server_submitted_at,
        sequenceNo: row.sequence_no,
      })),
      sunkCost: {
        triggered: sunkCost.choice_status !== 'not_triggered',
        targetCandidateId: sunkCost.target_candidate_id,
        choice: sunkCost.choice,
        choiceStatus: sunkCost.choice_status,
        shownAt: sunkCost.shown_at,
        choiceSubmittedAt: sunkCost.choice_submitted_at,
        pointsInvestedBefore: sunkCost.points_invested_before,
        pointsRemainingAtShow: sunkCost.points_remaining_at_show,
        pointsRemainingAtChoice: sunkCost.points_remaining_at_choice,
        pointsAfterChoice: sunkCost.points_after_choice,
        riskEvidenceIdsSeen: parseStringArray(
          sunkCost.risk_evidence_ids_seen,
          'sunk-cost risk evidence IDs',
        ),
      },
      benchmark: {
        sourceType: benchmark.source_type,
        provisional: benchmark.is_provisional === 1,
        expertCount: benchmark.expert_count,
      },
      benchmarkValues: benchmarkRows.results.map((row) => ({
        candidateId: row.candidate_id,
        benchmarkValue: row.benchmark_value,
        direction: row.direction,
        includeInCore: row.include_in_core_eac === 1,
        provisional: benchmark.is_provisional === 1,
      })),
      calculationAnchors: {
        riskExposure: primaryRisk !== null,
        riskExposures,
        primaryRisk,
        costAfterPrimaryRisk,
        totalTimeSec,
        timeAfterPrimaryRiskSec,
        shallowCandidateIds: [...new Set(evidenceEvents
          .filter(({ level }) => level === 'shallow')
          .map(({ candidateId }) => candidateId))],
      },
    }
  } catch (error) {
    if (error instanceof ScoringInputError) throw error
    throw new ScoringInputError(
      'DATABASE_READ_FAILED',
      'The sealed scoring facts could not be read safely.',
    )
  }
}
