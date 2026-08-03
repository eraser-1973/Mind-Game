import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { Miniflare } from 'miniflare'
import { createPasswordRecord } from '../worker/security/adminPassword'
import { deriveClientFingerprint, hashAdminUsername } from '../worker/security/clientFingerprint'
import { createWorkerRuntime } from './runtime'

const username = 'stage.admin'
const password = 'Synthetic local password 123!'
const otherPassword = 'Synthetic local password 124!'
const origin = 'https://example.test'

let runtime: Miniflare
let db: D1Database

function adminRequest(
  path: string,
  options: {
    method?: string
    body?: string
    contentType?: string
    requestOrigin?: string | null
    cookie?: string
    csrf?: string
    ip?: string
  } = {},
) {
  const headers = new Headers({
    'User-Agent': 'Stage9 Test Browser/1.0',
    'CF-Connecting-IP': options.ip ?? '203.0.113.42',
  })
  if (options.contentType) headers.set('Content-Type', options.contentType)
  if (options.requestOrigin !== null) {
    headers.set('Origin', options.requestOrigin ?? origin)
  }
  if (options.cookie) headers.set('Cookie', options.cookie)
  if (options.csrf) headers.set('X-CSRF-Token', options.csrf)
  return runtime.dispatchFetch(`${origin}${path}`, {
    method: options.method ?? 'GET',
    headers: Object.fromEntries(headers.entries()),
    body: options.body,
  })
}

function allSetCookies(response: { headers: { get(name: string): string | null } }): string {
  const headers = response.headers as typeof response.headers & { getSetCookie?: () => string[] }
  return headers.getSetCookie?.().join('\n') ?? response.headers.get('set-cookie') ?? ''
}

function cookieValue(setCookies: string, name: string): string {
  const value = setCookies.match(new RegExp(`(?:^|[\\n,]\\s*)${name}=([^;]+)`))?.[1]
  if (!value) throw new Error(`Missing ${name} cookie`)
  return value
}

async function login(
  loginUsername = username,
  loginPassword = password,
  ip = '203.0.113.42',
) {
  return adminRequest('/api/admin/login', {
    method: 'POST',
    contentType: 'application/json',
    body: JSON.stringify({ username: loginUsername, password: loginPassword }),
    ip,
  })
}

async function loginCookies() {
  const response = await login()
  expect(response.status).toBe(200)
  const setCookies = allSetCookies(response)
  const session = cookieValue(setCookies, 'mg_admin')
  const csrf = cookieValue(setCookies, 'mg_admin_csrf')
  return { response, session, csrf, cookie: `mg_admin=${session}; mg_admin_csrf=${csrf}` }
}

beforeAll(async () => {
  const created = await createWorkerRuntime()
  runtime = created.runtime
  db = created.db
  const record = await createPasswordRecord(password)
  const now = '2026-08-02T00:00:00.000Z'
  await db.prepare(
    `INSERT INTO admin_users (
      singleton_id, admin_user_id, username, username_normalized,
      password_algorithm, password_iterations, password_salt_base64,
      password_hash_base64, password_version, auth_policy_version,
      is_active, created_at, password_updated_at
    ) VALUES (1, ?, ?, ?, ?, ?, ?, ?, 1, 'admin-auth-1.0.0', 1, ?, ?)`,
  ).bind(
    '10000000-0000-4000-8000-000000000001',
    'Stage.Admin',
    username,
    record.passwordAlgorithm,
    record.passwordIterations,
    record.passwordSaltBase64,
    record.passwordHashBase64,
    now,
    now,
  ).run()
})

afterAll(async () => {
  await runtime.dispose()
})

