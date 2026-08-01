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
  new URL('../migrations/0007_post_task_completion.sql', import.meta.url),
)

async function seedFinalizedSession(db: D1Database, suffix: string) {
  const participantId = crypto.randomUUID()
  const sessionId = crypto.randomUUID()
  const finalDecisionId = crypto.randomUUID()
  const at = '2026-08-01T01:00:00.000Z'
  await db.batch([
    db.prepare('INSERT INTO participants (participant_id,created_at) VALUES (?,?)')
      .bind(participantId, at),
    db.prepare(`INSERT INTO sessions (
      session_id,participant_id,creation_key,mode,config_set_id,
      task_version,material_version,point_rule_version,sunk_cost_rule_version,
      scoring_version,benchmark_version,candidate_display_order,
      initial_opened_candidate,completion_status,current_step,final_submit_mode,
      created_at,started_at,deadline_at
    ) VALUES (?,?,?,'formal','config-2026-07-v1','task-1.0.0','material-1.0.0',
      'points-5-v1','sunk-1.0.0','RDI-2.0-prepilot','benchmark-1.0.0',
      json('["A","B","C","D","E"]'),'A','in_progress','post_task','active',
      ?,'2026-08-01T00:45:00.000Z','2026-08-01T01:00:00.000Z')`)
      .bind(sessionId, participantId, crypto.randomUUID(), at),
    db.prepare(`INSERT INTO game_runs (
      session_id,start_event_id,current_stage,duration_sec,points_total,points_remaining,
      last_sequence_no,started_at,deadline_at,t1_completed_at,updated_at,finalized_at
    ) VALUES (?,?,'DECISION',900,5,5,7,'2026-08-01T00:45:00.000Z',
      '2026-08-01T01:00:00.000Z','2026-08-01T00:50:00.000Z',?,?)`)
      .bind(sessionId, crypto.randomUUID(), at, at),
    db.prepare(`INSERT INTO final_decisions (
      final_decision_id,event_id,session_id,candidate_id,confidence,submit_mode,
      source_stage,selection_origin,auto_selected,client_submitted_at,
      server_submitted_at,sequence_no,remaining_sec_at_submit,
      points_remaining_at_submit,sunk_cost_choice,created_at
    ) VALUES (?,?,?,'B',75,'active','T2','active_user',0,?,?,7,60,5,
      'not_triggered',?)`)
      .bind(finalDecisionId, crypto.randomUUID(), sessionId, at, at, at),
  ])
  return { participantId, sessionId, finalDecisionId, suffix, at }
}

