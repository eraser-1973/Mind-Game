import { afterEach, describe, expect, it } from 'vitest'
import type { Miniflare } from 'miniflare'
import { createWorkerRuntime } from './runtime'

let runtime: Miniflare | undefined

afterEach(async () => {
  await runtime?.dispose()
  runtime = undefined
})

const stage8Tables = [
  'benchmark_candidate_values',
  'benchmark_expert_scores',
  'benchmark_sets',
  'candidate_metric_components',
  'derived_metric_values',
  'norm_metric_parameters',
  'norm_sets',
  'reliability_parameters',
  'scoring_definitions',
  'scoring_input_snapshots',
  'scoring_runs',
]

describe('0008 prepilot derived metrics migration', () => {
  it('creates all Stage 8 tables, indexes, and schema version 8', async () => {
    const created = await createWorkerRuntime()
    runtime = created.runtime

    const schema = await created.db.prepare(
      "SELECT value FROM app_metadata WHERE key='schema_version'",
    ).first<{ value: string }>()
    const tables = await created.db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name",
    ).all<{ name: string }>()
    const indexes = await created.db.prepare(
      "SELECT name FROM sqlite_master WHERE type='index' ORDER BY name",
    ).all<{ name: string }>()

    expect(schema?.value).toBe('8')
    expect(tables.results.map(({ name }) => name)).toEqual(
      expect.arrayContaining(stage8Tables),
    )
    expect(indexes.results.map(({ name }) => name)).toEqual(expect.arrayContaining([
      'scoring_runs_session_idx',
      'scoring_runs_versions_idx',
      'scoring_runs_status_idx',
      'scoring_runs_one_current_idx',
      'derived_metric_values_run_idx',
      'derived_metric_values_code_idx',
      'candidate_metric_components_run_idx',
      'benchmark_candidate_values_version_idx',
      'norm_metric_parameters_version_idx',
    ]))
  })

  it('publishes the disabled prepilot definition and provisional benchmark', async () => {
    const created = await createWorkerRuntime()
    runtime = created.runtime

    const definition = await created.db.prepare(`SELECT display_name,formula_family,
      status,is_pre_pilot,total_rdi_enabled,level_enabled,formula_config_json,
      weights_json,time_unit FROM scoring_definitions WHERE scoring_version=?`)
      .bind('RDI-2.0-prepilot').first<{
        display_name: string
        formula_family: string
        status: string
        is_pre_pilot: number
        total_rdi_enabled: number
        level_enabled: number
        formula_config_json: string
        weights_json: string
        time_unit: string
      }>()
    const benchmark = await created.db.prepare(`SELECT source_type,status,
      is_provisional,expert_count,rated_at,validated_at,notes FROM benchmark_sets
      WHERE benchmark_version=?`).bind('benchmark-1.0.0').first<{
        source_type: string
        status: string
        is_provisional: number
        expert_count: number
        rated_at: string | null
        validated_at: string | null
        notes: string
      }>()

    expect(definition).toMatchObject({
      formula_family: 'RDI-2.0',
      status: 'published',
      is_pre_pilot: 1,
      total_rdi_enabled: 0,
      level_enabled: 0,
      time_unit: 'second',
    })
    expect(JSON.parse(definition?.weights_json ?? '{}')).toEqual({
      RES: 0.35,
      EACS: 0.35,
      DDS: 0.15,
      GDS: 0.1,
      SLS: 0.05,
    })
    expect(JSON.parse(definition?.formula_config_json ?? '{}')).toMatchObject({
      eacCandidateIds: ['A', 'B', 'C', 'D'],
      primaryRiskAnchor: 'earliest_server_key_risk',
      timeUnit: 'second',
    })
    expect(benchmark).toMatchObject({
      source_type: 'current_app_baseline',
      status: 'published',
      is_provisional: 1,
      expert_count: 0,
      rated_at: null,
      validated_at: null,
    })
    expect(benchmark?.notes).toContain('baselineFitScore')
    expect(benchmark?.notes).toContain('不代表已完成专家评定')
  })

  it('seeds exact A-E values and directions without invented uncertainty', async () => {
    const created = await createWorkerRuntime()
    runtime = created.runtime
    const values = await created.db.prepare(`SELECT candidate_id,benchmark_value,
      benchmark_sd,direction,include_in_core_eac,source_note
      FROM benchmark_candidate_values WHERE benchmark_version=? ORDER BY candidate_id`)
      .bind('benchmark-1.0.0').all<{
        candidate_id: string
        benchmark_value: number
        benchmark_sd: number | null
        direction: number
        include_in_core_eac: number
        source_note: string
      }>()

    expect(values.results).toEqual([
      expect.objectContaining({ candidate_id: 'A', benchmark_value: 51, benchmark_sd: null, direction: -1, include_in_core_eac: 1 }),
      expect.objectContaining({ candidate_id: 'B', benchmark_value: 86, benchmark_sd: null, direction: 1, include_in_core_eac: 1 }),
      expect.objectContaining({ candidate_id: 'C', benchmark_value: 60, benchmark_sd: null, direction: -1, include_in_core_eac: 1 }),
      expect.objectContaining({ candidate_id: 'D', benchmark_value: 83, benchmark_sd: null, direction: 1, include_in_core_eac: 1 }),
      expect.objectContaining({ candidate_id: 'E', benchmark_value: 70, benchmark_sd: null, direction: 0, include_in_core_eac: 0 }),
    ])
    expect(values.results.every(({ source_note }) => source_note.includes('provisional')))
      .toBe(true)
  })

  it('does not seed expert, norm metric, or reliability values', async () => {
    const created = await createWorkerRuntime()
    runtime = created.runtime

    const counts = await created.db.prepare(`SELECT
      (SELECT COUNT(*) FROM benchmark_expert_scores) AS experts,
      (SELECT COUNT(*) FROM norm_metric_parameters) AS norms,
      (SELECT COUNT(*) FROM reliability_parameters) AS reliability`)
      .first<{ experts: number; norms: number; reliability: number }>()
    const draft = await created.db.prepare(`SELECT scoring_version,status,sample_size
      FROM norm_sets WHERE norm_version='norm-prepilot-draft'`)
      .first<{ scoring_version: string; status: string; sample_size: number }>()

    expect(counts).toEqual({ experts: 0, norms: 0, reliability: 0 })
    expect(draft).toEqual({
      scoring_version: 'RDI-2.0-prepilot',
      status: 'draft',
      sample_size: 0,
    })
    const active = await created.db.prepare(
      "SELECT norm_version FROM configuration_sets WHERE is_active=1",
    ).first<{ norm_version: string | null }>()
    expect(active?.norm_version).toBeNull()
  })

  it('enforces run uniqueness, one current run, JSON, and append-only facts', async () => {
    const created = await createWorkerRuntime()
    runtime = created.runtime
    const participantId = crypto.randomUUID()
    const sessionId = crypto.randomUUID()
    const runId = crypto.randomUUID()
    const at = '2026-08-02T00:00:00.000Z'
    await created.db.batch([
      created.db.prepare('INSERT INTO participants (participant_id,created_at) VALUES (?,?)')
        .bind(participantId, at),
      created.db.prepare(`INSERT INTO sessions (
        session_id,participant_id,creation_key,mode,config_set_id,task_version,
        material_version,point_rule_version,scoring_version,benchmark_version,
        candidate_display_order,initial_opened_candidate,completion_status,
        current_step,final_submit_mode,created_at,sunk_cost_rule_version
      ) VALUES (?,?,?,'formal','config-2026-07-v1','task-1.0.0','material-1.0.0',
        'points-5-v1','RDI-2.0-prepilot','benchmark-1.0.0',json('["A","B","C","D","E"]'),
        'A','completed','completed','active',?,'sunk-1.0.0')`)
        .bind(sessionId, participantId, crypto.randomUUID(), at),
      created.db.prepare(`INSERT INTO scoring_runs (
        scoring_run_id,session_id,scoring_version,benchmark_version,norm_version,
        reliability_version,norm_key,reliability_key,source_fingerprint,run_status,
        is_pre_pilot,interpretation_status,rdi_status,missing_reasons_json,
        started_at,completed_at,is_current
      ) VALUES (?,?,?,'benchmark-1.0.0',NULL,NULL,'none','none',?,'partial',1,
        'research_only','norms_unavailable',json('[]'),?,?,1)`)
        .bind(runId, sessionId, 'RDI-2.0-prepilot', 'a'.repeat(64), at, at),
    ])

    await expect(created.db.prepare(`INSERT INTO scoring_runs (
      scoring_run_id,session_id,scoring_version,benchmark_version,norm_key,
      reliability_key,source_fingerprint,run_status,is_pre_pilot,
      interpretation_status,rdi_status,missing_reasons_json,started_at,is_current
    ) VALUES (?,?,?,'benchmark-1.0.0','none','none',?,'pending',1,
      'research_only','not_calculated',json('[]'),?,1)`)
      .bind(crypto.randomUUID(), sessionId, 'RDI-2.0-prepilot', 'b'.repeat(64), at)
      .run()).rejects.toThrow()
    await expect(created.db.prepare(
      "UPDATE scoring_runs SET run_status='completed' WHERE scoring_run_id=?",
    ).bind(runId).run()).rejects.toThrow()
    await created.db.prepare(
      'UPDATE scoring_runs SET is_current=0 WHERE scoring_run_id=?',
    ).bind(runId).run()
    await expect(created.db.prepare(`INSERT INTO scoring_input_snapshots (
      scoring_run_id,session_id,input_json,input_schema_version,captured_at
    ) VALUES (?,?,?,'prepilot-input-1',?)`)
      .bind(runId, sessionId, 'not-json', at).run()).rejects.toThrow()
  })
})
