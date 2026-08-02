import {
  aggregateAvailableCase,
  calculateDds,
  calculateEacComponent,
  calculateEacsComponent,
  calculateGds,
  calculateRes,
  calculateSls,
  type MetricStatus,
} from '../domain/prepilotMetrics'
import {
  canonicalizeScoringInput,
  fingerprintScoringInput,
} from '../domain/scoringFingerprint'
import {
  buildPrepilotScoringSnapshot,
  ScoringInputError,
  type CandidateId,
  type PrepilotScoringSnapshot,
} from './scoringInput'

type ScoringRunStatus = 'completed' | 'partial' | 'failed'
type EnsureResult = {
  runId: string
  created: boolean
  runStatus: ScoringRunStatus
}

type ScoringOptions = {
  scoringVersion?: string
  benchmarkVersion?: string
  normVersion?: string | null
  reliabilityVersion?: string | null
}

type ExistingRunRow = {
  scoring_run_id: string
  run_status: ScoringRunStatus | 'pending'
}

type MetricArtifact = {
  code: 'RES' | 'EAC' | 'EACS' | 'DDS' | 'GDS' | 'SLS' | 'RCI' | 'RDIz' | 'RDIT'
  value: number | null
  status: MetricStatus
  formulaVersion: string
  coverageCount: number | null
  requiredCount: number | null
  missingReason: string | null
  input: Record<string, unknown>
}

type ComponentArtifact = {
  candidateId: CandidateId
  direction: -1 | 0 | 1
  includeInCore: boolean
  t1Value: number | null
  t3Value: number | null
  t1ServerAt: string | null
  t3ServerAt: string | null
  deltaScore: number | null
  deltaTimeSec: number | null
  eac: number | null
  eacs: number | null
  status: 'calculated' | 'unavailable' | 'excluded'
  missingReason: string | null
}

type VersionContext = {
  scoringVersion: string
  benchmarkVersion: string
  normVersion: string | null
  reliabilityVersion: string | null
}

const CORE_CANDIDATE_IDS = ['A', 'B', 'C', 'D'] as const

function versionKeys(context: VersionContext) {
  return {
    normKey: context.normVersion ?? 'none',
    reliabilityKey: context.reliabilityVersion ?? 'none',
  }
}

async function findExistingRun(
  db: D1Database,
  sessionId: string,
  context: VersionContext,
  sourceFingerprint: string,
) {
  const keys = versionKeys(context)
  return db.prepare(`SELECT scoring_run_id,run_status FROM scoring_runs
    WHERE session_id=? AND scoring_version=? AND benchmark_version=?
      AND norm_key=? AND reliability_key=? AND source_fingerprint=?`)
    .bind(sessionId, context.scoringVersion, context.benchmarkVersion,
      keys.normKey, keys.reliabilityKey, sourceFingerprint)
    .first<ExistingRunRow>()
}

function existingProjection(row: ExistingRunRow): EnsureResult {
  if (row.run_status === 'pending') {
    throw new Error('A pending scoring run cannot be returned as a sealed result.')
  }
  return {
    runId: row.scoring_run_id,
    created: false,
    runStatus: row.run_status,
  }
}

async function loadVersionContext(
  db: D1Database,
  sessionId: string,
  options: ScoringOptions,
): Promise<VersionContext> {
  const row = await db.prepare(`SELECT scoring_version,benchmark_version,norm_version
    FROM sessions WHERE session_id=?`).bind(sessionId).first<{
      scoring_version: string
      benchmark_version: string
      norm_version: string | null
    }>()
  if (!row) {
    throw new ScoringInputError(
      'SESSION_NOT_ELIGIBLE',
      'The scoring session does not exist.',
    )
  }
  return {
    scoringVersion: options.scoringVersion ?? row.scoring_version,
    benchmarkVersion: options.benchmarkVersion ?? row.benchmark_version,
    normVersion: options.normVersion === undefined ? row.norm_version : options.normVersion,
    reliabilityVersion: options.reliabilityVersion ?? null,
  }
}

