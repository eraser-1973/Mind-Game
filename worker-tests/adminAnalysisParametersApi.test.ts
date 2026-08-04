import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { Miniflare } from 'miniflare'
import { createPasswordRecord } from '../worker/security/adminPassword'
import { createWorkerRuntime } from './runtime'

const origin = 'https://example.test'
let runtime: Miniflare
let db: D1Database
let cookie = ''
let csrf = ''

function cookies(response: { headers: { get(name: string): string | null; getSetCookie?: () => string[] } }) {
  const headers = response.headers
  return headers.getSetCookie?.().join('\n') ?? headers.get('set-cookie') ?? ''
}

async function request(path: string, method = 'GET', body?: unknown, key = crypto.randomUUID()) {
  const headers = new Headers({ Origin: origin, Cookie: cookie })
  if (method !== 'GET') {
    headers.set('Content-Type', 'application/json')
    headers.set('Idempotency-Key', key)
    headers.set('X-CSRF-Token', csrf)
  }
  return runtime.dispatchFetch(`${origin}${path}`, {
    method, headers: Object.fromEntries(headers),
    body: body === undefined ? undefined : JSON.stringify(body),
  })
}

beforeAll(async () => {
  const created = await createWorkerRuntime(); runtime = created.runtime; db = created.db
  const record = await createPasswordRecord('Synthetic analysis password 123!')
  const now = '2026-08-04T00:00:00.000Z'
  await db.prepare(`INSERT INTO admin_users (singleton_id,admin_user_id,username,username_normalized,password_algorithm,password_iterations,password_salt_base64,password_hash_base64,password_version,auth_policy_version,is_active,created_at,password_updated_at) VALUES (1,'20000000-0000-4000-8000-000000000001','analysis.admin','analysis.admin',?,?,?,?,1,'admin-auth-1.0.0',1,?,?)`)
    .bind(record.passwordAlgorithm, record.passwordIterations, record.passwordSaltBase64, record.passwordHashBase64, now, now).run()
  const login = await runtime.dispatchFetch(`${origin}/api/admin/login`, { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'analysis.admin', password: 'Synthetic analysis password 123!' }) })
  const value = cookies(login); const token = value.match(/mg_admin=([^;]+)/)?.[1]; csrf = value.match(/mg_admin_csrf=([^;]+)/)?.[1] ?? ''; cookie = `mg_admin=${token}; mg_admin_csrf=${csrf}`
})
afterAll(async () => runtime.dispose())

