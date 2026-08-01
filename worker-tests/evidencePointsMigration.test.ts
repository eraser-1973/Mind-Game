import { afterEach, describe, expect, it } from 'vitest'
import type { Miniflare } from 'miniflare'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { applyMigrationSource, createWorkerRuntime } from './runtime'

let runtime: Miniflare | undefined

afterEach(async () => {
  await runtime?.dispose()
  runtime = undefined
})

async function seedPlayingSession(db: D1Database) {
  const now = '2026-08-01T00:00:00.000Z'
  const participantId = crypto.randomUUID()
  const sessionId = crypto.randomUUID()
  await db.batch([
    db.prepare('INSERT INTO participants (participant_id, created_at) VALUES (?, ?)')
      .bind(participantId, now),
    db.prepare(`INSERT INTO participant_identity (
      participant_id, full_name, created_at, updated_at
    ) VALUES (?, 'Migration Test', ?, ?)`)
      .bind(participantId, now, now),
    db.prepare(`INSERT INTO sessions (
      session_id, participant_id, creation_key, mode, config_set_id,
      task_version, material_version, point_rule_version, scoring_version,
      benchmark_version, candidate_display_order, initial_opened_candidate,
      completion_status, current_step, final_submit_mode, created_at,
      started_at, deadline_at
    ) VALUES (?, ?, ?, 'formal', 'config-2026-07-v1', 'task-1.0.0',
      'material-1.0.0', 'points-5-v1', 'RDI-2.0-prepilot',
      'benchmark-1.0.0', json('["A","B","C","D","E"]'), 'A',
      'in_progress', 'playing', 'none', ?, ?, '2026-08-01T00:15:00.000Z')`)
      .bind(sessionId, participantId, crypto.randomUUID(), now, now),
    db.prepare(`INSERT INTO game_runs (
      session_id, start_event_id, current_stage, duration_sec,
      points_total, points_remaining, last_sequence_no,
      started_at, deadline_at, updated_at
    ) VALUES (?, ?, 'T1_COMPLETE', 900, 5, 5, 7, ?,
      '2026-08-01T00:15:00.000Z', ?)`)
      .bind(sessionId, crypto.randomUUID(), now, now),
  ])
  return { sessionId, now }
}

