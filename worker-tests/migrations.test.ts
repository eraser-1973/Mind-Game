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
    const created = await createWorkerRuntime({
      throughMigration: '0001_infrastructure.sql',
    })
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
    const created = await createWorkerRuntime({
      throughMigration: '0001_infrastructure.sql',
    })
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

describe('0002 participant and formal session migration', () => {
  it('creates the five Stage 2 tables and advances the schema version', async () => {
    const created = await createWorkerRuntime()
    runtime = created.runtime
    const tables = await created.db.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name",
    ).all<{ name: string }>()
    const schemaVersion = await created.db.prepare(
      "SELECT value FROM app_metadata WHERE key = 'schema_version'",
    ).first<{ value: string }>()

    expect(tables.results.map((row) => row.name)).toEqual(
      expect.arrayContaining([
        'configuration_sets',
        'participants',
        'participant_identity',
        'sessions',
        'session_credentials',
      ]),
    )
    expect(schemaVersion?.value).toBe('2')
  })

  it('seeds exactly one active published version set', async () => {
    const created = await createWorkerRuntime()
    runtime = created.runtime
    const active = await created.db.prepare(
      `SELECT * FROM configuration_sets
       WHERE is_active = 1
       ORDER BY config_set_id`,
    ).all<Record<string, unknown>>()

    expect(active.results).toEqual([
      expect.objectContaining({
        config_set_id: 'config-2026-07-v1',
        task_version: 'task-1.0.0',
        material_version: 'material-1.0.0',
        point_rule_version: 'points-5-v1',
        scoring_version: 'RDI-2.0-prepilot',
        benchmark_version: 'benchmark-1.0.0',
        norm_version: null,
        status: 'published',
        is_active: 1,
      }),
    ])

    await expect(
      created.db.prepare(
        `INSERT INTO configuration_sets (
          config_set_id, task_version, material_version, point_rule_version,
          scoring_version, benchmark_version, status, is_active,
          created_at, published_at
        ) VALUES (?, ?, ?, ?, ?, ?, 'published', 1, ?, ?)`,
      ).bind(
        'config-conflict',
        'task-test',
        'material-test',
        'points-test',
        'scoring-test',
        'benchmark-test',
        '2026-07-31T00:00:00.000Z',
        '2026-07-31T00:00:00.000Z',
      ).run(),
    ).rejects.toThrow()
  })

  it('enforces formal sessions and at least one identity value', async () => {
    const created = await createWorkerRuntime()
    runtime = created.runtime
    await created.db.prepare(
      'INSERT INTO participants (participant_id, created_at) VALUES (?, ?)',
    ).bind('participant-test', '2026-07-31T00:00:00.000Z').run()

    await expect(
      created.db.prepare(
        `INSERT INTO participant_identity (
          participant_id, full_name, student_id, student_id_normalized,
          phone, phone_normalized, created_at, updated_at
        ) VALUES (?, NULL, NULL, NULL, NULL, NULL, ?, ?)`,
      ).bind(
        'participant-test',
        '2026-07-31T00:00:00.000Z',
        '2026-07-31T00:00:00.000Z',
      ).run(),
    ).rejects.toThrow()

    await expect(
      created.db.prepare(
        `INSERT INTO sessions (
          session_id, participant_id, creation_key, mode, config_set_id,
          task_version, material_version, point_rule_version, scoring_version,
          benchmark_version, candidate_display_order, initial_opened_candidate,
          completion_status, current_step, final_submit_mode, created_at
        ) VALUES (?, ?, ?, 'quick', ?, ?, ?, ?, ?, ?, json(?), ?, ?, ?, ?, ?)`,
      ).bind(
        'session-test',
        'participant-test',
        '00000000-0000-4000-8000-000000000001',
        'config-2026-07-v1',
        'task-1.0.0',
        'material-1.0.0',
        'points-5-v1',
        'RDI-2.0-prepilot',
        'benchmark-1.0.0',
        '["A","B","C","D","E"]',
        'A',
        'in_progress',
        'demographics',
        'none',
        '2026-07-31T00:00:00.000Z',
      ).run(),
    ).rejects.toThrow()
  })

  it('cascades participant deletion through identity, session, and credential', async () => {
    const created = await createWorkerRuntime()
    runtime = created.runtime
    const now = '2026-07-31T00:00:00.000Z'
    await created.db.batch([
      created.db.prepare(
        'INSERT INTO participants (participant_id, created_at) VALUES (?, ?)',
      ).bind('participant-cascade', now),
      created.db.prepare(
        `INSERT INTO participant_identity (
          participant_id, full_name, created_at, updated_at
        ) VALUES (?, ?, ?, ?)`,
      ).bind('participant-cascade', 'Test Name', now, now),
      created.db.prepare(
        `INSERT INTO sessions (
          session_id, participant_id, creation_key, mode, config_set_id,
          task_version, material_version, point_rule_version, scoring_version,
          benchmark_version, candidate_display_order, initial_opened_candidate,
          completion_status, current_step, final_submit_mode, created_at
        ) VALUES (?, ?, ?, 'formal', ?, ?, ?, ?, ?, ?, json(?), ?, ?, ?, ?, ?)`,
      ).bind(
        'session-cascade',
        'participant-cascade',
        '00000000-0000-4000-8000-000000000002',
        'config-2026-07-v1',
        'task-1.0.0',
        'material-1.0.0',
        'points-5-v1',
        'RDI-2.0-prepilot',
        'benchmark-1.0.0',
        '["A","B","C","D","E"]',
        'A',
        'in_progress',
        'demographics',
        'none',
        now,
      ),
      created.db.prepare(
        `INSERT INTO session_credentials (
          session_id, token_hash, created_at, rotated_at
        ) VALUES (?, ?, ?, ?)`,
      ).bind('session-cascade', 'a'.repeat(64), now, now),
    ])

    await created.db.prepare(
      'DELETE FROM participants WHERE participant_id = ?',
    ).bind('participant-cascade').run()

    for (const table of [
      'participant_identity',
      'sessions',
      'session_credentials',
    ]) {
      const count = await created.db.prepare(
        `SELECT COUNT(*) AS count FROM ${table}`,
      ).first<{ count: number }>()
      expect(count?.count).toBe(0)
    }
  })
})
