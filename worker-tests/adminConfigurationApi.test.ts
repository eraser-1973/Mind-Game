import type { Miniflare } from 'miniflare'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createPasswordRecord } from '../worker/security/adminPassword'
import { createWorkerRuntime } from './runtime'

const origin = 'https://example.test'
const username = 'config.admin'
const password = 'Synthetic configuration password 123!'
let runtime: Miniflare
let db: D1Database
let cookie = ''
let csrf = ''

function setCookies(response: { headers: { get(name: string): string | null } }): string {
  const headers = response.headers as typeof response.headers & { getSetCookie?: () => string[] }
  return headers.getSetCookie?.().join('\n') ?? response.headers.get('set-cookie') ?? ''
}

async function request(path: string, options: { method?: string; body?: unknown; key?: string; csrf?: boolean; cookie?: string } = {}) {
  const headers = new Headers({ Origin: origin })
  if (options.cookie ?? cookie) headers.set('Cookie', options.cookie ?? cookie)
  if (options.body !== undefined) headers.set('Content-Type', 'application/json')
  if (options.method && options.method !== 'GET') {
    headers.set('Idempotency-Key', options.key ?? crypto.randomUUID())
    if (options.csrf !== false) headers.set('X-CSRF-Token', csrf)
  }
  return runtime.dispatchFetch(`${origin}${path}`, {
    method: options.method ?? 'GET',
    headers: Object.fromEntries(headers.entries()),
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  })
}

beforeAll(async () => {
  const created = await createWorkerRuntime()
  runtime = created.runtime
  db = created.db
  const record = await createPasswordRecord(password)
  const now = '2026-08-03T00:00:00.000Z'
  await db.prepare(`INSERT INTO admin_users (
    singleton_id,admin_user_id,username,username_normalized,password_algorithm,
    password_iterations,password_salt_base64,password_hash_base64,password_version,
    auth_policy_version,is_active,created_at,password_updated_at
  ) VALUES (1,?,?,?,?,?,?,?,1,'admin-auth-1.0.0',1,?,?)`).bind(
    '10000000-0000-4000-8000-000000000001', 'Config.Admin', username,
    record.passwordAlgorithm, record.passwordIterations, record.passwordSaltBase64,
    record.passwordHashBase64, now, now,
  ).run()
  const login = await runtime.dispatchFetch(`${origin}/api/admin/login`, {
    method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  })
  expect(login.status).toBe(200)
  const values = setCookies(login)
  const admin = values.match(/mg_admin=([^;]+)/)?.[1]
  csrf = values.match(/mg_admin_csrf=([^;]+)/)?.[1] ?? ''
  cookie = `mg_admin=${admin}; mg_admin_csrf=${csrf}`
})

afterAll(async () => runtime.dispose())

