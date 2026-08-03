import { afterEach, describe, expect, it } from 'vitest'
import type { Miniflare } from 'miniflare'
import { createWorkerRuntime } from './runtime'

let runtime: Miniflare | undefined

afterEach(async () => {
  await runtime?.dispose()
  runtime = undefined
})

async function setupRunParent() {
  const created = await createWorkerRuntime()
  runtime = created.runtime
  const at = '2026-08-02T00:00:00.000Z'
  const participantId = crypto.randomUUID()
  const sessionId = crypto.randomUUID()
  await created.db.batch([
    created.db.prepare('INSERT INTO participants (participant_id,created_at) VALUES (?,?)')
      .bind(participantId, at),
    created.db.prepare(`INSERT INTO sessions (
      session_id,participant_id,creation_key,mode,config_set_id,task_version,
      material_version,point_rule_version,scoring_version,benchmark_version,
      candidate_display_order,initial_opened_candidate,completion_status,
      current_step,final_submit_mode,created_at,sunk_cost_rule_version
    ) VALUES (?,?,?,'formal','config-2026-07-v1','task-1.0.0','material-1.0.0',
      'points-5-v1','RDI-2.0-prepilot','benchmark-1.0.0',json(?),'A',
      'completed','completed','active',?,'sunk-1.0.0')`)
      .bind(sessionId, participantId, crypto.randomUUID(),
        JSON.stringify(['A', 'B', 'C', 'D', 'E']), at),
  ])
  return { ...created, sessionId, at }
}

describe('Stage 8 forward-only integrity guards', () => {
  it('keeps its guards active under schema version 10 while rejecting NULL/version-key mismatches', async () => {
    const { db, sessionId, at } = await setupRunParent()
    const schema = await db.prepare(
      "SELECT value FROM app_metadata WHERE key='schema_version'",
    ).first<{ value: string }>()
    expect(schema?.value).toBe('10')

    const insert = (normKey: string, reliabilityKey: string) =>
      db.prepare(`INSERT INTO scoring_runs (
        scoring_run_id,session_id,scoring_version,benchmark_version,
        norm_version,reliability_version,norm_key,reliability_key,
        source_fingerprint,run_status,is_pre_pilot,interpretation_status,
        rdi_status,missing_reasons_json,started_at,completed_at,is_current
      ) VALUES (?,?,'RDI-2.0-prepilot','benchmark-1.0.0',NULL,NULL,?,?,?,
        'partial',1,'research_only','norms_unavailable',json('[]'),?,?,0)`)
        .bind(crypto.randomUUID(), sessionId, normKey, reliabilityKey,
          'a'.repeat(64), at, at).run()

    await expect(insert('forged-norm', 'none'))
      .rejects.toThrow(/version keys are inconsistent/i)
    await expect(insert('none', 'forged-reliability'))
      .rejects.toThrow(/version keys are inconsistent/i)
  })

  it('prevents deleting or adding values under a published benchmark version', async () => {
    const created = await createWorkerRuntime()
    runtime = created.runtime
    const at = '2026-08-02T00:00:00.000Z'

    await expect(created.db.prepare(`DELETE FROM benchmark_candidate_values
      WHERE benchmark_version='benchmark-1.0.0' AND candidate_id='A'`).run())
      .rejects.toThrow(/published benchmark values are immutable/i)

    await created.db.prepare(`INSERT INTO benchmark_sets (
      benchmark_version,source_type,status,is_provisional,expert_count,created_at
    ) VALUES ('published-empty-test','current_app_baseline','published',1,0,?)`)
      .bind(at).run()
    await expect(created.db.prepare(`INSERT INTO benchmark_candidate_values (
      benchmark_version,candidate_id,benchmark_value,direction,
      include_in_core_eac,created_at
    ) VALUES ('published-empty-test','A',51,-1,1,?)`).bind(at).run())
      .rejects.toThrow(/published benchmark values are immutable/i)
  })
})
