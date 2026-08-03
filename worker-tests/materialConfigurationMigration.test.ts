import { afterEach, describe, expect, it } from 'vitest'
import type { Miniflare } from 'miniflare'
import { candidates } from '../src/data/candidates'
import {
  fingerprintConfiguration,
  fingerprintMaterial,
  fingerprintPointRule,
  fingerprintSunkCostRule,
} from '../worker/domain/configurationFingerprint'
import { createWorkerRuntime } from './runtime'

let runtime: Miniflare | undefined

afterEach(async () => {
  await runtime?.dispose()
  runtime = undefined
})

describe('0012 versioned material configuration migration', () => {
  it('creates the Stage 10A schema, seeds the current configuration, and advances schema version', async () => {
    const created = await createWorkerRuntime()
    runtime = created.runtime
    const schema = await created.db.prepare(
      "SELECT value FROM app_metadata WHERE key = 'schema_version'",
    ).first<{ value: string }>()
    const tables = await created.db.prepare(
      `SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name`,
    ).all<{ name: string }>()
    const counts = await created.db.prepare(`SELECT
      (SELECT COUNT(*) FROM candidate_material_profiles
        WHERE material_version = 'material-1.0.0') AS profiles,
      (SELECT COUNT(*) FROM candidate_evidence_items
        WHERE material_version = 'material-1.0.0') AS evidence,
      (SELECT COUNT(*) FROM configuration_sets WHERE is_active = 1) AS activeConfigs`)
      .first<{ profiles: number; evidence: number; activeConfigs: number }>()

    expect(schema?.value).toBe('10')
    expect(tables.results.map(({ name }) => name)).toEqual(expect.arrayContaining([
      'material_sets',
      'candidate_material_profiles',
      'configuration_validation_runs',
      'configuration_activation_history',
      'admin_operation_receipts',
    ]))
    expect(counts).toEqual({ profiles: 5, evidence: 20, activeConfigs: 1 })
  })

  it('migrates exactly the current public profile fields and excludes hidden answer columns', async () => {
    const created = await createWorkerRuntime()
    runtime = created.runtime
    const profiles = await created.db.prepare(`SELECT candidate_id,display_order,name,
      role,school,visible_halo_json,resume_summary,education,skills_json,
      experiences_json,initial_image,public_tags_json
      FROM candidate_material_profiles WHERE material_version = 'material-1.0.0'
      ORDER BY candidate_id`).all<Record<string, string | number>>()
    const columns = await created.db.prepare(
      'PRAGMA table_info(candidate_material_profiles)',
    ).all<{ name: string }>()

    expect(profiles.results).toHaveLength(5)
    for (const [index, candidate] of candidates.entries()) {
      expect(profiles.results[index]).toEqual({
        candidate_id: candidate.id,
        display_order: index + 1,
        name: candidate.name,
        role: candidate.role,
        school: candidate.school,
        visible_halo_json: JSON.stringify(candidate.visibleHalo),
        resume_summary: candidate.resumeSummary,
        education: candidate.education,
        skills_json: JSON.stringify(candidate.skills),
        experiences_json: JSON.stringify(candidate.experiences),
        initial_image: candidate.initialImage,
        public_tags_json: JSON.stringify(candidate.tags),
      })
    }
    const names = columns.results.map(({ name }) => name)
    expect(names).not.toEqual(expect.arrayContaining([
      'trueAbility', 'trueFit', 'isToxic', 'riskFlags', 'baselineFitScore',
      'expectedScoreRanges', 'expectedUpdate', 'dimensionScores',
      'trueStrengths', 'mainShortcomings', 'benchmark', 'correctCandidate',
    ]))
  })

  it('backfills stable fingerprints for the initial published components and configuration', async () => {
    const created = await createWorkerRuntime()
    runtime = created.runtime
    const profiles = candidates.map((candidate, index) => ({
      candidateId: candidate.id,
      displayOrder: index + 1,
      name: candidate.name,
      role: candidate.role,
      school: candidate.school,
      visibleHalo: candidate.visibleHalo,
      resumeSummary: candidate.resumeSummary,
      education: candidate.education,
      skills: candidate.skills,
      experiences: candidate.experiences,
      initialImage: candidate.initialImage,
      publicTags: candidate.tags,
    }))
    const evidence = candidates.flatMap((candidate) => [
      ...candidate.shallowEvidence.map((item, index) => ({
        evidenceId: item.id, candidateId: candidate.id, level: 'shallow', order: index + 1,
        title: item.title, content: item.content, polarity: item.polarity, isKeyRisk: candidate.id === 'A' || candidate.id === 'C',
      })),
      ...candidate.deepEvidence.map((item, index) => ({
        evidenceId: item.id, candidateId: candidate.id, level: 'deep', order: index + 1,
        title: item.title, content: item.content, polarity: item.polarity, isKeyRisk: candidate.id === 'A' || candidate.id === 'C',
      })),
    ])
    const materialFingerprint = await fingerprintMaterial({ profiles, evidence })
    const pointFingerprint = await fingerprintPointRule({ totalPoints: 5, shallowCost: 1, deepCost: 3 })
    const sunkFingerprint = await fingerprintSunkCostRule({ triggerRemainingSec: 300, minimumCandidateInvestment: 2, requiresKeyRisk: true })
    const configFingerprint = await fingerprintConfiguration({
      taskVersion: 'task-1.0.0', materialVersion: 'material-1.0.0', materialFingerprint,
      pointRuleVersion: 'points-5-v1', pointRuleFingerprint: pointFingerprint,
      sunkCostRuleVersion: 'sunk-1.0.0', sunkCostRuleFingerprint: sunkFingerprint,
      scoringVersion: 'RDI-2.0-prepilot', benchmarkVersion: 'benchmark-1.0.0', normVersion: null,
    })
    const values = await created.db.prepare(`SELECT
      (SELECT content_fingerprint FROM material_sets WHERE material_version='material-1.0.0') AS material,
      (SELECT content_fingerprint FROM point_rules WHERE point_rule_version='points-5-v1') AS points,
      (SELECT content_fingerprint FROM sunk_cost_rules WHERE sunk_cost_rule_version='sunk-1.0.0') AS sunk,
      (SELECT config_fingerprint FROM configuration_sets WHERE config_set_id='config-2026-07-v1') AS config`)
      .first<Record<string, string>>()
    expect(values).toEqual({ material: materialFingerprint, points: pointFingerprint, sunk: sunkFingerprint, config: configFingerprint })
  })

  it('seals published component content at the database boundary', async () => {
    const created = await createWorkerRuntime()
    runtime = created.runtime
    await expect(created.db.prepare(`UPDATE candidate_material_profiles SET name='changed'
      WHERE material_version='material-1.0.0' AND candidate_id='A'`).run()).rejects.toThrow()
    await expect(created.db.prepare(`DELETE FROM candidate_evidence_items
      WHERE material_version='material-1.0.0' AND evidence_id='A-t2-1'`).run()).rejects.toThrow()
    await expect(created.db.prepare(`UPDATE point_rules SET total_points=6
      WHERE point_rule_version='points-5-v1'`).run()).rejects.toThrow()
    await expect(created.db.prepare(`UPDATE sunk_cost_rules SET trigger_remaining_sec=200
      WHERE sunk_cost_rule_version='sunk-1.0.0'`).run()).rejects.toThrow()
    await expect(created.db.prepare(`UPDATE configuration_sets SET material_version='other'
      WHERE config_set_id='config-2026-07-v1'`).run()).rejects.toThrow()
  })
})