function calculateArtifacts(snapshot: PrepilotScoringSnapshot) {
  const benchmarkByCandidate = new Map(
    snapshot.benchmarkValues.map((value) => [value.candidateId, value]),
  )
  const finalBenchmark = benchmarkByCandidate.get(snapshot.finalDecision.candidateId)
  if (!finalBenchmark) {
    throw new ScoringInputError(
      'BENCHMARK_INCOMPLETE',
      'The final candidate benchmark is missing.',
    )
  }

  const components: ComponentArtifact[] = snapshot.benchmarkValues.map((benchmark) => {
    const t1 = snapshot.ratings.find((rating) =>
      rating.candidateId === benchmark.candidateId && rating.stage === 'T1')
    const t3 = snapshot.ratings.find((rating) =>
      rating.candidateId === benchmark.candidateId && rating.stage === 'T3')
    if (benchmark.direction === 0 || !benchmark.includeInCore) {
      return {
        candidateId: benchmark.candidateId,
        direction: benchmark.direction,
        includeInCore: benchmark.includeInCore,
        t1Value: t1?.value ?? null,
        t3Value: t3?.value ?? null,
        t1ServerAt: t1?.serverSubmittedAt ?? null,
        t3ServerAt: t3?.serverSubmittedAt ?? null,
        deltaScore: t1 && t3 ? t3.value - t1.value : null,
        deltaTimeSec: null,
        eac: null,
        eacs: null,
        status: 'excluded' as const,
        missingReason: 'excluded_direction_zero',
      }
    }
    if (!t1 || !t3) {
      return {
        candidateId: benchmark.candidateId,
        direction: benchmark.direction,
        includeInCore: benchmark.includeInCore,
        t1Value: t1?.value ?? null,
        t3Value: t3?.value ?? null,
        t1ServerAt: t1?.serverSubmittedAt ?? null,
        t3ServerAt: t3?.serverSubmittedAt ?? null,
        deltaScore: null,
        deltaTimeSec: null,
        eac: null,
        eacs: null,
        status: 'unavailable' as const,
        missingReason: t1 ? 'missing_t3' : 'missing_t1',
      }
    }
    const deltaTimeSec = (
      Date.parse(t3.serverSubmittedAt) - Date.parse(t1.serverSubmittedAt)
    ) / 1000
    if (!Number.isFinite(deltaTimeSec) || deltaTimeSec <= 0) {
      throw new ScoringInputError(
        'TIME_INCONSISTENT',
        `T3 must follow T1 for candidate ${benchmark.candidateId}.`,
      )
    }
    return {
      candidateId: benchmark.candidateId,
      direction: benchmark.direction,
      includeInCore: benchmark.includeInCore,
      t1Value: t1.value,
      t3Value: t3.value,
      t1ServerAt: t1.serverSubmittedAt,
      t3ServerAt: t3.serverSubmittedAt,
      deltaScore: t3.value - t1.value,
      deltaTimeSec,
      eac: calculateEacComponent(benchmark.direction, t1.value, t3.value),
      eacs: calculateEacsComponent(
        benchmark.direction,
        t1.value,
        t3.value,
        deltaTimeSec,
      ),
      status: 'calculated' as const,
      missingReason: null,
    }
  })

  const eacValues = Object.fromEntries(components.map((component) => [
    component.candidateId,
    component.eac,
  ]))
  const eacsValues = Object.fromEntries(components.map((component) => [
    component.candidateId,
    component.eacs,
  ]))
  const eac = aggregateAvailableCase(eacValues, CORE_CANDIDATE_IDS)
  const eacs = aggregateAvailableCase(eacsValues, CORE_CANDIDATE_IDS)
  const res = calculateRes({
    benchmarkValue: finalBenchmark.benchmarkValue,
    costAfterRisk: snapshot.calculationAnchors.costAfterPrimaryRisk,
    totalPoints: snapshot.session.totalPoints,
    benchmarkIsProvisional: snapshot.benchmark.provisional,
  })
  const gds = calculateGds({
    shallowCandidateCount: snapshot.calculationAnchors.shallowCandidateIds.length,
    candidateCount: snapshot.benchmarkValues.length,
    benchmarkValue: finalBenchmark.benchmarkValue,
    benchmarkIsProvisional: snapshot.benchmark.provisional,
  })
  const sls = calculateSls(
    snapshot.sunkCost.choiceStatus,
    snapshot.sunkCost.choice,
  )
  const dds = snapshot.calculationAnchors.primaryRisk === null
    ? {
        value: null,
        status: 'not_applicable' as const,
        missingReason: 'no_key_risk_exposure',
      }
    : {
        value: calculateDds({
          costAfterRisk: snapshot.calculationAnchors.costAfterPrimaryRisk,
          totalPoints: snapshot.session.totalPoints,
          timeAfterRiskSec: snapshot.calculationAnchors.timeAfterPrimaryRiskSec!,
          totalTimeSec: snapshot.calculationAnchors.totalTimeSec,
        }),
        status: 'calculated' as const,
        missingReason: null,
      }

  const metrics: MetricArtifact[] = [
    {
      code: 'RES',
      value: res.value,
      status: res.status,
      formulaVersion: `${snapshot.session.scoringVersion}/RES-1`,
      coverageCount: null,
      requiredCount: null,
      missingReason: snapshot.benchmark.provisional ? 'provisional_benchmark' : null,
      input: {
        benchmarkValue: finalBenchmark.benchmarkValue,
        finalCandidateId: snapshot.finalDecision.candidateId,
        costAfterRisk: snapshot.calculationAnchors.costAfterPrimaryRisk,
        totalPoints: snapshot.session.totalPoints,
        benchmarkProvisional: snapshot.benchmark.provisional,
      },
    },
    {
      code: 'EAC',
      value: eac.value,
      status: eac.status,
      formulaVersion: `${snapshot.session.scoringVersion}/EAC-1`,
      coverageCount: eac.coverageCount,
      requiredCount: eac.requiredCount,
      missingReason: eac.missingCandidateIds.length > 0
        ? `missing_t3:${eac.missingCandidateIds.join(',')}`
        : null,
      input: { components: eacValues, missingCandidateIds: eac.missingCandidateIds },
    },
    {
      code: 'EACS',
      value: eacs.value,
      status: eacs.status,
      formulaVersion: `${snapshot.session.scoringVersion}/EACS-1-second`,
      coverageCount: eacs.coverageCount,
      requiredCount: eacs.requiredCount,
      missingReason: eacs.missingCandidateIds.length > 0
        ? `missing_t3:${eacs.missingCandidateIds.join(',')}`
        : null,
      input: {
        components: eacsValues,
        missingCandidateIds: eacs.missingCandidateIds,
        timeUnit: 'second',
      },
    },
    {
      code: 'DDS',
      value: dds.value,
      status: dds.status,
      formulaVersion: `${snapshot.session.scoringVersion}/DDS-1`,
      coverageCount: null,
      requiredCount: null,
      missingReason: dds.missingReason,
      input: {
        riskExposure: snapshot.calculationAnchors.riskExposure,
        primaryRisk: snapshot.calculationAnchors.primaryRisk,
        costAfterRisk: snapshot.calculationAnchors.costAfterPrimaryRisk,
        totalPoints: snapshot.session.totalPoints,
        timeAfterRiskSec: snapshot.calculationAnchors.timeAfterPrimaryRiskSec,
        totalTimeSec: snapshot.calculationAnchors.totalTimeSec,
      },
    },
    {
      code: 'GDS',
      value: gds.value,
      status: gds.status,
      formulaVersion: `${snapshot.session.scoringVersion}/GDS-1`,
      coverageCount: snapshot.calculationAnchors.shallowCandidateIds.length,
      requiredCount: snapshot.benchmarkValues.length,
      missingReason: snapshot.benchmark.provisional ? 'provisional_benchmark' : null,
      input: {
        shallowCandidateIds: snapshot.calculationAnchors.shallowCandidateIds,
        shallowCandidateCount: snapshot.calculationAnchors.shallowCandidateIds.length,
        candidateCount: snapshot.benchmarkValues.length,
        benchmarkValue: finalBenchmark.benchmarkValue,
        benchmarkProvisional: snapshot.benchmark.provisional,
      },
    },
    {
      code: 'SLS',
      value: sls.value,
      status: sls.status,
      formulaVersion: `${snapshot.session.scoringVersion}/SLS-1`,
      coverageCount: null,
      requiredCount: null,
      missingReason: sls.missingReason,
      input: {
        choiceStatus: snapshot.sunkCost.choiceStatus,
        choice: snapshot.sunkCost.choice,
        pointsAfterChoice: snapshot.sunkCost.pointsAfterChoice,
      },
    },
    {
      code: 'RCI',
      value: null,
      status: 'pending_parameters',
      formulaVersion: `${snapshot.session.scoringVersion}/RCI-1`,
      coverageCount: eac.coverageCount,
      requiredCount: eac.requiredCount,
      missingReason: 'reliability_parameters_unavailable',
      input: {
        reliabilityVersion: snapshot.session.reliabilityVersion,
        componentEacValues: eacValues,
      },
    },
    {
      code: 'RDIz',
      value: null,
      status: 'norms_unavailable',
      formulaVersion: `${snapshot.session.scoringVersion}/RDIz-1`,
      coverageCount: null,
      requiredCount: 5,
      missingReason: 'published_norms_unavailable',
      input: { normVersion: snapshot.session.normVersion },
    },
    {
      code: 'RDIT',
      value: null,
      status: 'norms_unavailable',
      formulaVersion: `${snapshot.session.scoringVersion}/RDIT-1`,
      coverageCount: null,
      requiredCount: 5,
      missingReason: 'published_norms_unavailable',
      input: { normVersion: snapshot.session.normVersion },
    },
  ]
  const missingReasons = [...new Set(metrics
    .map(({ missingReason }) => missingReason)
    .filter((reason): reason is string => reason !== null))].sort()
  const runStatus: 'completed' | 'partial' = metrics.some(({ status }) =>
    status !== 'calculated') ? 'partial' : 'completed'
  return { components, metrics, missingReasons, runStatus }
}