describe('0005 evidence, points, T2, and T3 migration', () => {
  it('creates the Stage 5 tables, indexes, published rule, and schema version 5', async () => {
    const created = await createWorkerRuntime({ throughMigration: '0005_evidence_points_t2_t3.sql' })
    runtime = created.runtime
    const tables = await created.db.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name",
    ).all<{ name: string }>()
    const indexes = await created.db.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'index' ORDER BY name",
    ).all<{ name: string }>()
    const schemaVersion = await created.db.prepare(
      "SELECT value FROM app_metadata WHERE key = 'schema_version'",
    ).first<{ value: string }>()
    const rule = await created.db.prepare(
      "SELECT * FROM point_rules WHERE point_rule_version = 'points-5-v1'",
    ).first<Record<string, unknown>>()

    expect(tables.results.map(({ name }) => name)).toEqual(expect.arrayContaining([
      'point_rules',
      'candidate_evidence_items',
      'evidence_events',
      'evidence_event_items',
      'point_ledger',
    ]))
    expect(indexes.results.map(({ name }) => name)).toEqual(expect.arrayContaining([
      'candidate_evidence_lookup_idx',
      'evidence_events_session_sequence_idx',
      'evidence_events_session_candidate_idx',
      'point_ledger_session_sequence_idx',
      'point_ledger_session_created_idx',
    ]))
    expect(schemaVersion?.value).toBe('5')
    expect(rule).toMatchObject({
      total_points: 5,
      shallow_cost: 1,
      deep_cost: 3,
      status: 'published',
    })
  })

  it('seeds the exact five-candidate evidence shape for material-1.0.0', async () => {
    const created = await createWorkerRuntime({ throughMigration: '0005_evidence_points_t2_t3.sql' })
    runtime = created.runtime
    const rows = await created.db.prepare(`SELECT candidate_id, evidence_level,
      COUNT(*) AS count FROM candidate_evidence_items
      WHERE material_version = 'material-1.0.0'
      GROUP BY candidate_id, evidence_level
      ORDER BY candidate_id, evidence_level`).all<{
        candidate_id: string
        evidence_level: string
        count: number
      }>()
    const evidenceRows = await created.db.prepare(`SELECT evidence_id,
      candidate_id, evidence_level, item_order, title, content, polarity
      FROM candidate_evidence_items WHERE material_version = 'material-1.0.0'
      ORDER BY candidate_id, evidence_level DESC, item_order`).all<{
        evidence_id: string
        candidate_id: string
        evidence_level: string
        item_order: number
        title: string
        content: string
        polarity: string
      }>()
    const candidateSource = await readFile(fileURLToPath(
      new URL('../src/data/candidates.ts', import.meta.url),
    ), 'utf8')
    const matches = [...candidateSource.matchAll(
      /evidence\('([^']+)', '([^']+)', '([^']+)', '(positive|negative)'\)/g,
    )]
    const orderByBundle = new Map<string, number>()
    const expected = matches.map(([, id, title, content, polarity]) => {
      const candidateId = id.slice(0, 1)
      const evidenceLevel = id.includes('-t2-') ? 'shallow' : 'deep'
      const key = `${candidateId}:${evidenceLevel}`
      const itemOrder = (orderByBundle.get(key) ?? 0) + 1
      orderByBundle.set(key, itemOrder)
      return {
        evidence_id: id,
        candidate_id: candidateId,
        evidence_level: evidenceLevel,
        item_order: itemOrder,
        title,
        content,
        polarity,
      }
    }).sort((left, right) =>
      left.candidate_id.localeCompare(right.candidate_id) ||
      right.evidence_level.localeCompare(left.evidence_level) ||
      left.item_order - right.item_order)

    expect(rows.results).toHaveLength(10)
    expect(rows.results.every(({ count }) => count === 2)).toBe(true)
    expect(evidenceRows.results).toHaveLength(20)
    expect(new Set(evidenceRows.results.map(({ evidence_id }) => evidence_id)).size).toBe(20)
    expect(evidenceRows.results.map(({ evidence_id }) => evidence_id)).toEqual(expect.arrayContaining([
      'A-t2-1', 'A-t2-2', 'A-t3-1', 'A-t3-2',
      'B-t2-1', 'B-t2-2', 'B-t3-1', 'B-t3-2',
      'C-t2-1', 'C-t2-2', 'C-t3-1', 'C-t3-2',
      'D-t2-1', 'D-t2-2', 'D-t3-1', 'D-t3-2',
      'E-t2-1', 'E-t2-2', 'E-t3-1', 'E-t3-2',
    ]))
    expect(evidenceRows.results).toEqual(expected)
  })

  it('enforces evidence event balances, uniqueness, item foreign keys, and ledger arithmetic', async () => {
    const created = await createWorkerRuntime({ throughMigration: '0005_evidence_points_t2_t3.sql' })
    runtime = created.runtime
    const { sessionId, now } = await seedPlayingSession(created.db)
    const eventId = crypto.randomUUID()

    await expect(created.db.prepare(`INSERT INTO evidence_events (
      event_id, session_id, candidate_id, evidence_level, rating_stage,
      material_version, point_rule_version, evidence_ids_json, points_before,
      points_cost, points_after, contains_key_risk, client_at, server_at, sequence_no
    ) VALUES (?, ?, 'A', 'shallow', 'T2', 'material-1.0.0', 'points-5-v1',
      json('["A-t2-1","A-t2-2"]'), 5, 1, 5, 0, ?, ?, 8)`)
      .bind(eventId, sessionId, now, now).run()).rejects.toThrow()

    await created.db.prepare(`INSERT INTO evidence_events (
      event_id, session_id, candidate_id, evidence_level, rating_stage,
      material_version, point_rule_version, evidence_ids_json, points_before,
      points_cost, points_after, contains_key_risk, client_at, server_at, sequence_no
    ) VALUES (?, ?, 'A', 'shallow', 'T2', 'material-1.0.0', 'points-5-v1',
      json('["A-t2-1","A-t2-2"]'), 5, 1, 4, 0, ?, ?, 8)`)
      .bind(eventId, sessionId, now, now).run()

    await created.db.prepare(`INSERT INTO evidence_event_items (
      event_id, material_version, evidence_id, item_order
    ) VALUES (?, 'material-1.0.0', 'A-t2-1', 1)`)
      .bind(eventId).run()
    await expect(created.db.prepare(`INSERT INTO evidence_event_items (
      event_id, material_version, evidence_id, item_order
    ) VALUES (?, 'material-1.0.0', 'missing', 2)`)
      .bind(eventId).run()).rejects.toThrow()

    await created.db.prepare(`INSERT INTO point_ledger (
      ledger_id, session_id, event_id, reason, candidate_id, evidence_level,
      points_before, points_delta, points_after, sequence_no, created_at
    ) VALUES (?, ?, ?, 'evidence_unlock', 'A', 'shallow', 5, -1, 4, 8, ?)`)
      .bind(crypto.randomUUID(), sessionId, eventId, now).run()
    await expect(created.db.prepare(`INSERT INTO point_ledger (
      ledger_id, session_id, event_id, reason, candidate_id, evidence_level,
      points_before, points_delta, points_after, sequence_no, created_at
    ) VALUES (?, ?, ?, 'evidence_unlock', 'B', 'shallow', 4, -1, 4, 9, ?)`)
      .bind(crypto.randomUUID(), sessionId, crypto.randomUUID(), now).run()).rejects.toThrow()

    await expect(created.db.prepare(`INSERT INTO evidence_events (
      event_id, session_id, candidate_id, evidence_level, rating_stage,
      material_version, point_rule_version, evidence_ids_json, points_before,
      points_cost, points_after, contains_key_risk, client_at, server_at, sequence_no
    ) VALUES (?, ?, 'A', 'shallow', 'T2', 'material-1.0.0', 'points-5-v1',
      json('["A-t2-1","A-t2-2"]'), 4, 1, 3, 0, ?, ?, 9)`)
      .bind(crypto.randomUUID(), sessionId, now, now).run()).rejects.toThrow()
  })

  it('cascades Stage 5 session facts while retaining versioned configuration', async () => {
    const created = await createWorkerRuntime({ throughMigration: '0005_evidence_points_t2_t3.sql' })
    runtime = created.runtime
    const { sessionId, now } = await seedPlayingSession(created.db)
    const eventId = crypto.randomUUID()
    await created.db.prepare(`INSERT INTO evidence_events (
      event_id, session_id, candidate_id, evidence_level, rating_stage,
      material_version, point_rule_version, evidence_ids_json, points_before,
      points_cost, points_after, contains_key_risk, client_at, server_at, sequence_no
    ) VALUES (?, ?, 'B', 'shallow', 'T2', 'material-1.0.0', 'points-5-v1',
      json('["B-t2-1","B-t2-2"]'), 5, 1, 4, 0, ?, ?, 8)`)
      .bind(eventId, sessionId, now, now).run()
    await created.db.prepare(`INSERT INTO evidence_event_items (
      event_id, material_version, evidence_id, item_order
    ) VALUES (?, 'material-1.0.0', 'B-t2-1', 1)`)
      .bind(eventId).run()
    await created.db.prepare(`INSERT INTO point_ledger (
      ledger_id, session_id, event_id, reason, candidate_id, evidence_level,
      points_before, points_delta, points_after, sequence_no, created_at
    ) VALUES (?, ?, ?, 'evidence_unlock', 'B', 'shallow', 5, -1, 4, 8, ?)`)
      .bind(crypto.randomUUID(), sessionId, eventId, now).run()

    await created.db.prepare('DELETE FROM sessions WHERE session_id = ?').bind(sessionId).run()
    for (const table of ['evidence_events', 'evidence_event_items', 'point_ledger']) {
      const row = await created.db.prepare(`SELECT COUNT(*) AS count FROM ${table}`)
        .first<{ count: number }>()
      expect(row?.count).toBe(0)
    }
    const catalog = await created.db.prepare(
      "SELECT COUNT(*) AS count FROM candidate_evidence_items WHERE material_version = 'material-1.0.0'",
    ).first<{ count: number }>()
    expect(catalog?.count).toBe(20)
  })

  it('preserves Stage 1-4 run, T1 rating, T1 choice, and event data', async () => {
    const created = await createWorkerRuntime({ throughMigration: '0004_formal_game_t1.sql' })
    runtime = created.runtime
    const { sessionId, now } = await seedPlayingSession(created.db)
    const ratingEventId = crypto.randomUUID()
    const choiceEventId = crypto.randomUUID()
    await created.db.batch([
      created.db.prepare(`INSERT INTO game_events (
        event_id, session_id, event_type, candidate_id, stage, client_sequence,
        server_sequence, client_at, server_at, payload_json
      ) VALUES (?, ?, 'rating_submit', 'A', 'T1', 5, 6, ?, ?, json('{}'))`)
        .bind(ratingEventId, sessionId, now, now),
      created.db.prepare(`INSERT INTO game_events (
        event_id, session_id, event_type, candidate_id, stage, client_sequence,
        server_sequence, client_at, server_at, payload_json
      ) VALUES (?, ?, 'stage_choice_submit', 'A', 'T1', 6, 7, ?, ?, json('{}'))`)
        .bind(choiceEventId, sessionId, now, now),
      created.db.prepare(`INSERT INTO stage_ratings (
        rating_id, event_id, session_id, candidate_id, stage, rating_value,
        evidence_ids_seen, client_submitted_at, server_submitted_at, sequence_no
      ) VALUES (?, ?, ?, 'A', 'T1', 72, json('[]'), ?, ?, 6)`)
        .bind(crypto.randomUUID(), ratingEventId, sessionId, now, now),
      created.db.prepare(`INSERT INTO stage_choices (
        choice_id, event_id, session_id, stage, candidate_id, confidence,
        submit_mode, client_submitted_at, server_submitted_at, sequence_no
      ) VALUES (?, ?, ?, 'T1', 'A', 64, 'active', ?, ?, 7)`)
        .bind(crypto.randomUUID(), choiceEventId, sessionId, now, now),
    ])

    const migration = await readFile(fileURLToPath(
      new URL('../migrations/0005_evidence_points_t2_t3.sql', import.meta.url),
    ), 'utf8')
    await applyMigrationSource(created.db, migration)

    const run = await created.db.prepare(`SELECT current_stage, points_remaining,
      started_at, deadline_at FROM game_runs WHERE session_id = ?`)
      .bind(sessionId).first<Record<string, unknown>>()
    const rating = await created.db.prepare(`SELECT rating_value, evidence_ids_seen
      FROM stage_ratings WHERE event_id = ?`).bind(ratingEventId).first<Record<string, unknown>>()
    const choice = await created.db.prepare(`SELECT candidate_id, confidence
      FROM stage_choices WHERE event_id = ?`).bind(choiceEventId).first<Record<string, unknown>>()
    const eventCount = await created.db.prepare(
      'SELECT COUNT(*) AS count FROM game_events WHERE session_id = ?',
    ).bind(sessionId).first<{ count: number }>()

    expect(run).toMatchObject({
      current_stage: 'T1_COMPLETE', points_remaining: 5,
      started_at: now, deadline_at: '2026-08-01T00:15:00.000Z',
    })
    expect(rating).toMatchObject({ rating_value: 72, evidence_ids_seen: '[]' })
    expect(choice).toMatchObject({ candidate_id: 'A', confidence: 64 })
    expect(eventCount?.count).toBe(2)
  })
})
