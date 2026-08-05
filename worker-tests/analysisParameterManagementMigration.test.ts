import { afterEach, describe, expect, it } from 'vitest'
import type { Miniflare } from 'miniflare'
import { createWorkerRuntime } from './runtime'

let runtime: Miniflare | undefined

afterEach(async () => { await runtime?.dispose(); runtime = undefined })

describe('0015 analysis parameter management migration', () => {
  it('advances the schema to 13 at the 0015 historical cutoff while preserving the 0014 expert benchmark contract', async () => {
    const created = await createWorkerRuntime({ throughMigration: '0015_analysis_parameter_management.sql' })
    runtime = created.runtime
    const version = await created.db.prepare("SELECT value FROM app_metadata WHERE key='schema_version'").first<{ value: string }>()
    expect(version?.value).toBe('13')
    const columns = await created.db.prepare("PRAGMA table_info(norm_sets)").all<{ name: string }>()
    expect(columns.results.map((column) => column.name)).toEqual(expect.arrayContaining(['source_type', 'write_token']))
  })
})