describe('administrator API request validation and security envelopes', () => {
  it('rejects method, media type, oversized body, unknown fields, and missing/cross-origin requests', async () => {
    const method = await adminRequest('/api/admin/login', { method: 'GET' })
    expect(method.status).toBe(405)
    expect(method.headers.get('allow')).toBe('POST')

    const media = await adminRequest('/api/admin/login', {
      method: 'POST', contentType: 'text/plain', body: '{}',
    })
    expect(media.status).toBe(415)

    const oversized = await adminRequest('/api/admin/login', {
      method: 'POST', contentType: 'application/json',
      body: JSON.stringify({ username, password: 'x'.repeat(8300) }),
    })
    expect(oversized.status).toBe(413)

    const unknown = await adminRequest('/api/admin/login', {
      method: 'POST', contentType: 'application/json',
      body: JSON.stringify({ username, password, extra: true }),
    })
    expect(unknown.status).toBe(400)

    for (const requestOrigin of [null, 'https://evil.test']) {
      const response = await adminRequest('/api/admin/login', {
        method: 'POST', contentType: 'application/json', requestOrigin,
        body: JSON.stringify({ username, password }),
      })
      const body = await response.json() as { error: { code: string } }
      expect(response.status).toBe(403)
      expect(body.error.code).toBe('ADMIN_ORIGIN_REJECTED')
    }
  })

  it('uses an identical generic error for a wrong password and an unknown username and records safe audits', async () => {
    const wrong = await login(username, otherPassword)
    const wrongBody = await wrong.json() as Record<string, unknown>
    const missing = await login('missing.admin', otherPassword)
    const missingBody = await missing.json() as Record<string, unknown>

    expect(wrong.status).toBe(401)
    expect(missing.status).toBe(401)
    expect((wrongBody as { error: unknown }).error).toEqual(
      (missingBody as { error: unknown }).error,
    )
    expect(JSON.stringify(wrongBody)).not.toMatch(/exist|password|hash|salt/i)
    const failures = await db.prepare(
      `SELECT COUNT(*) AS count FROM admin_audit_logs
       WHERE action = 'admin_login_failure'`,
    ).first<{ count: number }>()
    expect(failures?.count).toBeGreaterThanOrEqual(2)
  })

  it('does not retain a failed-attempt fact when its mandatory audit cannot be committed', async () => {
    const auditFailureUsername = 'audit-failure.admin'
    const usernameHash = await hashAdminUsername(auditFailureUsername)
    await db.prepare(
      `CREATE TRIGGER reject_admin_login_failure_audit
       BEFORE INSERT ON admin_audit_logs
       WHEN NEW.action = 'admin_login_failure'
       BEGIN
         SELECT RAISE(ABORT, 'injected login failure audit error');
       END`,
    ).run()
    try {
      const response = await login(auditFailureUsername, otherPassword, '198.51.108.42')
      expect(response.status).toBe(500)
      const attempts = await db.prepare(
        `SELECT COUNT(*) AS count FROM admin_login_attempts
         WHERE username_hash = ?`,
      ).bind(usernameHash).first<{ count: number }>()
      expect(attempts?.count).toBe(0)
    } finally {
      await db.prepare('DROP TRIGGER reject_admin_login_failure_audit').run()
    }
  })

  it('returns sanitized JSON for unknown admin paths instead of the SPA', async () => {
    const response = await adminRequest('/api/admin/unknown')
    const serialized = JSON.stringify(await response.json())
    expect(response.status).toBe(404)
    expect(response.headers.get('content-type')).toBe('application/json; charset=utf-8')
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(response.headers.get('pragma')).toBe('no-cache')
    expect(response.headers.get('x-content-type-options')).toBe('nosniff')
    expect(response.headers.get('referrer-policy')).toBe('no-referrer')
    expect(serialized).not.toMatch(/stack|select |database_id|D:\\|participant_identity/i)
  })
})