async function persistSuccessfulRun(
  db: D1Database,
  snapshot: PrepilotScoringSnapshot,
  sourceFingerprint: string,
  artifacts: ReturnType<typeof calculateArtifacts>,
): Promise<EnsureResult> {
  const context: VersionContext = {
    scoringVersion: snapshot.session.scoringVersion,
    benchmarkVersion: snapshot.session.benchmarkVersion,
    normVersion: snapshot.session.normVersion,
    reliabilityVersion: snapshot.session.reliabilityVersion,
  }
  const existing = await findExistingRun(
    db,
    snapshot.session.sessionId,
    context,
    sourceFingerprint,
  )
  if (existing) return existingProjection(existing)
  const runId = crypto.randomUUID()
  const computedAt = new Date().toISOString()
  const keys = versionKeys(context)
  const statements: D1PreparedStatement[] = [
    db.prepare(`UPDATE scoring_runs SET is_current=0
      WHERE session_id=? AND is_current=1`).bind(snapshot.session.sessionId),
    db.prepare(`INSERT INTO scoring_runs (
      scoring_run_id,session_id,scoring_version,benchmark_version,norm_version,
      reliability_version,norm_key,reliability_key,source_fingerprint,run_status,
      is_pre_pilot,interpretation_status,rdi_status,missing_reasons_json,
      failure_code,failure_detail_safe,started_at,completed_at,is_current
    ) VALUES (?,?,?,?,?,?,?,?,?,?,1,'research_only','norms_unavailable',json(?),
      NULL,NULL,?,?,1)`).bind(
      runId,
      snapshot.session.sessionId,
      context.scoringVersion,
      context.benchmarkVersion,
      context.normVersion,
      context.reliabilityVersion,
      keys.normKey,
      keys.reliabilityKey,
      sourceFingerprint,
      artifacts.runStatus,
      JSON.stringify(artifacts.missingReasons),
      computedAt,
      computedAt,
    ),
    db.prepare(`INSERT INTO scoring_input_snapshots (
      scoring_run_id,session_id,input_json,input_schema_version,captured_at
    ) VALUES (?,?,json(?),?,?)`).bind(
      runId,
      snapshot.session.sessionId,
      canonicalizeScoringInput(snapshot),
      snapshot.inputSchemaVersion,
      computedAt,
    ),
  ]
  for (const metric of artifacts.metrics) {
    statements.push(db.prepare(`INSERT INTO derived_metric_values (
      metric_value_id,scoring_run_id,metric_code,numeric_value,
      calculation_status,formula_version,coverage_count,required_count,
      missing_reason,input_json,computed_at
    ) VALUES (?,?,?,?,?,?,?,?,?,json(?),?)`).bind(
      crypto.randomUUID(),
      runId,
      metric.code,
      metric.value,
      metric.status,
      metric.formulaVersion,
      metric.coverageCount,
      metric.requiredCount,
      metric.missingReason,
      canonicalizeScoringInput(metric.input),
      computedAt,
    ))
  }
  for (const component of artifacts.components) {
    statements.push(db.prepare(`INSERT INTO candidate_metric_components (
      component_id,scoring_run_id,candidate_id,direction,include_in_core,
      t1_value,t3_value,t1_server_at,t3_server_at,delta_score,delta_time_sec,
      eac_i,eacs_i,rci_i,calculation_status,missing_reason,computed_at
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,NULL,?,?,?)`).bind(
      crypto.randomUUID(),
      runId,
      component.candidateId,
      component.direction,
      component.includeInCore ? 1 : 0,
      component.t1Value,
      component.t3Value,
      component.t1ServerAt,
      component.t3ServerAt,
      component.deltaScore,
      component.deltaTimeSec,
      component.eac,
      component.eacs,
      component.status,
      component.missingReason,
      computedAt,
    ))
  }
  try {
    await db.batch(statements)
    return { runId, created: true, runStatus: artifacts.runStatus }
  } catch (error) {
    const winner = await findExistingRun(
      db,
      snapshot.session.sessionId,
      context,
      sourceFingerprint,
    )
    if (winner) return existingProjection(winner)
    throw error
  }
}

