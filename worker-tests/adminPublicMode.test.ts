import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { Miniflare } from 'miniflare'
import { createPasswordRecord } from '../worker/security/adminPassword'
import { createWorkerRuntime } from './runtime'

const origin = 'https://example.test'
const adminId = '10000000-0000-4000-8000-000000000009'
let runtime: Miniflare
let db: D1Database

async function request(
  path: string,
  options: { method?: string; body?: unknown; csrf?: string; cookie?: string; requestOrigin?: string | null; key?: string } = {},
) {
  const headers = new Headers()
  if (options.requestOrigin !== null) headers.set('Origin', options.requestOrigin ?? origin)
  if (options.body !== undefined) headers.set('Content-Type', 'application/json')
  if (options.csrf) headers.set('X-CSRF-Token', options.csrf)
  if (options.cookie) headers.set('Cookie', options.cookie)
  if (options.key) headers.set('Idempotency-Key', options.key)
  return runtime.dispatchFetch(`${origin}${path}`, {
    method: options.method ?? 'GET',
    headers: Object.fromEntries(headers.entries()),
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  })
}

type CookieHeaders = { get(name: string): string | null; getSetCookie?: () => string[] }

function setCookie(response: { headers: CookieHeaders }): string {
  const headers = response.headers
  return headers.getSetCookie?.().join('\n') ?? response.headers.get('set-cookie') ?? ''
}

function csrfFrom(response: { headers: CookieHeaders }): string {
  const token = setCookie(response).match(/mg_admin_csrf=([^;]+)/)?.[1]
  if (!token) throw new Error('Expected public CSRF cookie')
  return token
}

async function seedSingleton() {
  const password = await createPasswordRecord('Synthetic password 123!')
  const now = '2026-08-05T00:00:00.000Z'
  await db.prepare(`INSERT INTO admin_users (
    singleton_id,admin_user_id,username,username_normalized,password_algorithm,
    password_iterations,password_salt_base64,password_hash_base64,password_version,
    auth_policy_version,is_active,created_at,password_updated_at
  ) VALUES (1,?,?,?,?,?,?,?,1,'admin-auth-1.0.0',1,?,?)`).bind(
    adminId, 'retained.admin', 'retained.admin', password.passwordAlgorithm,
    password.passwordIterations, password.passwordSaltBase64,
    password.passwordHashBase64, now, now,
  ).run()
}

async function seedFormalSession() {
  const participantId = crypto.randomUUID()
  const sessionId = crypto.randomUUID()
  const now = '2026-08-05T00:00:00.000Z'
  await db.batch([
    db.prepare('INSERT INTO participants (participant_id,created_at) VALUES (?,?)').bind(participantId, now),
    db.prepare(`INSERT INTO participant_identity (
      participant_id,full_name,student_id,student_id_normalized,phone,phone_normalized,created_at,updated_at
    ) VALUES (?,?,?,?,?,?,?,?)`).bind(participantId, 'Synthetic', 'SMOKE-001', 'SMOKE-001', '13800138000', '13800138000', now, now),
    db.prepare(`INSERT INTO sessions (
      session_id,participant_id,creation_key,mode,config_set_id,task_version,material_version,
      point_rule_version,sunk_cost_rule_version,scoring_version,benchmark_version,norm_version,
      reliability_version,candidate_display_order,initial_opened_candidate,completion_status,
      current_step,final_submit_mode,client_version,created_at,started_at,deadline_at,ended_at
    ) VALUES (?,?,?,'formal','config-2026-07-v1','task-1.0.0','material-1.0.0',
      'points-5-v1','sunk-1.0.0','RDI-2.0-prepilot','benchmark-1.0.0',NULL,NULL,
      json('["A","B","C","D","E"]'),'A','completed','completed','active',NULL,?,?,?,?)`).bind(
      sessionId, participantId, crypto.randomUUID(), now, now,
      '2026-08-05T00:15:00.000Z', '2026-08-05T00:15:00.000Z',
    ),
  ])
  return { participantId, sessionId }
}

beforeEach(async () => {
  const created = await createWorkerRuntime({ bindings: { ADMIN_AUTH_MODE: 'public' } })
  runtime = created.runtime
  db = created.db
  await seedSingleton()
})

afterEach(async () => runtime.dispose())

