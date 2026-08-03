import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { Miniflare } from 'miniflare'
import { createWorkerRuntime } from './runtime'

let runtime: Miniflare
let db: D1Database

beforeEach(async () => {
  const created = await createWorkerRuntime({ throughMigration: '0012_admin_material_configuration.sql' })
  runtime = created.runtime
  db = created.db
})

afterEach(async () => runtime.dispose())

const at = '2026-08-02T00:00:00.000Z'

async function seedExpertDraft(version: string, expertCount: number) {
  await db.prepare(`INSERT INTO benchmark_sets (
    benchmark_version,source_type,status,is_provisional,expert_count,created_at
  ) VALUES (?,'expert_panel','draft',0,?,?)`).bind(version, expertCount, at).run()
  await db.prepare(`INSERT INTO benchmark_candidate_values (
    benchmark_version,candidate_id,benchmark_value,direction,include_in_core_eac,
    created_at
  ) SELECT ?,candidate_id,benchmark_value,direction,include_in_core_eac,created_at
    FROM benchmark_candidate_values WHERE benchmark_version='benchmark-1.0.0'`)
    .bind(version).run()
}

describe('formal expert benchmark publication guards', () => {
  it('never permits a current-app baseline to be marked non-provisional', async () => {
    await expect(db.prepare(`INSERT INTO benchmark_sets (
      benchmark_version,source_type,status,is_provisional,expert_count,created_at
    ) VALUES ('baseline-bypass','current_app_baseline','draft',0,0,?)`)
      .bind(at).run()).rejects.toThrow(/current-app baselines must remain provisional/i)

    await expect(db.prepare(`UPDATE benchmark_sets SET is_provisional=0
      WHERE benchmark_version='benchmark-1.0.0'`).run())
      .rejects.toThrow(/current-app baselines must remain provisional/i)
  })

  it('requires draft publication and complete stored expert coverage', async () => {
    await expect(db.prepare(`INSERT INTO benchmark_sets (
      benchmark_version,source_type,status,is_provisional,expert_count,created_at
    ) VALUES ('expert-direct','expert_panel','published',0,1,?)`).bind(at).run())
      .rejects.toThrow(/must be published from a validated draft/i)

    await seedExpertDraft('expert-incomplete', 2)
    await db.prepare(`INSERT INTO benchmark_expert_scores (
      expert_score_id,benchmark_version,candidate_id,expert_code,score,submitted_at
    ) VALUES (?,'expert-incomplete','A','expert-1',80,?)`)
      .bind(crypto.randomUUID(), at).run()
    await expect(db.prepare(`UPDATE benchmark_sets SET status='published'
      WHERE benchmark_version='expert-incomplete'`).run())
      .rejects.toThrow(/expert rows are incomplete/i)
  })

  it('publishes only when every declared expert rated A-E and then seals expert rows', async () => {
    await seedExpertDraft('expert-complete', 2)
    for (const expertCode of ['expert-1', 'expert-2']) {
      for (const candidateId of ['A', 'B', 'C', 'D', 'E']) {
        await db.prepare(`INSERT INTO benchmark_expert_scores (
          expert_score_id,benchmark_version,candidate_id,expert_code,score,submitted_at
        ) VALUES (?,'expert-complete',?,?,80,?)`)
          .bind(crypto.randomUUID(), candidateId, expertCode, at).run()
      }
    }
    await db.prepare(`UPDATE benchmark_sets SET status='published',validated_at=?
      WHERE benchmark_version='expert-complete'`).bind(at).run()
    const published = await db.prepare(`SELECT status FROM benchmark_sets
      WHERE benchmark_version='expert-complete'`).first<{ status: string }>()
    expect(published?.status).toBe('published')

    await expect(db.prepare(`DELETE FROM benchmark_expert_scores
      WHERE benchmark_version='expert-complete' AND expert_code='expert-1'`).run())
      .rejects.toThrow(/published expert scores are immutable/i)
  })

  it('requires scoring snapshots to name the same session as their run', async () => {
    const participantIds = [crypto.randomUUID(), crypto.randomUUID()]
    const sessionIds = [crypto.randomUUID(), crypto.randomUUID()]
    for (let index = 0; index < 2; index += 1) {
      await db.prepare(`INSERT INTO participants (participant_id,created_at)
        VALUES (?,?)`).bind(participantIds[index], at).run()
      await db.prepare(`INSERT INTO sessions (
        session_id,participant_id,creation_key,mode,config_set_id,task_version,
        material_version,point_rule_version,scoring_version,benchmark_version,
        candidate_display_order,initial_opened_candidate,completion_status,
        current_step,final_submit_mode,created_at,sunk_cost_rule_version
      ) VALUES (?,?,?,'formal','config-2026-07-v1','task-1.0.0','material-1.0.0',
        'points-5-v1','RDI-2.0-prepilot','benchmark-1.0.0',json(?),'A',
        'in_progress','game','active',?,'sunk-1.0.0')`)
        .bind(sessionIds[index], participantIds[index], crypto.randomUUID(),
          JSON.stringify(['A', 'B', 'C', 'D', 'E']), at).run()
    }
    const runId = crypto.randomUUID()
    await db.prepare(`INSERT INTO scoring_runs (
      scoring_run_id,session_id,scoring_version,benchmark_version,norm_key,
      reliability_key,source_fingerprint,run_status,is_pre_pilot,
      interpretation_status,rdi_status,missing_reasons_json,started_at,is_current
    ) VALUES (?,?,'RDI-2.0-prepilot','benchmark-1.0.0','none','none',?,
      'partial',1,'research_only','norms_unavailable',json('[]'),?,0)`)
      .bind(runId, sessionIds[0], 'b'.repeat(64), at).run()

    await expect(db.prepare(`INSERT INTO scoring_input_snapshots (
      scoring_run_id,session_id,input_json,input_schema_version,captured_at
    ) VALUES (?,?,json('{}'),'prepilot-input-1',?)`)
      .bind(runId, sessionIds[1], at).run())
      .rejects.toThrow(/snapshot session does not match scoring run/i)
  })
})