async function buildFailureFingerprintSource(
  db: D1Database,
  sessionId: string,
  context: VersionContext,
  failureCode: string,
) {
  const [session, configuration, pointRule, scoringDefinition, benchmarkSet,
    benchmarkValues, benchmarkExpertScores, normSet, normParameters,
    reliabilityParameter, ratings, evidenceEvents, evidenceItems, pointLedger,
    stageChoices, sunkCost, finalDecision, completion,
    questionnaires] = await Promise.all([
    db.prepare(`SELECT s.session_id,s.mode,s.current_step,s.completion_status,
      s.final_submit_mode,s.config_set_id,s.task_version,s.material_version,
      s.point_rule_version,s.scoring_version,s.benchmark_version,s.norm_version,
      s.sunk_cost_rule_version,s.candidate_display_order,s.started_at,
      s.deadline_at,s.ended_at,g.current_stage,g.duration_sec,g.points_total,
      g.points_remaining,g.last_sequence_no,g.started_at AS run_started_at,
      g.deadline_at AS run_deadline_at,g.finalized_at
      FROM sessions s LEFT JOIN game_runs g ON g.session_id=s.session_id
      WHERE s.session_id=?`).bind(sessionId).first<Record<string, unknown>>(),
    db.prepare(`SELECT c.config_set_id,c.task_version,c.material_version,
      c.point_rule_version,c.scoring_version,c.benchmark_version,c.norm_version,
      c.status,c.is_active,c.published_at FROM sessions s
      JOIN configuration_sets c ON c.config_set_id=s.config_set_id
      WHERE s.session_id=?`).bind(sessionId).first<Record<string, unknown>>(),
    db.prepare(`SELECT p.point_rule_version,p.total_points,p.shallow_cost,
      p.deep_cost,p.status FROM sessions s JOIN point_rules p
      ON p.point_rule_version=s.point_rule_version WHERE s.session_id=?`)
      .bind(sessionId).first<Record<string, unknown>>(),
    db.prepare(`SELECT scoring_version,formula_family,status,is_pre_pilot,
      total_rdi_enabled,level_enabled,formula_config_json,weights_json,time_unit
      FROM scoring_definitions WHERE scoring_version=?`).bind(context.scoringVersion)
      .first<Record<string, unknown>>(),
    db.prepare(`SELECT benchmark_version,source_type,status,is_provisional,
      expert_count,rated_at,validated_at FROM benchmark_sets
      WHERE benchmark_version=?`).bind(context.benchmarkVersion)
      .first<Record<string, unknown>>(),
    db.prepare(`SELECT candidate_id,benchmark_value,benchmark_sd,direction,
      include_in_core_eac FROM benchmark_candidate_values
      WHERE benchmark_version=? ORDER BY candidate_id`).bind(context.benchmarkVersion)
      .all<Record<string, unknown>>(),
    db.prepare(`SELECT candidate_id,expert_code,score,submitted_at
      FROM benchmark_expert_scores WHERE benchmark_version=?
      ORDER BY expert_code,candidate_id`).bind(context.benchmarkVersion)
      .all<Record<string, unknown>>(),
    db.prepare(`SELECT norm_version,scoring_version,status,sample_size,published_at
      FROM norm_sets WHERE norm_version=?`).bind(context.normVersion)
      .first<Record<string, unknown>>(),
    db.prepare(`SELECT metric_code,mean_value,sd_value FROM norm_metric_parameters
      WHERE norm_version=? ORDER BY metric_code`).bind(context.normVersion)
      .all<Record<string, unknown>>(),
    db.prepare(`SELECT reliability_version,scoring_version,metric_code,sd_value,
      reliability_value,status,sample_size,published_at
      FROM reliability_parameters WHERE reliability_version=?`)
      .bind(context.reliabilityVersion).first<Record<string, unknown>>(),
    db.prepare(`SELECT event_id,candidate_id,stage,rating_value,evidence_ids_seen,
      server_submitted_at,sequence_no FROM stage_ratings WHERE session_id=?
      ORDER BY sequence_no,rating_id`).bind(sessionId).all<Record<string, unknown>>(),
    db.prepare(`SELECT event_id,candidate_id,evidence_level,rating_stage,
      material_version,point_rule_version,evidence_ids_json,points_before,
      points_cost,points_after,contains_key_risk,server_at,sequence_no
      FROM evidence_events WHERE session_id=? ORDER BY sequence_no,event_id`)
      .bind(sessionId).all<Record<string, unknown>>(),
    db.prepare(`SELECT i.event_id,i.material_version,i.evidence_id,i.item_order
      FROM evidence_event_items i JOIN evidence_events e ON e.event_id=i.event_id
      WHERE e.session_id=? ORDER BY e.sequence_no,i.item_order,i.evidence_id`)
      .bind(sessionId).all<Record<string, unknown>>(),
    db.prepare(`SELECT event_id,reason,candidate_id,evidence_level,points_before,
      points_delta,points_after,sequence_no,created_at FROM point_ledger
      WHERE session_id=? ORDER BY sequence_no,ledger_id`)
      .bind(sessionId).all<Record<string, unknown>>(),
    db.prepare(`SELECT event_id,stage,candidate_id,confidence,submit_mode,
      server_submitted_at,sequence_no FROM stage_choices WHERE session_id=?
      ORDER BY sequence_no,choice_id`).bind(sessionId).all<Record<string, unknown>>(),
    db.prepare(`SELECT target_candidate_id,trigger_rule_version,trigger_reason,
      risk_evidence_ids_seen,points_invested_before,points_remaining_at_show,
      shown_at,show_sequence_no,choice,choice_submitted_at,choice_sequence_no,
      points_remaining_at_choice,points_after_choice,choice_status
      FROM sunk_cost_events WHERE session_id=?`).bind(sessionId)
      .first<Record<string, unknown>>(),
    db.prepare(`SELECT candidate_id,confidence,submit_mode,source_stage,
      selection_origin,auto_selected,server_submitted_at,sequence_no,
      remaining_sec_at_submit,points_remaining_at_submit,sunk_cost_choice
      FROM final_decisions WHERE session_id=?`).bind(sessionId)
      .first<Record<string, unknown>>(),
    db.prepare(`SELECT completion_status,final_submit_mode,server_completed_at,
      sequence_no FROM completion_records WHERE session_id=?`).bind(sessionId)
      .first<Record<string, unknown>>(),
    db.prepare(`SELECT phase,instrument_version,item_count,server_submitted_at,
      sequence_no FROM questionnaire_submissions WHERE session_id=?
      ORDER BY sequence_no,submission_id`).bind(sessionId).all<Record<string, unknown>>(),
  ])
  return {
    inputSchemaVersion: 'prepilot-failure-3',
    sessionId,
    scoringVersion: context.scoringVersion,
    benchmarkVersion: context.benchmarkVersion,
    normVersion: context.normVersion,
    reliabilityVersion: context.reliabilityVersion,
    failureCode,
    session,
    configuration,
    pointRule,
    scoringDefinition,
    benchmarkSet,
    benchmarkValues: benchmarkValues.results,
    benchmarkExpertScores: benchmarkExpertScores.results,
    normSet,
    normParameters: normParameters.results,
    reliabilityParameter,
    ratings: ratings.results,
    evidenceEvents: evidenceEvents.results,
    evidenceItems: evidenceItems.results,
    pointLedger: pointLedger.results,
    stageChoices: stageChoices.results,
    sunkCost,
    finalDecision,
    completion,
    questionnaires: questionnaires.results,
  }
}

