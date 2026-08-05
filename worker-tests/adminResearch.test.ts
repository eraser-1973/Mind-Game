import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { Miniflare } from 'miniflare'
import { createPasswordRecord } from '../worker/security/adminPassword'
import { strFromU8, unzipSync } from 'fflate'
import { createWorkerRuntime } from './runtime'

const origin = 'https://example.test'
const username = 'research.admin'
const password = 'Synthetic research password 123!'
let runtime: Miniflare
let db: D1Database
let cookie = ''
let csrf = ''

function responseCookies(response: { headers: { get(name: string): string | null } }): string {
  const headers = response.headers as { get(name: string): string | null; getSetCookie?: () => string[] }
  return headers.getSetCookie?.().join('\n') ?? headers.get('set-cookie') ?? ''
}

async function request(path: string, options: { method?: string; body?: unknown; key?: string; csrfEnabled?: boolean; origin?: string; cookieValue?: string } = {}) {
  const headers = new Headers({ Origin: options.origin ?? origin })
  if (options.cookieValue ?? cookie) headers.set('Cookie', options.cookieValue ?? cookie)
  if (options.body !== undefined) headers.set('Content-Type', 'application/json')
  if ((options.method ?? 'GET') !== 'GET') {
    headers.set('X-CSRF-Token', options.csrfEnabled === false ? '' : csrf)
    if (path.includes('bulk-delete') || (options.method === 'DELETE')) headers.set('Idempotency-Key', options.key ?? crypto.randomUUID())
  }
  return runtime.dispatchFetch(`${origin}${path}`, { method: options.method ?? 'GET', headers: Object.fromEntries(headers.entries()), body: options.body === undefined ? undefined : JSON.stringify(options.body) })
}

async function seedSession(fullName: string, phone: string) {
  const participantId = crypto.randomUUID(); const sessionId = crypto.randomUUID(); const now = '2026-08-05T01:00:00.000Z'
  await db.batch([
    db.prepare('INSERT INTO participants (participant_id,created_at) VALUES (?,?)').bind(participantId, now),
    db.prepare('INSERT INTO participant_identity (participant_id,full_name,student_id,student_id_normalized,phone,phone_normalized,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)').bind(participantId, fullName, '20260001', '20260001', phone, phone, now, now),
    db.prepare(`INSERT INTO sessions (session_id,participant_id,creation_key,mode,config_set_id,task_version,material_version,point_rule_version,sunk_cost_rule_version,scoring_version,benchmark_version,norm_version,reliability_version,candidate_display_order,initial_opened_candidate,completion_status,current_step,final_submit_mode,client_version,created_at,started_at,deadline_at,ended_at)
      VALUES (?,?,?,'formal','config-2026-07-v1','task-1.0.0','material-1.0.0','points-5-v1','sunk-1.0.0','RDI-2.0-prepilot','benchmark-1.0.0',NULL,NULL,json('["A","B","C","D","E"]'),'A','completed','completed','active',NULL,?,?,?,?)`).bind(sessionId, participantId, crypto.randomUUID(), now, now, '2026-08-05T01:15:00.000Z', '2026-08-05T01:15:00.000Z'),
    db.prepare(`INSERT INTO consent_records (consent_id,event_id,session_id,consent_version,accepted,client_accepted_at,server_accepted_at) VALUES (?,?,?,?,1,?,?)`).bind(crypto.randomUUID(), crypto.randomUUID(), sessionId, 'consent-1', now, now),
    db.prepare(`INSERT INTO game_events (event_id,session_id,event_type,candidate_id,stage,client_sequence,server_sequence,client_at,server_at,payload_json) VALUES (?,?,'game_start',NULL,NULL,1,1,?,?,json('{}'))`).bind(crypto.randomUUID(), sessionId, now, now),
  ])
  return { participantId, sessionId }
}

beforeAll(async () => {
  const created = await createWorkerRuntime(); runtime = created.runtime; db = created.db
  const record = await createPasswordRecord(password); const now = '2026-08-05T00:00:00.000Z'
  await db.prepare(`INSERT INTO admin_users (singleton_id,admin_user_id,username,username_normalized,password_algorithm,password_iterations,password_salt_base64,password_hash_base64,password_version,auth_policy_version,is_active,created_at,password_updated_at) VALUES (1,?,?,?,?,?,?,?,1,'admin-auth-1.0.0',1,?,?)`).bind('10000000-0000-4000-8000-000000000001', username, username, record.passwordAlgorithm, record.passwordIterations, record.passwordSaltBase64, record.passwordHashBase64, now, now).run()
  const login = await runtime.dispatchFetch(`${origin}/api/admin/login`, { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify({ username, password }) })
  const values = responseCookies(login); const admin = values.match(/mg_admin=([^;]+)/)?.[1]; csrf = values.match(/mg_admin_csrf=([^;]+)/)?.[1] ?? ''; cookie = `mg_admin=${admin}; mg_admin_csrf=${csrf}`
})

afterAll(async () => runtime.dispose())