describe('administrator configuration APIs', () => {
  it('protects every route and every write prerequisite', async () => {
    expect((await request('/api/admin/config/material-sets', { cookie: '' })).status).toBe(401)
    expect((await request('/api/admin/config/material-sets', { method: 'POST', body: {}, csrf: false })).status).toBe(403)
    const missingKey = await runtime.dispatchFetch(`${origin}/api/admin/config/material-sets`, {
      method: 'POST', headers: { Origin: origin, Cookie: cookie, 'X-CSRF-Token': csrf, 'Content-Type': 'application/json' }, body: '{}',
    })
    expect(missingKey.status).toBe(400)
  })

  it('clones, revision-checks, validates, publishes, and seals material drafts idempotently', async () => {
    const list = await request('/api/admin/config/material-sets')
    expect(list.status).toBe(200)
    const cloneKey = crypto.randomUUID()
    const cloneBody = { version: 'material-test-1', displayName: '测试材料', cloneFromVersion: 'material-1.0.0' }
    const clone = await request('/api/admin/config/material-sets', { method: 'POST', body: cloneBody, key: cloneKey })
    expect(clone.status).toBe(201)
    const replay = await request('/api/admin/config/material-sets', { method: 'POST', body: cloneBody, key: cloneKey })
    expect(replay.status).toBe(201)
    const reused = await request('/api/admin/config/material-sets', { method: 'POST', body: { ...cloneBody, displayName: '不同' }, key: cloneKey })
    expect(reused.status).toBe(409)

    const detailResponse = await request('/api/admin/config/material-sets/material-test-1')
    const detail = await detailResponse.json() as { data: { revision: number; profiles: unknown[]; evidence: unknown[] } }
    expect(detail.data.profiles).toHaveLength(5)
    expect(detail.data.evidence).toHaveLength(20)
    const document = { profiles: detail.data.profiles, evidence: detail.data.evidence }
    const update = await request('/api/admin/config/material-sets/material-test-1', {
      method: 'PUT', body: { expectedRevision: 1, displayName: '测试材料修订', document },
    })
    expect(update.status).toBe(200)
    const stale = await request('/api/admin/config/material-sets/material-test-1', {
      method: 'PUT', body: { expectedRevision: 1, displayName: '过期修改', document },
    })
    expect(stale.status).toBe(409)
    expect((await request('/api/admin/config/material-sets/material-test-1/validate', { method: 'POST', body: {} })).status).toBe(200)
    expect((await request('/api/admin/config/material-sets/material-test-1/publish', { method: 'POST', body: {} })).status).toBe(200)
    expect((await request('/api/admin/config/material-sets/material-test-1', {
      method: 'PUT', body: { expectedRevision: 2, displayName: '不能修改', document },
    })).status).toBe(409)
    expect((await request('/api/admin/config/material-sets/material-test-1/validate', {
      method: 'POST', body: {},
    })).status).toBe(409)
  })

  it('allows only one concurrent editor to advance the same material revision', async () => {
    expect((await request('/api/admin/config/material-sets', { method: 'POST', body: {
      version: 'material-race-1', displayName: '并发测试材料', cloneFromVersion: 'material-1.0.0',
    } })).status).toBe(201)
    const detailResponse = await request('/api/admin/config/material-sets/material-race-1')
    const detail = await detailResponse.json() as { data: { profiles: unknown[]; evidence: unknown[] } }
    const document = { profiles: detail.data.profiles, evidence: detail.data.evidence }
    const [first, second] = await Promise.all([
      request('/api/admin/config/material-sets/material-race-1', { method: 'PUT', body: {
        expectedRevision: 1, displayName: '并发编辑一', document,
      } }),
      request('/api/admin/config/material-sets/material-race-1', { method: 'PUT', body: {
        expectedRevision: 1, displayName: '并发编辑二', document,
      } }),
    ])
    expect([first.status, second.status].sort()).toEqual([200, 409])
    const stored = await db.prepare(
      "SELECT revision_no FROM material_sets WHERE material_version='material-race-1'",
    ).first<{ revision_no: number }>()
    expect(stored?.revision_no).toBe(2)
  })

  it('versions rules and keeps configuration publication separate from activation and rollback', async () => {
    expect((await request('/api/admin/config/point-rules', { method: 'POST', body: {
      version: 'points-test-1', displayName: '测试点数', cloneFromVersion: 'points-5-v1',
    } })).status).toBe(201)
    expect((await request('/api/admin/config/point-rules/points-test-1', { method: 'PUT', body: {
      expectedRevision: 1, displayName: '测试点数', rule: { totalPoints: 6, shallowCost: 1, deepCost: 3 },
    } })).status).toBe(200)
    expect((await request('/api/admin/config/point-rules/points-test-1/validate', { method: 'POST', body: {} })).status).toBe(200)
    expect((await request('/api/admin/config/point-rules/points-test-1/publish', { method: 'POST', body: {} })).status).toBe(200)
    expect((await request('/api/admin/config/point-rules/points-test-1/validate', { method: 'POST', body: {} })).status).toBe(409)

    expect((await request('/api/admin/config/sunk-cost-rules', { method: 'POST', body: {
      version: 'sunk-test-1', displayName: '测试沉没成本', cloneFromVersion: 'sunk-1.0.0',
    } })).status).toBe(201)
    expect((await request('/api/admin/config/sunk-cost-rules/sunk-test-1/validate', { method: 'POST', body: {} })).status).toBe(200)
    expect((await request('/api/admin/config/sunk-cost-rules/sunk-test-1/publish', { method: 'POST', body: {} })).status).toBe(200)

    expect((await request('/api/admin/config/configuration-sets', { method: 'POST', body: {
      configSetId: 'config-test-1', displayName: '测试配置', cloneFromConfigSetId: 'config-2026-07-v1',
    } })).status).toBe(201)
    const config = await request('/api/admin/config/configuration-sets/config-test-1', { method: 'PUT', body: {
      expectedRevision: 1, displayName: '测试配置', taskVersion: 'task-1.0.0',
      materialVersion: 'material-test-1', pointRuleVersion: 'points-test-1',
      sunkCostRuleVersion: 'sunk-test-1', scoringVersion: 'RDI-2.0-prepilot',
      benchmarkVersion: 'benchmark-1.0.0', normVersion: null,
    } })
    expect(config.status).toBe(200)
    const validation = await request('/api/admin/config/configuration-sets/config-test-1/validate', { method: 'POST', body: {} })
    const validationBody = await validation.json() as { data: { warnings: Array<{ code: string }> } }
    expect(validationBody.data.warnings.map(({ code }) => code)).toEqual(expect.arrayContaining(['BENCHMARK_PROVISIONAL', 'NORMS_UNAVAILABLE']))
    expect((await request('/api/admin/config/configuration-sets/config-test-1/publish', { method: 'POST', body: {} })).status).toBe(200)
    expect((await db.prepare("SELECT config_set_id FROM configuration_sets WHERE is_active=1").first<{ config_set_id: string }>())?.config_set_id).toBe('config-2026-07-v1')
    expect((await request('/api/admin/config/configuration-sets/config-test-1/activate', { method: 'POST', body: { confirmConfigSetId: 'config-test-1' } })).status).toBe(200)
    expect((await db.prepare("SELECT config_set_id FROM configuration_sets WHERE is_active=1").first<{ config_set_id: string }>())?.config_set_id).toBe('config-test-1')
    expect((await request('/api/admin/config/configuration-sets/config-2026-07-v1/activate', { method: 'POST', body: { confirmConfigSetId: 'config-2026-07-v1' } })).status).toBe(200)
    expect((await db.prepare("SELECT config_set_id FROM configuration_sets WHERE is_active=1").first<{ config_set_id: string }>())?.config_set_id).toBe('config-2026-07-v1')
  })
})
