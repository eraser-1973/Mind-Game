import { afterEach, describe, expect, it } from 'vitest'
import type { Miniflare } from 'miniflare'
import { createWorkerRuntime } from './runtime'

let runtime: Miniflare | undefined

afterEach(async () => {
  await runtime?.dispose()
  runtime = undefined
})

async function seedSession(db: D1Database, suffix = 'migration') {
  const now = '2026-08-01T00:00:00.000Z'
  const participantId = `participant-${suffix}`
  const sessionId = `session-${suffix}`
  await db.batch([
    db.prepare('INSERT INTO participants (participant_id, created_at) VALUES (?, ?)')
      .bind(participantId, now),
    db.prepare(`INSERT INTO participant_identity (
      participant_id, full_name, created_at, updated_at
    ) VALUES (?, ?, ?, ?)`)
      .bind(participantId, 'Migration Test', now, now),
    db.prepare(`INSERT INTO sessions (
      session_id, participant_id, creation_key, mode, config_set_id,
      task_version, material_version, point_rule_version, scoring_version,
      benchmark_version, candidate_display_order, initial_opened_candidate,
      completion_status, current_step, final_submit_mode, created_at,
      started_at, deadline_at
    ) VALUES (?, ?, ?, 'formal', 'config-2026-07-v1', 'task-1.0.0',
      'material-1.0.0', 'points-5-v1', 'RDI-2.0-prepilot',
      'benchmark-1.0.0', json(?), 'A', 'in_progress', 'playing', 'none',
      ?, ?, ?)`)
      .bind(
        sessionId,
        participantId,
        crypto.randomUUID(),
        '["A","B","C","D","E"]',
        now,
        now,
        '2026-08-01T00:15:00.000Z',
      ),
  ])
  return { participantId, sessionId, now }
}

async function seedGameRun(db: D1Database, sessionId: string, now: string) {
  await db.prepare(`INSERT INTO game_runs (
    session_id, start_event_id, current_stage, duration_sec,
    points_total, points_remaining, last_sequence_no,
    started_at, deadline_at, updated_at
  ) VALUES (?, ?, 'T1', 900, 5, 5, 0, ?, ?, ?)`)
    .bind(
      sessionId,
      crypto.randomUUID(),
      now,
      '2026-08-01T00:15:00.000Z',
      now,
    )
    .run()
}

