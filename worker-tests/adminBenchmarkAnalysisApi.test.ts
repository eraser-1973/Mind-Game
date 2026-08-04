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
  return runtime.dispatchFetch(`${origin}${path}`, { method, headers: Object.fromEntries(headers), body: body === undefined ? undefined : JSON.stringify(body) })
}

beforeAll(async () => {
  const created = await createWorkerRuntime(); runtime = created.runtime; db = created.db
  const record = await createPasswordRecord('Synthetic benchmark password 123!')
  const now = '2026-08-04T00:00:00.000Z'
  await db.prepare(`INSERT INTO admin_users (singleton_id,admin_user_id,username,username_normalized,password_algorithm,password_iterations,password_salt_base64,password_hash_base64,password_version,auth_policy_version,is_active,created_at,password_updated_at) VALUES (1,'10000000-0000-4000-8000-000000000001','benchmark.admin','benchmark.admin',?,?,?,?,1,'admin-auth-1.0.0',1,?,?)`).bind(record.passwordAlgorithm,record.passwordIterations,record.passwordSaltBase64,record.passwordHashBase64,now,now).run()
  const login = await runtime.dispatchFetch(`${origin}/api/admin/login`, { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'benchmark.admin', password: 'Synthetic benchmark password 123!' }) })
  const value = cookies(login); const token = value.match(/mg_admin=([^;]+)/)?.[1]; csrf = value.match(/mg_admin_csrf=([^;]+)/)?.[1] ?? ''; cookie = `mg_admin=${token}; mg_admin_csrf=${csrf}`
})
afterAll(async () => runtime.dispose())