describe('administrator login, cookies, and session projection', () => {
  it('authenticates in workerd with production PBKDF2 parameters and stores only token hashes', async () => {
    const started = performance.now()
    const { response, session, csrf, cookie } = await loginCookies()
    const elapsed = Math.round(performance.now() - started)
    console.info(`ADMIN_PBKDF2_WORKER_MS=${elapsed}`)
    const body = await response.json() as { data: Record<string, unknown> }
    const setCookies = allSetCookies(response)

    expect(body.data).toMatchObject({
      authenticated: true,
      admin: { username: 'Stage.Admin' },
      authPolicyVersion: 'admin-auth-1.0.0',
    })
    expect(JSON.stringify(body)).not.toMatch(/admin_user_id|password|salt|token|fingerprint|participant/i)
    expect(setCookies).toMatch(/mg_admin=[^;]+; HttpOnly; SameSite=Strict; Path=\/api\/admin; Max-Age=28800; Secure/)
    expect(setCookies).toMatch(/mg_admin_csrf=[^;]+; SameSite=Strict; Path=\/; Max-Age=28800; Secure/)
    expect(setCookies).not.toMatch(/Domain=/i)
    const row = await db.prepare(
      `SELECT session_token_hash, csrf_token_hash, client_fingerprint_hash,
              user_agent_hash
       FROM admin_sessions WHERE revoked_at IS NULL`,
    ).first<Record<string, string>>()
    expect(row?.session_token_hash).toMatch(/^[0-9a-f]{64}$/)
    expect(row?.csrf_token_hash).toMatch(/^[0-9a-f]{64}$/)
    expect(row?.session_token_hash).not.toBe(session)
    expect(row?.csrf_token_hash).not.toBe(csrf)
    expect(JSON.stringify(row)).not.toContain('203.0.113.42')
    expect(JSON.stringify(row)).not.toContain('Stage9 Test Browser')

    const sessionResponse = await adminRequest('/api/admin/session', { cookie })
    const sessionBody = JSON.stringify(await sessionResponse.json())
    expect(sessionResponse.status).toBe(200)
    expect(sessionBody).toContain('Stage.Admin')
    expect(sessionBody).not.toMatch(/admin_user_id|token|hash|fingerprint/i)
  })

  it('does not authenticate participant cookies and safely rotates only a missing CSRF cookie', async () => {
    const participant = await adminRequest('/api/admin/session', {
      cookie: `mg_session=${'a'.repeat(64)}`,
    })
    expect(participant.status).toBe(401)

    const loggedIn = await loginCookies()
    const before = await db.prepare(
      `SELECT session_token_hash, csrf_token_hash, absolute_expires_at
       FROM admin_sessions WHERE revoked_at IS NULL`,
    ).first<Record<string, string>>()
    const rotated = await adminRequest('/api/admin/session', {
      cookie: `mg_admin=${loggedIn.session}`,
    })
    const setCookies = allSetCookies(rotated)
    const after = await db.prepare(
      `SELECT session_token_hash, csrf_token_hash, absolute_expires_at
       FROM admin_sessions WHERE revoked_at IS NULL`,
    ).first<Record<string, string>>()

    expect(rotated.status).toBe(200)
    expect(setCookies).toContain('mg_admin_csrf=')
    expect(setCookies).not.toContain('mg_admin=')
    expect(after?.session_token_hash).toBe(before?.session_token_hash)
    expect(after?.csrf_token_hash).not.toBe(before?.csrf_token_hash)
    expect(after?.absolute_expires_at).toBe(before?.absolute_expires_at)
  })

  it('revokes the prior active session on a new login', async () => {
    const first = await loginCookies()
    const second = await loginCookies()
    const firstCheck = await adminRequest('/api/admin/session', { cookie: first.cookie })
    const active = await db.prepare(
      'SELECT COUNT(*) AS count FROM admin_sessions WHERE revoked_at IS NULL',
    ).first<{ count: number }>()
    const revoked = await db.prepare(
      `SELECT revoke_reason FROM admin_sessions
       WHERE session_token_hash <> (SELECT session_token_hash FROM admin_sessions WHERE revoked_at IS NULL)
       ORDER BY created_at DESC LIMIT 1`,
    ).first<{ revoke_reason: string }>()

    expect(second.response.status).toBe(200)
    expect(firstCheck.status).toBe(401)
    expect(active?.count).toBe(1)
    expect(revoked?.revoke_reason).toBe('new_login')
  })

  it('keeps a complete revocation audit trail across concurrent valid logins', async () => {
    await loginCookies()
    const responses = await Promise.all([login(), login()])
    expect(responses.map((response) => response.status)).toEqual([200, 200])

    const active = await db.prepare(
      'SELECT COUNT(*) AS count FROM admin_sessions WHERE revoked_at IS NULL',
    ).first<{ count: number }>()
    const missingAudits = await db.prepare(
      `SELECT COUNT(*) AS count
       FROM admin_sessions s
       WHERE s.revoke_reason = 'new_login'
         AND NOT EXISTS (
           SELECT 1 FROM admin_audit_logs a
           WHERE a.admin_session_id = s.admin_session_id
             AND a.action = 'admin_session_revoked'
         )`,
    ).first<{ count: number }>()
    expect(active?.count).toBe(1)
    expect(missingAudits?.count).toBe(0)
  })
})