describe('0007 post-task completion migration', () => {
  it('creates the Stage 7 schema, indexes, triggers, and schema version 7', async () => {
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
    const sessionColumns = await created.db.prepare('PRAGMA table_info(sessions)')
      .all<{ name: string }>()
    const questionnaireColumns = await created.db
      .prepare('PRAGMA table_info(questionnaire_submissions)')
      .all<{ name: string }>()

    expect(schema?.value).toBe('7')
    expect(tables.results.map(({ name }) => name)).toContain('completion_records')
    expect(sessionColumns.results.map(({ name }) => name)).toEqual(expect.arrayContaining([
      'post_task_completed_at', 'task_experience_completed_at',
    ]))
    expect(questionnaireColumns.results.map(({ name }) => name)).toContain('sequence_no')
    expect(indexes.results.map(({ name }) => name)).toEqual(expect.arrayContaining([
      'questionnaire_submissions_session_sequence_idx',
      'questionnaire_submissions_one_post_idx',
      'questionnaire_submissions_one_task_experience_idx',
      'completion_records_server_completed_idx',
      'completion_records_status_idx',
    ]))
  })

  it('preserves Stage 1-6 rows and allows historical pre submissions without a sequence', async () => {
    const created = await createWorkerRuntime({
      throughMigration: '0006_sunk_cost_final_decision.sql',
    })
    runtime = created.runtime
    const seeded = await seedFinalizedSession(created.db, 'preserve')
    const preId = crypto.randomUUID()
    await created.db.prepare(`INSERT INTO questionnaire_submissions (
      submission_id,event_id,session_id,phase,instrument_version,client_started_at,
      client_submitted_at,server_submitted_at,item_count
    ) VALUES (?,?,?,'pre','state-assessment-pre-1.0.0',?,?,?,5)`)
      .bind(preId, crypto.randomUUID(), seeded.sessionId, seeded.at, seeded.at, seeded.at)
      .run()

    await applyMigrationSource(created.db, await readFile(migrationPath, 'utf8'))

    const pre = await created.db.prepare(
      'SELECT phase,sequence_no FROM questionnaire_submissions WHERE submission_id=?',
    ).bind(preId).first<{ phase: string; sequence_no: number | null }>()
    const final = await created.db.prepare(
      'SELECT candidate_id,confidence FROM final_decisions WHERE final_decision_id=?',
    ).bind(seeded.finalDecisionId).first<{ candidate_id: string; confidence: number }>()
    const run = await created.db.prepare(
      'SELECT last_sequence_no,finalized_at FROM game_runs WHERE session_id=?',
    ).bind(seeded.sessionId).first<{ last_sequence_no: number; finalized_at: string }>()

    expect(pre).toEqual({ phase: 'pre', sequence_no: null })
    expect(final).toEqual({ candidate_id: 'B', confidence: 75 })
    expect(run).toEqual({ last_sequence_no: 7, finalized_at: seeded.at })
  })

  it('enforces questionnaire sequence, phase uniqueness, sealing, and completion contracts', async () => {
    const created = await createWorkerRuntime()
    runtime = created.runtime
    const seeded = await seedFinalizedSession(created.db, 'constraints')
    const postId = crypto.randomUUID()
    const taskId = crypto.randomUUID()

    await expect(created.db.prepare(`INSERT INTO questionnaire_submissions (
      submission_id,event_id,session_id,phase,instrument_version,client_started_at,
      client_submitted_at,server_submitted_at,item_count,sequence_no
    ) VALUES (?,?,?,'post','state-assessment-post-1.0.0',?,?,?,5,NULL)`)
      .bind(crypto.randomUUID(), crypto.randomUUID(), seeded.sessionId,
        seeded.at, seeded.at, seeded.at).run()).rejects.toThrow()

    await created.db.batch([
      created.db.prepare(`INSERT INTO questionnaire_submissions (
        submission_id,event_id,session_id,phase,instrument_version,client_started_at,
        client_submitted_at,server_submitted_at,item_count,sequence_no
      ) VALUES (?,?,?,'post','state-assessment-post-1.0.0',?,?,?,5,8)`)
        .bind(postId, crypto.randomUUID(), seeded.sessionId,
          seeded.at, seeded.at, seeded.at),
      created.db.prepare(`INSERT INTO questionnaire_submissions (
        submission_id,event_id,session_id,phase,instrument_version,client_started_at,
        client_submitted_at,server_submitted_at,item_count,sequence_no
      ) VALUES (?,?,?,'task_experience','task-experience-1.0.0',?,?,?,15,9)`)
        .bind(taskId, crypto.randomUUID(), seeded.sessionId,
          seeded.at, seeded.at, seeded.at),
    ])

    await expect(created.db.prepare(`INSERT INTO questionnaire_submissions (
      submission_id,event_id,session_id,phase,instrument_version,client_started_at,
      client_submitted_at,server_submitted_at,item_count,sequence_no
    ) VALUES (?,?,?,'post','state-assessment-post-1.0.0',?,?,?,5,10)`)
      .bind(crypto.randomUUID(), crypto.randomUUID(), seeded.sessionId,
        seeded.at, seeded.at, seeded.at).run()).rejects.toThrow()
    await expect(created.db.prepare(
      "UPDATE questionnaire_submissions SET instrument_version='changed' WHERE submission_id=?",
    ).bind(postId).run()).rejects.toThrow()

    await expect(created.db.prepare(`INSERT INTO completion_records (
      completion_id,event_id,session_id,final_decision_id,post_submission_id,
      task_experience_submission_id,completion_status,final_submit_mode,
      client_completed_at,server_completed_at,sequence_no,created_at
    ) VALUES (?,?,?,?,?,?,'timeout','active',?,?,10,?)`)
      .bind(crypto.randomUUID(), crypto.randomUUID(), seeded.sessionId,
        seeded.finalDecisionId, postId, taskId, seeded.at, seeded.at, seeded.at)
      .run()).rejects.toThrow()

    await expect(created.db.prepare(`INSERT INTO completion_records (
      completion_id,event_id,session_id,final_decision_id,post_submission_id,
      task_experience_submission_id,completion_status,final_submit_mode,
      client_completed_at,server_completed_at,sequence_no,created_at
    ) VALUES (?,?,?,?,?,?,'completed','active',?,?,10,?)`)
      .bind(crypto.randomUUID(), crypto.randomUUID(), seeded.sessionId,
        seeded.finalDecisionId, taskId, postId, seeded.at,
        '2026-08-01T00:59:59.000Z', seeded.at)
      .run()).rejects.toThrow()

    const completionId = crypto.randomUUID()
    await created.db.prepare(`INSERT INTO completion_records (
      completion_id,event_id,session_id,final_decision_id,post_submission_id,
      task_experience_submission_id,completion_status,final_submit_mode,
      client_completed_at,server_completed_at,sequence_no,created_at
    ) VALUES (?,?,?,?,?,?,'completed','active',?,?,10,?)`)
      .bind(completionId, crypto.randomUUID(), seeded.sessionId,
        seeded.finalDecisionId, postId, taskId, seeded.at, seeded.at, seeded.at)
      .run()
    await expect(created.db.prepare(
      "UPDATE completion_records SET completion_status='timeout' WHERE completion_id=?",
    ).bind(completionId).run()).rejects.toThrow()

    await created.db.prepare('DELETE FROM participants WHERE participant_id=?')
      .bind(seeded.participantId).run()
    expect((await created.db.prepare(
      'SELECT COUNT(*) AS count FROM completion_records WHERE session_id=?',
    ).bind(seeded.sessionId).first<{ count: number }>())?.count).toBe(0)
  })
})