describe('expert benchmark administration', () => {
  it('creates an empty expert draft with exactly cloned policies, never baseline values', async () => {
    const response = await request('/api/admin/analysis/benchmark-sets', 'POST', { version: 'benchmark-expert-test-1', displayName: 'Expert benchmark', clonePoliciesFrom: 'benchmark-1.0.0' })
    const payload = await response.json()
    expect(payload).toEqual(expect.objectContaining({ ok: true }))
    expect(response.status).toBe(201)
    const header = await db.prepare(`SELECT source_type,status,revision_no,validation_status,is_provisional,expert_count FROM benchmark_sets WHERE benchmark_version='benchmark-expert-test-1'`).first<Record<string, unknown>>()
    expect(header).toEqual({ source_type: 'expert_panel', status: 'draft', revision_no: 1, validation_status: 'not_validated', is_provisional: 0, expert_count: 0 })
    expect((await db.prepare("SELECT COUNT(*) AS count FROM benchmark_candidate_policies WHERE benchmark_version='benchmark-expert-test-1'").first<{ count:number }>())?.count).toBe(5)
    expect((await db.prepare("SELECT COUNT(*) AS count FROM benchmark_candidate_values WHERE benchmark_version='benchmark-expert-test-1'").first<{ count:number }>())?.count).toBe(0)
    expect((await db.prepare("SELECT COUNT(*) AS count FROM benchmark_expert_scores WHERE benchmark_version='benchmark-expert-test-1'").first<{ count:number }>())?.count).toBe(0)
  })

  it('atomically replaces a complete A-E matrix and rejects an obsolete revision', async () => {
    const create = await request('/api/admin/analysis/benchmark-sets', 'POST', { version: 'benchmark-expert-test-2', displayName: 'Expert benchmark two', clonePoliciesFrom: 'benchmark-1.0.0' })
    expect(create.status).toBe(201)
    const response = await request('/api/admin/analysis/benchmark-sets/benchmark-expert-test-2', 'PUT', {
      displayName: 'Expert benchmark two revised', ratedAt: '2026-08-04T01:00:00.000Z', expectedRevision: 1,
      candidatePolicies: [
        { candidateId: 'A', direction: -1, includeInCoreEac: true },
        { candidateId: 'B', direction: 1, includeInCoreEac: true },
        { candidateId: 'C', direction: -1, includeInCoreEac: true },
        { candidateId: 'D', direction: 1, includeInCoreEac: true },
        { candidateId: 'E', direction: 0, includeInCoreEac: false },
      ],
      experts: [
        { expertCode: 'panel-01', scores: { A: 0, B: 100, C: 60, D: 90, E: 70 } },
        { expertCode: 'panel-02', scores: { A: 20, B: 80, C: 40, D: 70, E: 50 } },
      ],
    })
    expect(response.status).toBe(200)
    const revised = await db.prepare("SELECT revision_no,validation_status FROM benchmark_sets WHERE benchmark_version='benchmark-expert-test-2'").first()
    expect(revised).toEqual({ revision_no: 2, validation_status: 'stale' })
    const scoreCount = await db.prepare("SELECT COUNT(*) AS count FROM benchmark_expert_scores WHERE benchmark_version='benchmark-expert-test-2'").first<{ count: number }>()
    expect(scoreCount?.count).toBe(10)
    const validated = await request('/api/admin/analysis/benchmark-sets/benchmark-expert-test-2/validate', 'POST', { expectedRevision: 2 })
    expect(validated.status).toBe(200)
    const validationData = await validated.json() as { data: { report: { preview: { candidates: { B: { mean: number; sampleSd: number } } } } } }
    expect(validationData.data.report.preview.candidates.B.mean).toBe(90)
    expect(validationData.data.report.preview.candidates.B.sampleSd).toBeCloseTo(Math.sqrt(200), 12)
    const published = await request('/api/admin/analysis/benchmark-sets/benchmark-expert-test-2/publish', 'POST', { expectedRevision: 2 })
    expect(published.status).toBe(200)
    const valueCount = await db.prepare("SELECT COUNT(*) AS count FROM benchmark_candidate_values WHERE benchmark_version='benchmark-expert-test-2'").first<{ count: number }>()
    expect(valueCount?.count).toBe(5)
    const conflict = await request('/api/admin/analysis/benchmark-sets/benchmark-expert-test-2', 'PUT', {
      displayName: 'ignored', ratedAt: '2026-08-04T01:00:00.000Z', expectedRevision: 2,
      candidatePolicies: [
        { candidateId: 'A', direction: -1, includeInCoreEac: true }, { candidateId: 'B', direction: 1, includeInCoreEac: true },
        { candidateId: 'C', direction: -1, includeInCoreEac: true }, { candidateId: 'D', direction: 1, includeInCoreEac: true },
        { candidateId: 'E', direction: 0, includeInCoreEac: false },
      ], experts: [
        { expertCode: 'panel-01', scores: { A: 0, B: 100, C: 60, D: 90, E: 70 } },
        { expertCode: 'panel-02', scores: { A: 20, B: 80, C: 40, D: 70, E: 50 } },
      ],
    })
    expect(conflict.status).toBe(409)
    await expect(db.prepare(`UPDATE benchmark_candidate_values SET benchmark_value=0
      WHERE benchmark_version='benchmark-expert-test-2' AND candidate_id='A'`).run())
      .rejects.toThrow(/immutable/i)
  })

  it('replays an idempotent draft request, rejects a reused key, and records no matrix in audit metadata', async () => {
    const key = crypto.randomUUID()
    const body = { version: 'benchmark-expert-test-3', displayName: 'Replay benchmark', clonePoliciesFrom: 'benchmark-1.0.0' }
    const first = await request('/api/admin/analysis/benchmark-sets', 'POST', body, key)
    const second = await request('/api/admin/analysis/benchmark-sets', 'POST', body, key)
    expect(first.status).toBe(201)
    expect(second.status).toBe(201)
    expect((await db.prepare("SELECT COUNT(*) AS count FROM benchmark_sets WHERE benchmark_version='benchmark-expert-test-3'").first<{count:number}>())?.count).toBe(1)
    const reused = await request('/api/admin/analysis/benchmark-sets', 'POST', { ...body, displayName: 'Different content' }, key)
    expect(reused.status).toBe(409)
    const audit = await db.prepare(`SELECT metadata_json FROM admin_audit_logs
      WHERE target_id='benchmark-expert-test-3'`).first<{ metadata_json: string }>()
    expect(audit?.metadata_json).not.toContain('panel-01')
    expect(audit?.metadata_json).not.toContain('scores')
  })

  it('requires administrator authentication and csrf for benchmark writes', async () => {
    const participant = await runtime.dispatchFetch(`${origin}/api/admin/analysis/benchmark-sets`, { method: 'GET', headers: { Cookie: 'mg_session=participant' } })
    expect(participant.status).toBe(401)
    const csrfMissing = await runtime.dispatchFetch(`${origin}/api/admin/analysis/benchmark-sets`, {
      method: 'POST', headers: {
        Origin: origin, Cookie: cookie, 'Content-Type': 'application/json', 'Idempotency-Key': crypto.randomUUID(),
      }, body: JSON.stringify({ version: 'benchmark-expert-test-4', displayName: 'Blocked', clonePoliciesFrom: 'benchmark-1.0.0' }),
    })
    expect(csrfMissing.status).toBe(403)
    const crossOrigin = await runtime.dispatchFetch(`${origin}/api/admin/analysis/benchmark-sets`, {
      method: 'POST', headers: {
        Origin: 'https://other.test', Cookie: cookie, 'Content-Type': 'application/json', 'Idempotency-Key': crypto.randomUUID(), 'X-CSRF-Token': csrf,
      }, body: JSON.stringify({ version: 'benchmark-expert-test-5', displayName: 'Blocked', clonePoliciesFrom: 'benchmark-1.0.0' }),
    })
    expect(crossOrigin.status).toBe(403)
  })

  it('keeps a one-expert complete draft invalid and preserves validation history', async () => {
    expect((await request('/api/admin/analysis/benchmark-sets', 'POST', { version: 'benchmark-expert-test-6', displayName: 'Small panel', clonePoliciesFrom: 'benchmark-1.0.0' })).status).toBe(201)
    const matrix = {
      displayName: 'Small panel', ratedAt: '2026-08-04T02:00:00.000Z', expectedRevision: 1,
      candidatePolicies: [
        { candidateId: 'A', direction: -1, includeInCoreEac: true }, { candidateId: 'B', direction: 1, includeInCoreEac: true },
        { candidateId: 'C', direction: -1, includeInCoreEac: true }, { candidateId: 'D', direction: 1, includeInCoreEac: true },
        { candidateId: 'E', direction: 0, includeInCoreEac: false },
      ], experts: [{ expertCode: 'panel-03', scores: { A: 0, B: 100, C: 0, D: 100, E: 50 } }],
    }
    expect((await request('/api/admin/analysis/benchmark-sets/benchmark-expert-test-6', 'PUT', matrix)).status).toBe(200)
    const validation = await request('/api/admin/analysis/benchmark-sets/benchmark-expert-test-6/validate', 'POST', { expectedRevision: 2 })
    expect(validation.status).toBe(200)
    expect((await validation.json() as { data: { validationStatus: string } }).data.validationStatus).toBe('invalid')
    expect((await request('/api/admin/analysis/benchmark-sets/benchmark-expert-test-6/publish', 'POST', { expectedRevision: 2 })).status).toBe(409)
    expect((await db.prepare("SELECT COUNT(*) AS count FROM analysis_validation_runs WHERE object_version='benchmark-expert-test-6'").first<{ count: number }>())?.count).toBe(1)
  })
})