describe('research data collection administrator APIs', () => {
  it('requires administrator authentication and protects writes with CSRF and same-origin checks', async () => {
    expect((await request('/api/admin/research/sessions', { cookieValue: '' })).status).toBe(401)
    expect((await request('/api/admin/research/sessions', { cookieValue: 'mg_session=participant-token' })).status).toBe(401)
    const session = await seedSession('Tester', '13800138000')
    expect((await request(`/api/admin/research/sessions/${session.sessionId}`, { method: 'DELETE', body: { confirmation: `DELETE SESSION ${session.sessionId}`, reasonCode: 'test' }, csrfEnabled: false })).status).toBe(403)
    expect((await request(`/api/admin/research/sessions/${session.sessionId}`, { method: 'DELETE', body: { confirmation: `DELETE SESSION ${session.sessionId}`, reasonCode: 'test' }, origin: 'https://evil.test' })).status).toBe(403)
  })

  it('lists masked records and exports formula-safe CSV ZIP without secrets', async () => {
    const session = await seedSession('=FORMULA', '13800138000')
    const listed = await request('/api/admin/research/sessions?pageSize=50')
    const body = await listed.json() as { data: { items: Array<{ sessionId: string; identity: { phone: string } }> } }
    expect(body.data.items.find((item) => item.sessionId === session.sessionId)?.identity.phone).toBe('*******8000')
    const exported = await request('/api/admin/research/exports', { method: 'POST', body: {} })
    expect(exported.status).toBe(200); expect(exported.headers.get('content-type')).toBe('application/zip'); expect(exported.headers.get('cache-control')).toBe('no-store')
    const archive = unzipSync(new Uint8Array(await exported.arrayBuffer()))
    expect(Object.keys(archive)).toEqual(expect.arrayContaining(['sessions.csv', 'participant_identity.csv', 'derived_metrics.csv']))
    const sessionsCsv = strFromU8(archive['sessions.csv']); expect(sessionsCsv).toContain("'=FORMULA"); expect(sessionsCsv).not.toMatch(/password|csrf|mg_admin/i)
  })

  it('returns an administrator-only formal report with null metrics instead of invented scores', async () => {
    const session = await seedSession('Report session', '13100131000')
    const response = await request(`/api/admin/research/sessions/${session.sessionId}/report`)
    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('no-store')
    const body = await response.json() as { data: Record<string, unknown> }
    expect(body.data).toMatchObject({
      sessionSummary: { sessionId: session.sessionId, status: 'completed' },
      stageChoices: { t1: null, t2: null, t3: null },
      finalDecision: null,
      pointSummary: null,
      derivedMetrics: expect.any(Array),
    })
    expect(JSON.stringify(body)).not.toMatch(/fullName|studentId|phone|password|csrf|token/i)
  })

  it('deletes only selected sessions, writes non-PII tombstones, and replays idempotently', async () => {
    const target = await seedSession('Delete target', '13900139000'); const survivor = await seedSession('Survivor', '13700137000'); const key = crypto.randomUUID(); const body = { confirmation: `DELETE SESSION ${target.sessionId}`, reasonCode: 'test_delete' }
    expect((await request(`/api/admin/research/sessions/${target.sessionId}`, { method: 'DELETE', body, key })).status).toBe(200)
    expect((await request(`/api/admin/research/sessions/${target.sessionId}`, { method: 'DELETE', body, key })).status).toBe(200)
    expect(await db.prepare('SELECT session_id FROM sessions WHERE session_id=?').bind(target.sessionId).first()).toBeNull()
    expect(await db.prepare('SELECT session_id FROM sessions WHERE session_id=?').bind(survivor.sessionId).first()).not.toBeNull()
    expect(await db.prepare('SELECT participant_id FROM participant_identity WHERE participant_id=?').bind(target.participantId).first()).toBeNull()
    const tombstone = await db.prepare('SELECT deleted_entity_hash,deletion_scope,reason_code FROM deletion_tombstones ORDER BY deleted_at DESC LIMIT 1').first<Record<string, unknown>>()
    expect(tombstone).toMatchObject({ deletion_scope: 'single_session', reason_code: 'test_delete' }); expect(JSON.stringify(tombstone)).not.toContain(target.sessionId)
  })

  it('bulk deletes no more than its selected sessions', async () => {
    const first = await seedSession('Bulk one', '13600136000'); const second = await seedSession('Bulk two', '13500135000'); const survivor = await seedSession('Bulk survivor', '13400134000')
    const body = { sessionIds: [first.sessionId, second.sessionId], confirmation: 'DELETE 2 SESSIONS', reasonCode: 'test_bulk' }
    expect((await request('/api/admin/research/sessions/bulk-delete', { method: 'POST', body })).status).toBe(200)
    expect(await db.prepare('SELECT session_id FROM sessions WHERE session_id=?').bind(first.sessionId).first()).toBeNull(); expect(await db.prepare('SELECT session_id FROM sessions WHERE session_id=?').bind(second.sessionId).first()).toBeNull(); expect(await db.prepare('SELECT session_id FROM sessions WHERE session_id=?').bind(survivor.sessionId).first()).not.toBeNull()
  })
})