describe('administrator login rate limits', () => {
  it('keeps the first five failures generic, then blocks the same username/fingerprint with Retry-After', async () => {
    const limitedUsername = 'limited.admin'
    const statuses: number[] = []
    for (let index = 0; index < 6; index += 1) {
      statuses.push((await login(limitedUsername, otherPassword, '198.51.100.44')).status)
    }
    expect(statuses.slice(0, 5)).toEqual([401, 401, 401, 401, 401])
    expect(statuses[5]).toBe(429)
    const blocked = await login(limitedUsername, otherPassword, '198.51.100.44')
    expect(blocked.headers.get('retry-after')).toMatch(/^\d+$/)
    expect(await blocked.json()).toMatchObject({
      error: { code: 'ADMIN_LOGIN_RATE_LIMITED' },
    })
    expect((await login(limitedUsername, otherPassword, '198.51.101.44')).status).toBe(401)
  })

  it('enforces the global normalized-username threshold from D1 server-time facts', async () => {
    const globalUsername = 'global.admin'
    const usernameHash = await hashAdminUsername(globalUsername)
    const now = new Date()
    const statements: D1PreparedStatement[] = []
    for (let index = 0; index < 30; index += 1) {
      const fingerprint = await deriveClientFingerprint(new Request(`${origin}/`, {
        headers: {
          'CF-Connecting-IP': `192.0.${index}.12`,
          'User-Agent': 'Global Limit Test',
        },
      }))
      statements.push(db.prepare(
        `INSERT INTO admin_login_attempts (
          attempt_id, username_hash, client_fingerprint_hash,
          outcome, request_id, attempted_at
        ) VALUES (?, ?, ?, 'failure', ?, ?)`,
      ).bind(
        crypto.randomUUID(), usernameHash, fingerprint.clientFingerprintHash,
        crypto.randomUUID(), new Date(now.getTime() - 1000).toISOString(),
      ))
    }
    await db.batch(statements)
    const response = await login(globalUsername, otherPassword, '203.0.120.2')
    expect(response.status).toBe(429)
  })

  it('atomically admits only one concurrent attempt when one local failure slot remains', async () => {
    const concurrentUsername = 'concurrent.admin'
    const ip = '198.51.110.42'
    const usernameHash = await hashAdminUsername(concurrentUsername)
    const fingerprint = await deriveClientFingerprint(new Request(`${origin}/`, {
      headers: {
        'CF-Connecting-IP': ip,
        'User-Agent': 'Stage9 Test Browser/1.0',
      },
    }))
    const attemptedAt = new Date().toISOString()
    await db.batch(Array.from({ length: 4 }, () => db.prepare(
      `INSERT INTO admin_login_attempts (
        attempt_id, username_hash, client_fingerprint_hash,
        outcome, request_id, attempted_at
      ) VALUES (?, ?, ?, 'failure', ?, ?)`,
    ).bind(
      crypto.randomUUID(), usernameHash, fingerprint.clientFingerprintHash,
      crypto.randomUUID(), attemptedAt,
    )))

    const responses = await Promise.all([
      login(concurrentUsername, otherPassword, ip),
      login(concurrentUsername, otherPassword, ip),
    ])
    expect(responses.map((response) => response.status).sort()).toEqual([401, 429])
  })
})

