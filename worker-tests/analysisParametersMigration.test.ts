import { afterEach, describe, expect, it } from 'vitest'
import type { Miniflare } from 'miniflare'
import { createWorkerRuntime } from './runtime'

let runtime: Miniflare | undefined

afterEach(async () => {
  await runtime?.dispose()
  runtime = undefined
})

describe('0013 analysis parameters and recomputation migration', () => {
  it('advances the schema and creates immutable versioned analysis configuration tables', async () => {
    const created = await createWorkerRuntime()
    runtime = created.runtime

    const schema = await created.db.prepare(
      "SELECT value FROM app_metadata WHERE key = 'schema_version'",
    ).first<{ value: string }>()
    const tables = await created.db.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name",
    ).all<{ name: string }>()

    expect(schema?.value).toBe('12')
    expect(tables.results.map(({ name }) => name)).toEqual(expect.arrayContaining([
      'benchmark_candidate_policies',
      'analysis_validation_runs',
      'derived_metric_standard_scores',
      'scoring_recompute_jobs',
      'scoring_recompute_items',
    ]))
  })

  it('backfills only the five initial benchmark policies', async () => {
    const created = await createWorkerRuntime()
    runtime = created.runtime

    const policies = await created.db.prepare(`SELECT candidate_id, direction,
      include_in_core_eac FROM benchmark_candidate_policies
      WHERE benchmark_version = 'benchmark-1.0.0' ORDER BY candidate_id`).all<{
      candidate_id: string
      direction: number
      include_in_core_eac: number
    }>()

    expect(policies.results).toEqual([
      { candidate_id: 'A', direction: -1, include_in_core_eac: 1 },
      { candidate_id: 'B', direction: 1, include_in_core_eac: 1 },
      { candidate_id: 'C', direction: -1, include_in_core_eac: 1 },
      { candidate_id: 'D', direction: 1, include_in_core_eac: 1 },
      { candidate_id: 'E', direction: 0, include_in_core_eac: 0 },
    ])
  })
})