async function recordFailedRun(
  db: D1Database,
  sessionId: string,
  context: VersionContext,
  error: ScoringInputError,
): Promise<EnsureResult> {
  const failureSource = await buildFailureFingerprintSource(
    db,
    sessionId,
    context,
    error.code,
  )
  const fingerprint = await fingerprintScoringInput(failureSource)
  const [boundVersions, scoringExists, benchmarkExists] = await Promise.all([
    db.prepare(`SELECT scoring_version,benchmark_version FROM sessions
      WHERE session_id=?`).bind(sessionId).first<{
        scoring_version: string
        benchmark_version: string
      }>(),
    db.prepare(`SELECT 1 AS present FROM scoring_definitions
      WHERE scoring_version=?`).bind(context.scoringVersion)
      .first<{ present: number }>(),
    db.prepare(`SELECT 1 AS present FROM benchmark_sets
      WHERE benchmark_version=?`).bind(context.benchmarkVersion)
      .first<{ present: number }>(),
  ])
  if (!boundVersions) throw new Error('The failed scoring session no longer exists.')
  // Requested versions remain in the failure fingerprint. A missing requested
  // scoring/benchmark version falls back to the session-bound FK, and Stage 8
  // parameter FKs stay NULL, so the failed run itself is always auditable.
  const storedContext: VersionContext = {
    scoringVersion: scoringExists ? context.scoringVersion : boundVersions.scoring_version,
    benchmarkVersion: benchmarkExists ? context.benchmarkVersion : boundVersions.benchmark_version,
    normVersion: null,
    reliabilityVersion: null,
  }
  const existing = await findExistingRun(db, sessionId, storedContext, fingerprint)
  if (existing) return existingProjection(existing)
  const runId = crypto.randomUUID()
  const now = new Date().toISOString()
  const keys = versionKeys(storedContext)
  try {
    await db.batch([
      db.prepare(`INSERT INTO scoring_runs (
        scoring_run_id,session_id,scoring_version,benchmark_version,norm_version,
        reliability_version,norm_key,reliability_key,source_fingerprint,run_status,
        is_pre_pilot,interpretation_status,rdi_status,missing_reasons_json,
        failure_code,failure_detail_safe,started_at,completed_at,is_current
      ) VALUES (?,?,?,?,?,?,?,?,?,'failed',1,'research_only','inputs_incomplete',
        json(?),?,?,?, ?,0)`).bind(
        runId,
        sessionId,
        storedContext.scoringVersion,
        storedContext.benchmarkVersion,
        storedContext.normVersion,
        storedContext.reliabilityVersion,
        keys.normKey,
        keys.reliabilityKey,
        fingerprint,
        JSON.stringify([error.code]),
        error.code,
        error.safeDetail,
        now,
        now,
      ),
      db.prepare('UPDATE sessions SET error_count=error_count+1 WHERE session_id=?')
        .bind(sessionId),
    ])
    return { runId, created: true, runStatus: 'failed' }
  } catch (databaseError) {
    const winner = await findExistingRun(db, sessionId, storedContext, fingerprint)
    if (winner) return existingProjection(winner)
    throw databaseError
  }
}