describe('temporary public administrator mode', () => {
  it('allows a cookie-free public session without creating login or admin-session rows', async () => {
    const response = await request('/api/admin/session')
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      ok: true,
      data: { authenticated: true, authMode: 'public', username: 'public-admin' },
    })
    expect(setCookie(response)).toMatch(/mg_admin_csrf=/)
    expect(await db.prepare('SELECT COUNT(*) AS count FROM admin_sessions').first<{ count: number }>()).toEqual({ count: 0 })
    expect(await db.prepare('SELECT COUNT(*) AS count FROM admin_login_attempts').first<{ count: number }>()).toEqual({ count: 0 })
  })

  it('disables password login without running credential verification or login-attempt writes', async () => {
    const response = await request('/api/admin/login', {
      method: 'POST', body: { username: 'retained.admin', password: 'not-used' },
    })
    expect(response.status).toBe(410)
    expect(await response.json()).toMatchObject({ ok: false, error: { code: 'ADMIN_PASSWORD_LOGIN_DISABLED' } })
    expect(await db.prepare('SELECT COUNT(*) AS count FROM admin_login_attempts').first<{ count: number }>()).toEqual({ count: 0 })
  })

  it('keeps anonymous double-submit CSRF and same-origin protection for public writes', async () => {
    const session = await request('/api/admin/session')
    const csrf = csrfFrom(session)
    expect((await request('/api/admin/research/exports', { method: 'POST', body: {} })).status).toBe(403)
    expect((await request('/api/admin/research/exports', { method: 'POST', body: {}, csrf, requestOrigin: 'https://evil.test' })).status).toBe(403)
    const response = await request('/api/admin/research/exports', {
      method: 'POST', body: {}, csrf, cookie: `mg_admin_csrf=${csrf}`,
    })
    expect(response.status).toBe(200)
    const audit = await db.prepare(`SELECT metadata_json FROM admin_audit_logs WHERE action='research_data_exported'`).first<{ metadata_json: string }>()
    expect(audit?.metadata_json).toContain('public')
    expect(audit?.metadata_json).not.toMatch(/csrf|cookie|token/i)
  })

  it('permits public querying and an idempotent confirmed deletion only with the anonymous CSRF pair', async () => {
    const { sessionId } = await seedFormalSession()
    const session = await request('/api/admin/session')
    const csrf = csrfFrom(session)
    const cookie = `mg_admin_csrf=${csrf}`
    expect((await request('/api/admin/research/sessions')).status).toBe(200)
    const key = crypto.randomUUID()
    const body = { confirmation: `DELETE SESSION ${sessionId}`, reasonCode: 'public_mode_test' }
    const denied = await request(`/api/admin/research/sessions/${sessionId}`, {
      method: 'DELETE', body, key,
    })
    expect(denied.status).toBe(403)
    const deleted = await request(`/api/admin/research/sessions/${sessionId}`, {
      method: 'DELETE', body, key, csrf, cookie,
    })
    expect(deleted.status).toBe(200)
    const replay = await request(`/api/admin/research/sessions/${sessionId}`, {
      method: 'DELETE', body, key, csrf, cookie,
    })
    expect(replay.status).toBe(200)
    expect(await db.prepare('SELECT session_id FROM sessions WHERE session_id=?').bind(sessionId).first()).toBeNull()
    expect(await db.prepare('SELECT COUNT(*) AS count FROM deletion_tombstones').first<{ count: number }>()).toEqual({ count: 1 })
  })

  it('clears only the anonymous CSRF cookie on public logout without creating or revoking an administrator session', async () => {
    const session = await request('/api/admin/session')
    const csrf = csrfFrom(session)
    const response = await request('/api/admin/logout', {
      method: 'POST', csrf, cookie: `mg_admin_csrf=${csrf}`,
    })
    expect(response.status).toBe(200)
    expect(setCookie(response)).toMatch(/mg_admin_csrf=;[^\n]*Max-Age=0/)
    expect(setCookie(response)).not.toMatch(/mg_admin=/)
    expect(await db.prepare('SELECT COUNT(*) AS count FROM admin_sessions').first<{ count: number }>()).toEqual({ count: 0 })
  })

  it('returns a safe readiness error when the retained singleton administrator is absent', async () => {
    await db.prepare('DELETE FROM admin_users WHERE singleton_id=1').run()
    const response = await request('/api/admin/session')
    expect(response.status).toBe(503)
    expect(await response.json()).toMatchObject({ ok: false, error: { code: 'ADMIN_PUBLIC_MODE_NOT_READY' } })
  })
})
