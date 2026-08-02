import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { Miniflare } from 'miniflare'
import { authenticateAdmin, AdminAuthError } from '../worker/auth/adminAuth'
import type { Env } from '../worker/env'
import { hashAdminToken } from '../worker/security/adminCookies'
import { createWorkerRuntime } from './runtime'

let runtime: Miniflare
let db: D1Database
let env: Env
const adminUserId = '10000000-0000-4000-8000-000000000001'

function request(tokenName: 'mg_admin' | 'mg_session', token: string) {
  return new Request('https://example.test/api/admin/session', {
    headers: { Cookie: `${tokenName}=${token}` },
  })
}

async function insertSession(options: {
  token: string
  createdAt: string
  lastSeenAt: string
  idleExpiresAt: string
  absoluteExpiresAt: string
  passwordVersion?: number
  revokedAt?: string | null
  revokeReason?: string | null
}) {
  await db.prepare(
    `UPDATE admin_sessions
     SET revoked_at = COALESCE(revoked_at, ?),
         revoke_reason = COALESCE(revoke_reason, 'security_revoked')
     WHERE revoked_at IS NULL`,
  ).bind(options.createdAt).run()
  const id = crypto.randomUUID()
  await db.prepare(
    `INSERT INTO admin_sessions (
      admin_session_id, admin_user_id, session_token_hash, csrf_token_hash,
      password_version, auth_policy_version, client_fingerprint_hash,
      user_agent_hash, created_at, last_seen_at, idle_expires_at,
      absolute_expires_at, revoked_at, revoke_reason
    ) VALUES (?, ?, ?, ?, ?, 'admin-auth-1.0.0', ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(
    id,
    adminUserId,
    await hashAdminToken(options.token),
    'b'.repeat(64),
    options.passwordVersion ?? 1,
    'c'.repeat(64),
    'd'.repeat(64),
    options.createdAt,
    options.lastSeenAt,
    options.idleExpiresAt,
    options.absoluteExpiresAt,
    options.revokedAt ?? null,
    options.revokeReason ?? null,
  ).run()
  return id
}

beforeAll(async () => {
  const created = await createWorkerRuntime()
  runtime = created.runtime
  db = created.db
  env = { DB: db, ASSETS: {} as Fetcher }
  const now = '2026-08-02T00:00:00.000Z'
  await db.prepare(
    `INSERT INTO admin_users (
      singleton_id, admin_user_id, username, username_normalized,
      password_algorithm, password_iterations, password_salt_base64,
      password_hash_base64, password_version, auth_policy_version,
      is_active, created_at, password_updated_at
    ) VALUES (1, ?, 'Stage.Admin', 'stage.admin', 'PBKDF2-SHA256',
      600000, ?, ?, 1, 'admin-auth-1.0.0', 1, ?, ?)`,
  ).bind(
    adminUserId,
    'AAAAAAAAAAAAAAAAAAAAAA==',
    'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=',
    now,
    now,
  ).run()
})

afterAll(async () => runtime.dispose())

describe('administrator authentication middleware', () => {
  it('rejects missing, wrong, participant, revoked, and password-version-mismatched credentials', async () => {
    await expect(authenticateAdmin(
      new Request('https://example.test/api/admin/session'), env,
    )).rejects.toMatchObject({ code: 'ADMIN_UNAUTHORIZED' })
    await expect(authenticateAdmin(request('mg_admin', 'x'.repeat(43)), env))
      .rejects.toMatchObject({ code: 'ADMIN_UNAUTHORIZED' })
    await expect(authenticateAdmin(request('mg_session', 'a'.repeat(64)), env))
      .rejects.toMatchObject({ code: 'ADMIN_UNAUTHORIZED' })

    const revokedToken = 'A'.repeat(43)
    await insertSession({
      token: revokedToken,
      createdAt: '2026-08-02T00:00:00.000Z',
      lastSeenAt: '2026-08-02T00:00:00.000Z',
      idleExpiresAt: '2026-08-02T00:30:00.000Z',
      absoluteExpiresAt: '2026-08-02T08:00:00.000Z',
      revokedAt: '2026-08-02T00:01:00.000Z',
      revokeReason: 'logout',
    })
    await expect(authenticateAdmin(request('mg_admin', revokedToken), env))
      .rejects.toMatchObject({ code: 'ADMIN_SESSION_REVOKED' })

    const staleToken = 'B'.repeat(43)
    await insertSession({
      token: staleToken,
      passwordVersion: 2,
      createdAt: '2026-08-02T00:00:00.000Z',
      lastSeenAt: '2026-08-02T00:00:00.000Z',
      idleExpiresAt: '2026-08-02T00:30:00.000Z',
      absoluteExpiresAt: '2026-08-02T08:00:00.000Z',
    })
    await expect(authenticateAdmin(request('mg_admin', staleToken), env, {
      now: new Date('2026-08-02T00:05:00.000Z'),
    })).rejects.toMatchObject({ code: 'ADMIN_UNAUTHORIZED' })
  })

  it('revokes idle expiry and writes its audit only once', async () => {
    const token = 'C'.repeat(43)
    const sessionId = await insertSession({
      token,
      createdAt: '2026-08-02T00:00:00.000Z',
      lastSeenAt: '2026-08-02T00:01:00.000Z',
      idleExpiresAt: '2026-08-02T00:31:00.000Z',
      absoluteExpiresAt: '2026-08-02T08:00:00.000Z',
    })
    const now = new Date('2026-08-02T00:32:00.000Z')
    await expect(authenticateAdmin(request('mg_admin', token), env, { now }))
      .rejects.toMatchObject({ code: 'ADMIN_SESSION_EXPIRED' })
    await expect(authenticateAdmin(request('mg_admin', token), env, { now }))
      .rejects.toBeInstanceOf(AdminAuthError)
    const audits = await db.prepare(
      `SELECT COUNT(*) AS count FROM admin_audit_logs
       WHERE admin_session_id = ? AND action = 'admin_session_idle_expired'`,
    ).bind(sessionId).first<{ count: number }>()
    expect(audits?.count).toBe(1)
  })

  it('revokes absolute expiry, audits once, and never extends the absolute timestamp', async () => {
    const token = 'D'.repeat(43)
    const sessionId = await insertSession({
      token,
      createdAt: '2026-08-02T00:00:00.000Z',
      lastSeenAt: '2026-08-02T07:40:00.000Z',
      idleExpiresAt: '2026-08-02T08:10:00.000Z',
      absoluteExpiresAt: '2026-08-02T08:00:00.000Z',
    })
    const now = new Date('2026-08-02T08:01:00.000Z')
    await expect(authenticateAdmin(request('mg_admin', token), env, { now }))
      .rejects.toMatchObject({ code: 'ADMIN_SESSION_EXPIRED' })
    await expect(authenticateAdmin(request('mg_admin', token), env, { now }))
      .rejects.toBeInstanceOf(AdminAuthError)
    const row = await db.prepare(
      `SELECT absolute_expires_at, revoke_reason FROM admin_sessions
       WHERE admin_session_id = ?`,
    ).bind(sessionId).first<Record<string, string>>()
    const audits = await db.prepare(
      `SELECT COUNT(*) AS count FROM admin_audit_logs
       WHERE admin_session_id = ? AND action = 'admin_session_absolute_expired'`,
    ).bind(sessionId).first<{ count: number }>()
    expect(row).toMatchObject({
      absolute_expires_at: '2026-08-02T08:00:00.000Z',
      revoke_reason: 'absolute_expired',
    })
    expect(audits?.count).toBe(1)
  })

  it('rolls back expiry revocation when its mandatory audit cannot be written', async () => {
    const token = 'F'.repeat(43)
    const sessionId = await insertSession({
      token,
      createdAt: '2026-08-02T00:00:00.000Z',
      lastSeenAt: '2026-08-02T00:01:00.000Z',
      idleExpiresAt: '2026-08-02T00:31:00.000Z',
      absoluteExpiresAt: '2026-08-02T08:00:00.000Z',
    })
    await db.prepare(
      `CREATE TRIGGER reject_idle_expiry_audit
       BEFORE INSERT ON admin_audit_logs
       WHEN NEW.action = 'admin_session_idle_expired'
       BEGIN SELECT RAISE(ABORT, 'injected audit failure'); END`,
    ).run()
    try {
      await expect(authenticateAdmin(request('mg_admin', token), env, {
        now: new Date('2026-08-02T00:32:00.000Z'),
      })).rejects.toThrow(/injected audit failure/i)
    } finally {
      await db.prepare('DROP TRIGGER reject_idle_expiry_audit').run()
    }
    const row = await db.prepare(
      `SELECT revoked_at, revoke_reason FROM admin_sessions
       WHERE admin_session_id = ?`,
    ).bind(sessionId).first<{ revoked_at: string | null; revoke_reason: string | null }>()
    expect(row).toEqual({ revoked_at: null, revoke_reason: null })
  })

  it('throttles last_seen writes for five minutes and caps idle expiry at absolute expiry', async () => {
    const token = 'E'.repeat(43)
    const sessionId = await insertSession({
      token,
      createdAt: '2026-08-02T00:00:00.000Z',
      lastSeenAt: '2026-08-02T00:01:00.000Z',
      idleExpiresAt: '2026-08-02T00:39:00.000Z',
      absoluteExpiresAt: '2026-08-02T00:40:00.000Z',
    })
    await authenticateAdmin(request('mg_admin', token), env, {
      now: new Date('2026-08-02T00:05:59.000Z'),
    })
    const untouched = await db.prepare(
      'SELECT last_seen_at FROM admin_sessions WHERE admin_session_id = ?',
    ).bind(sessionId).first<{ last_seen_at: string }>()
    expect(untouched?.last_seen_at).toBe('2026-08-02T00:01:00.000Z')

    await authenticateAdmin(request('mg_admin', token), env, {
      now: new Date('2026-08-02T00:36:00.000Z'),
    })
    const touched = await db.prepare(
      `SELECT last_seen_at, idle_expires_at, absolute_expires_at
       FROM admin_sessions WHERE admin_session_id = ?`,
    ).bind(sessionId).first<Record<string, string>>()
    expect(touched).toMatchObject({
      last_seen_at: '2026-08-02T00:36:00.000Z',
      idle_expires_at: '2026-08-02T00:40:00.000Z',
      absolute_expires_at: '2026-08-02T00:40:00.000Z',
    })
  })
})