export async function ensurePrepilotScoringRun(
  db: D1Database,
  sessionId: string,
  options: ScoringOptions = {},
): Promise<EnsureResult> {
  const context = await loadVersionContext(db, sessionId, options)
  try {
    const snapshot = await buildPrepilotScoringSnapshot(db, sessionId, options)
    const sourceFingerprint = await fingerprintScoringInput(snapshot)
    const existing = await findExistingRun(db, sessionId, context, sourceFingerprint)
    if (existing) return existingProjection(existing)
    return await persistSuccessfulRun(
      db,
      snapshot,
      sourceFingerprint,
      calculateArtifacts(snapshot),
    )
  } catch (error) {
    const scoringError = error instanceof ScoringInputError
      ? error
      : new ScoringInputError(
          'DATABASE_READ_FAILED',
          'The prepilot scoring run could not be completed safely.',
        )
    return recordFailedRun(db, sessionId, context, scoringError)
  }
}

export async function recomputeCompletedSession(
  db: D1Database,
  sessionId: string,
  options: {
    scoringVersion: string
    benchmarkVersion: string
    normVersion?: string | null
    reliabilityVersion?: string | null
  },
) {
  if (!options.scoringVersion || !options.benchmarkVersion) {
    throw new Error('Explicit scoring and benchmark versions are required.')
  }
  return ensurePrepilotScoringRun(db, sessionId, options)
}

export async function recomputeCompletedSessions(
  db: D1Database,
  sessionIds: readonly string[],
  options: {
    scoringVersion: string
    benchmarkVersion: string
    normVersion?: string | null
    reliabilityVersion?: string | null
  },
) {
  const summary = { attempted: sessionIds.length, reused: 0, completed: 0, partial: 0, failed: 0 }
  for (const sessionId of sessionIds) {
    try {
      const result = await recomputeCompletedSession(db, sessionId, options)
      if (!result.created) summary.reused += 1
      if (result.runStatus === 'completed') summary.completed += 1
      if (result.runStatus === 'partial') summary.partial += 1
      if (result.runStatus === 'failed') summary.failed += 1
    } catch {
      summary.failed += 1
    }
  }
  return summary
}
