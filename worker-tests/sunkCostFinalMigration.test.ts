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

const migrationPath = fileURLToPath(
  new URL('../migrations/0006_sunk_cost_final_decision.sql', import.meta.url),
)

describe('0006 sunk cost and final decision migration', () => {
  it('creates versioned rules, event tables, indexes, and schema version 6', async () => {
    const created = await createWorkerRuntime()
    runtime = created.runtime
    const tables = await created.db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name",
    ).all<{ name: string }>()
    const indexes = await created.db.prepare(
      "SELECT name FROM sqlite_master WHERE type='index' ORDER BY name",
    ).all<{ name: string }>()
    const schema = await created.db.prepare(
      "SELECT value FROM app_metadata WHERE key='schema_version'",
    ).first<{ value: string }>()
    const rule = await created.db.prepare(
      "SELECT * FROM sunk_cost_rules WHERE sunk_cost_rule_version='sunk-1.0.0'",
    ).first<Record<string, unknown>>()

    expect(schema?.value).toBe('6')
    expect(tables.results.map(({ name }) => name)).toEqual(expect.arrayContaining([
      'sunk_cost_rules', 'sunk_cost_events', 'final_decisions',
    ]))
    expect(indexes.results.map(({ name }) => name)).toEqual(expect.arrayContaining([
      'sunk_cost_events_session_idx', 'sunk_cost_events_target_candidate_idx',
      'final_decisions_session_idx', 'final_decisions_server_submitted_idx',
      'final_decisions_submit_mode_idx',
    ]))
    expect(rule).toMatchObject({
      trigger_remaining_sec: 300,
      minimum_candidate_investment: 2,
      requires_key_risk: 1,
      status: 'published',
    })
  })

  it('binds configuration sets and existing sessions to sunk-1.0.0', async () => {
    const created = await createWorkerRuntime({ throughMigration: '0005_evidence_points_t2_t3.sql' })
    runtime = created.runtime
    const now = '2026-08-01T00:00:00.000Z'
    const participantId = crypto.randomUUID()
    const sessionId = crypto.randomUUID()
    await created.db.batch([
      created.db.prepare('INSERT INTO participants (participant_id, created_at) VALUES (?, ?)')
        .bind(participantId, now),
      created.db.prepare(`INSERT INTO participant_identity (
        participant_id, full_name, created_at, updated_at
      ) VALUES (?, 'Stage6 Migration', ?, ?)`).bind(participantId, now, now),
      created.db.prepare(`INSERT INTO sessions (
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
      created.db.prepare(`INSERT INTO game_runs (
        session_id, start_event_id, current_stage, duration_sec, points_total,
        points_remaining, last_sequence_no, started_at, deadline_at, updated_at
      ) VALUES (?, ?, 'T2', 900, 5, 4, 9, ?, '2026-08-01T00:15:00.000Z', ?)`)
        .bind(sessionId, crypto.randomUUID(), now, now),
    ])

    await applyMigrationSource(created.db, await readFile(migrationPath, 'utf8'))

    const config = await created.db.prepare(
      "SELECT sunk_cost_rule_version FROM configuration_sets WHERE config_set_id='config-2026-07-v1'",
    ).first<{ sunk_cost_rule_version: string }>()
    const session = await created.db.prepare(`SELECT sunk_cost_rule_version,
      started_at, deadline_at FROM sessions WHERE session_id=?`)
      .bind(sessionId).first<Record<string, unknown>>()
    const run = await created.db.prepare(`SELECT current_stage, points_remaining,
      last_sequence_no, finalized_at FROM game_runs WHERE session_id=?`)
      .bind(sessionId).first<Record<string, unknown>>()

    expect(config?.sunk_cost_rule_version).toBe('sunk-1.0.0')
    expect(session).toMatchObject({
      sunk_cost_rule_version: 'sunk-1.0.0',
      started_at: now,
      deadline_at: '2026-08-01T00:15:00.000Z',
    })
    expect(run).toMatchObject({
      current_stage: 'T2', points_remaining: 4, last_sequence_no: 9, finalized_at: null,
    })
  })

  it('enforces choices, final metadata, uniqueness, sealing, and cascading', async () => {
    const created = await createWorkerRuntime()
    runtime = created.runtime
    const now = '2026-08-01T00:10:00.000Z'
    const participantId = crypto.randomUUID()
    const sessionId = crypto.randomUUID()
    await created.db.batch([
      created.db.prepare('INSERT INTO participants (participant_id, created_at) VALUES (?, ?)')
        .bind(participantId, now),
      created.db.prepare(`INSERT INTO participant_identity (
        participant_id, full_name, created_at, updated_at
      ) VALUES (?, 'Stage6 Constraint', ?, ?)`).bind(participantId, now, now),
      created.db.prepare(`INSERT INTO sessions (
        session_id, participant_id, creation_key, mode, config_set_id,
        task_version, material_version, point_rule_version, sunk_cost_rule_version,
        scoring_version, benchmark_version, candidate_display_order,
        initial_opened_candidate, completion_status, current_step,
        final_submit_mode, created_at, started_at, deadline_at
      ) VALUES (?, ?, ?, 'formal', 'config-2026-07-v1', 'task-1.0.0',
        'material-1.0.0', 'points-5-v1', 'sunk-1.0.0', 'RDI-2.0-prepilot',
        'benchmark-1.0.0', json('["A","B","C","D","E"]'), 'A',
        'in_progress', 'playing', 'none', ?, ?, '2026-08-01T00:15:00.000Z')`)
        .bind(sessionId, participantId, crypto.randomUUID(), now, now),
    ])

    await expect(created.db.prepare(`INSERT INTO sunk_cost_events (
      sunk_event_id, session_id, trigger_rule_version, trigger_reason,
      risk_evidence_ids_seen, points_invested_before, choice,
      choice_status, created_at, updated_at
    ) VALUES (?, ?, 'sunk-1.0.0', 'eligible', json('[]'), 2,
      'invalid', 'answered', ?, ?)`).bind(crypto.randomUUID(), sessionId, now, now).run())
      .rejects.toThrow()

    const sunkEventId = crypto.randomUUID()
    await created.db.prepare(`INSERT INTO sunk_cost_events (
      sunk_event_id, session_id, target_candidate_id, trigger_rule_version,
      trigger_reason, risk_evidence_ids_seen, points_invested_before,
      points_remaining_at_show, shown_at, show_sequence_no, choice_status,
      created_at, updated_at
    ) VALUES (?, ?, 'A', 'sunk-1.0.0', 'eligible', json('["A-t2-1"]'),
      2, 3, ?, 10, 'pending', ?, ?)`).bind(sunkEventId, sessionId, now, now, now).run()

    await expect(created.db.prepare(`INSERT INTO final_decisions (
      final_decision_id, event_id, session_id, candidate_id, confidence,
      submit_mode, source_stage, selection_origin, auto_selected,
      client_submitted_at, server_submitted_at, sequence_no,
      remaining_sec_at_submit, points_remaining_at_submit, created_at
    ) VALUES (?, ?, ?, 'B', 101, 'active', 'T2', 'active_user', 0,
      ?, ?, 11, 10, 3, ?)`)
      .bind(crypto.randomUUID(), crypto.randomUUID(), sessionId, now, now, now).run())
      .rejects.toThrow()

    const finalId = crypto.randomUUID()
    await created.db.prepare(`INSERT INTO final_decisions (
      final_decision_id, event_id, session_id, candidate_id, confidence,
      submit_mode, source_stage, selection_origin, auto_selected,
      client_submitted_at, server_submitted_at, sequence_no,
      remaining_sec_at_submit, points_remaining_at_submit, sunk_cost_choice,
      created_at
    ) VALUES (?, ?, ?, 'B', 72, 'active', 'T2', 'active_user', 0,
      ?, ?, 11, 10, 3, 'continue', ?)`)
      .bind(finalId, crypto.randomUUID(), sessionId, now, now, now).run()
    await expect(created.db.prepare(
      "UPDATE final_decisions SET candidate_id='C' WHERE final_decision_id=?",
    ).bind(finalId).run()).rejects.toThrow()
    await expect(created.db.prepare(`INSERT INTO final_decisions (
      final_decision_id, event_id, session_id, candidate_id, confidence,
      submit_mode, source_stage, selection_origin, auto_selected,
      server_submitted_at, sequence_no, remaining_sec_at_submit,
      points_remaining_at_submit, created_at
    ) VALUES (?, ?, ?, 'C', 50, 'timeout', 'T2',
      'timeout_latest_sealed_choice', 1, ?, 12, 0, 3, ?)`)
      .bind(crypto.randomUUID(), crypto.randomUUID(), sessionId, now, now).run())
      .rejects.toThrow()

    await created.db.prepare('DELETE FROM sessions WHERE session_id=?').bind(sessionId).run()
    expect((await created.db.prepare('SELECT COUNT(*) AS count FROM sunk_cost_events')
      .first<{ count: number }>())?.count).toBe(0)
    expect((await created.db.prepare('SELECT COUNT(*) AS count FROM final_decisions')
      .first<{ count: number }>())?.count).toBe(0)
  })
})
