import { afterEach, describe, expect, it } from 'vitest'
import type { Miniflare } from 'miniflare'
import { createWorkerRuntime } from './runtime'

let runtime: Miniflare | undefined

afterEach(async () => {
  await runtime?.dispose()
  runtime = undefined
})

describe('0001 infrastructure migration', () => {
  it('creates only the application metadata needed by the foundation', async () => {
    const created = await createWorkerRuntime()
    runtime = created.runtime
    const tables = await created.db.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name",
    ).all<{ name: string }>()

    const names = tables.results.map((row) => row.name)
    expect(names).toContain('app_metadata')
    expect(names).not.toContain('sessions')
    expect(names).not.toContain('participant_identity')
  })

  it('seeds the schema and service metadata with UTC timestamps', async () => {
    const created = await createWorkerRuntime()
    runtime = created.runtime
    const metadata = await created.db.prepare(
      'SELECT key, value, updated_at FROM app_metadata ORDER BY key',
    ).all<{ key: string; value: string; updated_at: string }>()

    expect(metadata.results).toEqual([
      expect.objectContaining({ key: 'schema_version', value: '1' }),
      expect.objectContaining({ key: 'service_name', value: 'mind-game-api' }),
    ])

    for (const row of metadata.results) {
      expect(row.updated_at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/)
      expect(Number.isNaN(Date.parse(row.updated_at))).toBe(false)
    }
  })
})