describe('analysis parameter administration', () => {
  it('creates an empty manual norm draft without fabricated metric values', async () => {
    const response = await request('/api/admin/analysis/norm-sets', 'POST', {
      version: 'norm-formal-test-1', displayName: 'Formal norm draft', scoringVersion: 'RDI-2.0-prepilot', sourceType: 'manual_parameters',
    })
    expect(response.status).toBe(201)
    expect(await response.json()).toEqual(expect.objectContaining({ ok: true }))
    expect(await db.prepare(`SELECT source_type,status,revision_no,validation_status,sample_size FROM norm_sets WHERE norm_version='norm-formal-test-1'`).first())
      .toEqual({ source_type: 'manual_parameters', status: 'draft', revision_no: 1, validation_status: 'not_validated', sample_size: 0 })
    expect((await db.prepare(`SELECT COUNT(*) AS count FROM norm_metric_parameters WHERE norm_version='norm-formal-test-1'`).first<{ count: number }>())?.count).toBe(0)
  })

  it('replaces the complete norm matrix, validates it and publishes only its matching revision', async () => {
    expect((await request('/api/admin/analysis/norm-sets', 'POST', {
      version: 'norm-formal-test-2', displayName: 'Formal norm two', scoringVersion: 'RDI-2.0-prepilot', sourceType: 'manual_parameters',
    })).status).toBe(201)
    const update = await request('/api/admin/analysis/norm-sets/norm-formal-test-2', 'PUT', {
      displayName: 'Formal norm two', scoringVersion: 'RDI-2.0-prepilot', sourceType: 'manual_parameters', expectedRevision: 1,
      sampleSize: 20, populationNote: 'Synthetic prepilot cohort.',
      parameters: { RES: { mean: 10, sd: 2 }, EACS: { mean: 11, sd: 3 }, DDS: { mean: 12, sd: 4 }, GDS: { mean: 13, sd: 5 }, SLS: { mean: 14, sd: 6 } },
    })
    expect(update.status).toBe(200)
    expect((await request('/api/admin/analysis/norm-sets/norm-formal-test-2/validate', 'POST', { expectedRevision: 2 })).status).toBe(200)
    expect((await request('/api/admin/analysis/norm-sets/norm-formal-test-2/publish', 'POST', { expectedRevision: 2 })).status).toBe(200)
    expect((await db.prepare(`SELECT COUNT(*) AS count FROM norm_metric_parameters WHERE norm_version='norm-formal-test-2'`).first<{ count: number }>())?.count).toBe(5)
    expect((await request('/api/admin/analysis/norm-sets/norm-formal-test-2', 'PUT', {
      displayName: 'Ignored', scoringVersion: 'RDI-2.0-prepilot', sourceType: 'manual_parameters', expectedRevision: 2, sampleSize: 20, populationNote: 'Ignored', parameters: {},
    })).status).toBe(409)
  })

  it('creates a reliability draft only for EAC and rejects missing defaults', async () => {
    const response = await request('/api/admin/analysis/reliability-sets', 'POST', {
      version: 'reliability-formal-test-1', displayName: 'EAC reliability draft', scoringVersion: 'RDI-2.0-prepilot',
    })
    expect(response.status).toBe(201)
    expect(await db.prepare(`SELECT metric_code,sd_value,reliability_value,status,revision_no,validation_status FROM reliability_parameters WHERE reliability_version='reliability-formal-test-1'`).first())
      .toEqual({ metric_code: 'EAC', sd_value: null, reliability_value: null, status: 'draft', revision_no: 1, validation_status: 'not_validated' })
  })

  it('validates and publishes only a complete EAC reliability parameter', async () => {
    expect((await request('/api/admin/analysis/reliability-sets', 'POST', { version: 'reliability-formal-test-2', displayName: 'EAC reliability two', scoringVersion: 'RDI-2.0-prepilot' })).status).toBe(201)
    expect((await request('/api/admin/analysis/reliability-sets/reliability-formal-test-2', 'PUT', { displayName: 'EAC reliability two', scoringVersion: 'RDI-2.0-prepilot', expectedRevision: 1, metricCode: 'EAC', sd: 5, reliability: 1, sampleSize: 20, populationNote: 'Synthetic reliability cohort.' })).status).toBe(200)
    expect((await request('/api/admin/analysis/reliability-sets/reliability-formal-test-2/validate', 'POST', { expectedRevision: 2 })).status).toBe(200)
    expect((await request('/api/admin/analysis/reliability-sets/reliability-formal-test-2/publish', 'POST', { expectedRevision: 2 })).status).toBe(200)
    expect((await request('/api/admin/analysis/reliability-sets/reliability-formal-test-2', 'PUT', { displayName: 'no', scoringVersion: 'RDI-2.0-prepilot', expectedRevision: 2, metricCode: 'EAC', sd: 5, reliability: 1, sampleSize: 20, populationNote: 'no' })).status).toBe(409)
  })

  it('clones a published reliability set without mutating its source definition', async () => {
    const response = await request('/api/admin/analysis/reliability-sets', 'POST', {
      version: 'reliability-formal-clone', displayName: 'Cloned EAC reliability', scoringVersion: 'RDI-2.0-prepilot', cloneFrom: 'reliability-formal-test-2',
    })
    expect(response.status).toBe(201)
    expect(await db.prepare(`SELECT status,revision_no,source_reliability_version,sd_value,reliability_value,published_at,published_by_admin_user_id FROM reliability_parameters WHERE reliability_version='reliability-formal-clone'`).first())
      .toEqual({ status: 'draft', revision_no: 1, source_reliability_version: 'reliability-formal-test-2', sd_value: null, reliability_value: null, published_at: null, published_by_admin_user_id: null })
    expect(await db.prepare(`SELECT status,sd_value,reliability_value FROM reliability_parameters WHERE reliability_version='reliability-formal-test-2'`).first())
      .toEqual({ status: 'published', sd_value: 5, reliability_value: 1 })
  })

  it('clones the published Stage 8 scoring definition into an unpublished draft', async () => {
    const response = await request('/api/admin/analysis/scoring-definitions', 'POST', {
      version: 'RDI-2.0-formal-test-1', displayName: 'Formal scoring draft', cloneFrom: 'RDI-2.0-prepilot',
    })
    expect(response.status).toBe(201)
    expect(await db.prepare(`SELECT status,revision_no,validation_status,is_pre_pilot FROM scoring_definitions WHERE scoring_version='RDI-2.0-formal-test-1'`).first())
      .toEqual({ status: 'draft', revision_no: 1, validation_status: 'not_validated', is_pre_pilot: 0 })
  })

  it('accepts only the structured strict-complete-case scoring definition before publication', async () => {
    expect((await request('/api/admin/analysis/scoring-definitions', 'POST', { version: 'RDI-2.0-formal-test-2', displayName: 'Formal scoring two', cloneFrom: 'RDI-2.0-prepilot' })).status).toBe(201)
    const document = { displayName: 'Formal scoring two', expectedRevision: 1, formulaFamily: 'RDI-2.0', timeUnit: 'second', totalRdiEnabled: true, levelEnabled: false, weights: { RES: .2, EACS: .2, DDS: .2, GDS: .2, SLS: .2 }, eacAggregation: 'available_case_mean', eacsAggregation: 'available_case_mean', riskAnchorPolicy: 'earliest_key_risk', missingMetricPolicy: 'strict_complete_case', slsMapping: { stopLoss: 100, giveUp: 80, continue: 30, notTriggered: null, timeoutUnanswered: null } }
    expect((await request('/api/admin/analysis/scoring-definitions/RDI-2.0-formal-test-2', 'PUT', document)).status).toBe(200)
    expect((await request('/api/admin/analysis/scoring-definitions/RDI-2.0-formal-test-2/validate', 'POST', { expectedRevision: 2 })).status).toBe(200)
    expect((await request('/api/admin/analysis/scoring-definitions/RDI-2.0-formal-test-2/publish', 'POST', { expectedRevision: 2 })).status).toBe(200)
  })

  it('records redacted audits for scoring definition update, validation and publication', async () => {
    const actions = await db.prepare(`SELECT action, metadata_json FROM admin_audit_logs
      WHERE target_id='RDI-2.0-formal-test-2' ORDER BY created_at, action`).all<{ action: string; metadata_json: string }>()
    expect(actions.results.map((row) => row.action)).toEqual([
      'scoring_definition_created', 'scoring_definition_updated', 'scoring_definition_validated', 'scoring_definition_published',
    ])
    expect(actions.results.map((row) => row.metadata_json).join(' ')).not.toContain('weights')
    expect(actions.results.map((row) => row.metadata_json).join(' ')).not.toContain('slsMapping')
  })

  it('lists and reads draft parameter versions through authenticated no-store endpoints', async () => {
    const list = await request('/api/admin/analysis/norm-sets')
    expect(list.status).toBe(200)
    expect(list.headers.get('cache-control')).toBe('no-store')
    const detail = await request('/api/admin/analysis/norm-sets/norm-formal-test-1')
    expect(detail.status).toBe(200)
    expect((await request('/api/admin/analysis/reliability-sets')).status).toBe(200)
    expect((await request('/api/admin/analysis/reliability-sets/reliability-formal-test-1')).status).toBe(200)
    expect((await request('/api/admin/analysis/scoring-definitions')).status).toBe(200)
    expect((await request('/api/admin/analysis/scoring-definitions/RDI-2.0-formal-test-1')).status).toBe(200)
  })

  it('replays parameter writes without a second revision or an extra receipt', async () => {
    const key = crypto.randomUUID()
    const body = { version: 'reliability-formal-replay', displayName: 'Replay', scoringVersion: 'RDI-2.0-prepilot' }
    expect((await request('/api/admin/analysis/reliability-sets', 'POST', body, key)).status).toBe(201)
    expect((await request('/api/admin/analysis/reliability-sets', 'POST', body, key)).status).toBe(201)
    expect((await db.prepare(`SELECT COUNT(*) AS count FROM admin_operation_receipts WHERE idempotency_key=?`).bind(key).first<{ count: number }>())?.count).toBe(1)
  })

  it('clones a published norm without carrying publication metadata', async () => {
    const response = await request('/api/admin/analysis/norm-sets', 'POST', {
      version: 'norm-formal-clone', displayName: 'Cloned norm', scoringVersion: 'RDI-2.0-prepilot', sourceType: 'external_analysis', cloneFrom: 'norm-formal-test-2',
    })
    expect(response.status).toBe(201)
    expect(await db.prepare(`SELECT status,revision_no,source_norm_version,published_at,published_by_admin_user_id FROM norm_sets WHERE norm_version='norm-formal-clone'`).first())
      .toEqual({ status: 'draft', revision_no: 1, source_norm_version: 'norm-formal-test-2', published_at: null, published_by_admin_user_id: null })
    expect((await db.prepare(`SELECT COUNT(*) AS count FROM norm_metric_parameters WHERE norm_version='norm-formal-clone'`).first<{ count: number }>())?.count).toBe(5)
  })

  it('rejects an incomplete or unknown norm metric matrix before changing the draft', async () => {
    const response = await request('/api/admin/analysis/norm-sets/norm-formal-test-1', 'PUT', {
      displayName: 'Incomplete', scoringVersion: 'RDI-2.0-prepilot', sourceType: 'manual_parameters', expectedRevision: 1, sampleSize: 2, populationNote: 'Cohort',
      parameters: { RES: { mean: 1, sd: 1 }, EACS: { mean: 1, sd: 1 }, DDS: { mean: 1, sd: 1 }, GDS: { mean: 1, sd: 1 }, OTHER: { mean: 1, sd: 1 } },
    })
    expect(response.status).toBe(400)
    expect((await db.prepare(`SELECT revision_no FROM norm_sets WHERE norm_version='norm-formal-test-1'`).first())?.revision_no).toBe(1)
  })
})