describe('0004 formal game and T1 migration', () => {
  it('creates the four game tables, required indexes, and schema version 4', async () => {
    const created = await createWorkerRuntime({ throughMigration: '0004_formal_game_t1.sql' })
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

    expect(tables.results.map((row) => row.name)).toEqual(expect.arrayContaining([
      'game_runs',
      'stage_ratings',
      'stage_choices',
      'game_events',
    ]))
    expect(indexes.results.map((row) => row.name)).toEqual(expect.arrayContaining([
      'stage_ratings_session_stage_idx',
      'stage_ratings_session_candidate_idx',
      'stage_choices_session_stage_idx',
      'game_events_session_sequence_idx',
      'game_runs_deadline_idx',
    ]))
    expect(schemaVersion?.value).toBe('4')
  })

  it('enforces T1 empty evidence, ranges, sealing, and unique sequence numbers', async () => {
    const created = await createWorkerRuntime({ throughMigration: '0004_formal_game_t1.sql' })
    runtime = created.runtime
    const { sessionId, now } = await seedSession(created.db)
    await seedGameRun(created.db, sessionId, now)

    await expect(created.db.prepare(`INSERT INTO stage_ratings (
      rating_id, event_id, session_id, candidate_id, stage, rating_value,
      evidence_ids_seen, client_submitted_at, server_submitted_at, sequence_no
    ) VALUES (?, ?, ?, 'A', 'T1', 50, json('["evidence-a"]'), ?, ?, 1)`)
      .bind(crypto.randomUUID(), crypto.randomUUID(), sessionId, now, now)
      .run()).rejects.toThrow()

    const ratingId = crypto.randomUUID()
    await created.db.prepare(`INSERT INTO stage_ratings (
      rating_id, event_id, session_id, candidate_id, stage, rating_value,
      evidence_ids_seen, client_submitted_at, server_submitted_at, sequence_no
    ) VALUES (?, ?, ?, 'A', 'T1', 0, json('[]'), ?, ?, 1)`)
      .bind(ratingId, crypto.randomUUID(), sessionId, now, now)
      .run()

    await expect(created.db.prepare(
      'UPDATE stage_ratings SET rating_value = 100 WHERE rating_id = ?',
    ).bind(ratingId).run()).rejects.toThrow()
    await expect(created.db.prepare(`INSERT INTO stage_ratings (
      rating_id, event_id, session_id, candidate_id, stage, rating_value,
      evidence_ids_seen, client_submitted_at, server_submitted_at, sequence_no
    ) VALUES (?, ?, ?, 'A', 'T1', 90, json('[]'), ?, ?, 2)`)
      .bind(crypto.randomUUID(), crypto.randomUUID(), sessionId, now, now)
      .run()).rejects.toThrow()
    await expect(created.db.prepare(`INSERT INTO stage_ratings (
      rating_id, event_id, session_id, candidate_id, stage, rating_value,
      evidence_ids_seen, client_submitted_at, server_submitted_at, sequence_no
    ) VALUES (?, ?, ?, 'B', 'T1', 101, json('[]'), ?, ?, 2)`)
      .bind(crypto.randomUUID(), crypto.randomUUID(), sessionId, now, now)
      .run()).rejects.toThrow()
  })

  it('enforces one sealed stage choice and one server sequence per session', async () => {
    const created = await createWorkerRuntime({ throughMigration: '0004_formal_game_t1.sql' })
    runtime = created.runtime
    const { sessionId, now } = await seedSession(created.db, 'choice')
    await seedGameRun(created.db, sessionId, now)
    const choiceId = crypto.randomUUID()
    await created.db.prepare(`INSERT INTO stage_choices (
      choice_id, event_id, session_id, stage, candidate_id, confidence,
      submit_mode, client_submitted_at, server_submitted_at, sequence_no
    ) VALUES (?, ?, ?, 'T1', 'B', 0, 'active', ?, ?, 1)`)
      .bind(choiceId, crypto.randomUUID(), sessionId, now, now)
      .run()
    await expect(created.db.prepare(
      "UPDATE stage_choices SET candidate_id = 'D' WHERE choice_id = ?",
    ).bind(choiceId).run()).rejects.toThrow()
    await expect(created.db.prepare(`INSERT INTO stage_choices (
      choice_id, event_id, session_id, stage, candidate_id, confidence,
      submit_mode, client_submitted_at, server_submitted_at, sequence_no
    ) VALUES (?, ?, ?, 'T1', 'D', 50, 'active', ?, ?, 2)`)
      .bind(crypto.randomUUID(), crypto.randomUUID(), sessionId, now, now)
      .run()).rejects.toThrow()

    await created.db.prepare(`INSERT INTO game_events (
      event_id, session_id, event_type, candidate_id, stage,
      client_sequence, server_sequence, client_at, server_at, payload_json
    ) VALUES (?, ?, 'game_start', NULL, 'T1', NULL, 1, ?, ?, json('{}'))`)
      .bind(crypto.randomUUID(), sessionId, now, now)
      .run()
    await expect(created.db.prepare(`INSERT INTO game_events (
      event_id, session_id, event_type, candidate_id, stage,
      client_sequence, server_sequence, client_at, server_at, payload_json
    ) VALUES (?, ?, 'rating_submit', 'A', 'T1', 1, 1, ?, ?, json('{}'))`)
      .bind(crypto.randomUUID(), sessionId, now, now)
      .run()).rejects.toThrow()
  })

  it('rejects invalid point balances and cascades session deletion', async () => {
    const created = await createWorkerRuntime({ throughMigration: '0004_formal_game_t1.sql' })
    runtime = created.runtime
    const { sessionId, participantId, now } = await seedSession(created.db, 'cascade')
    await expect(created.db.prepare(`INSERT INTO game_runs (
      session_id, start_event_id, current_stage, duration_sec,
      points_total, points_remaining, last_sequence_no,
      started_at, deadline_at, updated_at
    ) VALUES (?, ?, 'T1', 900, 5, 6, 0, ?, ?, ?)`)
      .bind(
        sessionId,
        crypto.randomUUID(),
        now,
        '2026-08-01T00:15:00.000Z',
        now,
      ).run()).rejects.toThrow()

    await seedGameRun(created.db, sessionId, now)
    await created.db.prepare('DELETE FROM participants WHERE participant_id = ?')
      .bind(participantId)
      .run()
    const count = await created.db.prepare(
      'SELECT COUNT(*) AS count FROM game_runs',
    ).first<{ count: number }>()
    expect(count?.count).toBe(0)
  })
})