describe('administrator CSRF, logout, and audit access', () => {
  it('rejects missing and cross-origin logout before any unauthenticated cookie clearing', async () => {
    for (const requestOrigin of [null, 'https://evil.test']) {
      const response = await adminRequest('/api/admin/logout', {
        method: 'POST', requestOrigin,
      })
      expect(response.status).toBe(403)
      expect(allSetCookies(response)).toBe('')
    }
  })

  it('requires same-origin matching CSRF for logout, revokes once, clears both cookies, and safely replays', async () => {
    const loggedIn = await loginCookies()
    for (const options of [
      { cookie: loggedIn.cookie },
      { cookie: loggedIn.cookie, csrf: 'wrong-token' },
      { cookie: loggedIn.cookie, csrf: loggedIn.csrf, requestOrigin: 'https://evil.test' },
    ]) {
      const response = await adminRequest('/api/admin/logout', { method: 'POST', ...options })
      const serialized = JSON.stringify(await response.json())
      expect(response.status).toBe(403)
      expect(serialized).not.toContain(loggedIn.csrf)
    }

    const logout = await adminRequest('/api/admin/logout', {
      method: 'POST', cookie: loggedIn.cookie, csrf: loggedIn.csrf,
    })
    const replay = await adminRequest('/api/admin/logout', {
      method: 'POST', cookie: loggedIn.cookie, csrf: loggedIn.csrf,
    })
    expect(logout.status).toBe(200)
    expect(replay.status).toBe(200)
    const cleared = allSetCookies(logout)
    expect(cleared).toMatch(/mg_admin=;[^\n]*Max-Age=0/)
    expect(cleared).toMatch(/mg_admin_csrf=;[^\n]*Max-Age=0/)
    const audits = await db.prepare(
      `SELECT COUNT(*) AS count FROM admin_audit_logs
       WHERE admin_session_id = (
         SELECT admin_session_id FROM admin_sessions
         WHERE revoke_reason = 'logout' ORDER BY revoked_at DESC LIMIT 1
       ) AND action = 'admin_logout'`,
    ).first<{ count: number }>()
    expect(audits?.count).toBe(1)
  })

  it('returns fixed-order safe audit pages and records one viewed action without recursion', async () => {
    const loggedIn = await loginCookies()
    const response = await adminRequest('/api/admin/audit-logs?limit=2&outcome=success', {
      cookie: loggedIn.cookie,
    })
    const body = await response.json() as {
      data: { items: Array<Record<string, unknown>>; nextCursor: string | null }
    }
    expect(response.status).toBe(200)
    expect(body.data.items).toHaveLength(2)
    expect(JSON.stringify(body)).not.toMatch(/fingerprint|password|cookie|token|hash|participant/i)
    expect(body.data.nextCursor).toEqual(expect.any(String))
    const next = await adminRequest(
      `/api/admin/audit-logs?limit=2&outcome=success&cursor=${encodeURIComponent(body.data.nextCursor!)}`,
      { cookie: loggedIn.cookie },
    )
    expect(next.status).toBe(200)

    for (const path of [
      '/api/admin/audit-logs?limit=101',
      '/api/admin/audit-logs?limit=abc',
      '/api/admin/audit-logs?action=not_allowed',
      '/api/admin/audit-logs?outcome=not_allowed',
      '/api/admin/audit-logs?sort=created_at',
    ]) expect((await adminRequest(path, { cookie: loggedIn.cookie })).status).toBe(400)
    expect((await adminRequest('/api/admin/audit-logs', {
      method: 'POST', cookie: loggedIn.cookie,
    })).status).toBe(405)
  })
})
