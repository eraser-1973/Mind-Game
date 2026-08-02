import { afterEach, describe, expect, it } from 'vitest'
import type { Miniflare } from 'miniflare'
import { replaceActiveAdminSession } from '../worker/routes/adminLogin'
import { createPasswordRecord } from '../worker/security/adminPassword'
import { hashAdminUsername } from '../worker/security/clientFingerprint'
import { createWorkerRuntime } from './runtime'

let runtime: Miniflare | undefined

afterEach(async () => {
  await runtime?.dispose()
  runtime = undefined
})

describe('administrator login concurrency gate', () => {
  it('does not create a successful session after concurrent failures fill the limit', async () => {
    const created = await createWorkerRuntime()
    runtime = created.runtime
    const db = created.db
    const username = 'concurrency.admin'
    const usernameHash = await hashAdminUsername(username)
    const record = await createPasswordRecord('Synthetic concurrency password 123!')
    const now = new Date()
    const attemptedAt = now.toISOString()
    const adminUserId = '10000000-0000-4000-8000-000000000099'
    await db.prepare(
      `INSERT INTO admin_users (
        singleton_id, admin_user_id, username, username_normalized,
        password_algorithm, password_iterations, password_salt_base64,
        password_hash_base64, password_version, auth_policy_version,
        is_active, created_at, password_updated_at
      ) VALUES (1, ?, ?, ?, ?, ?, ?, ?, 1, 'admin-auth-1.0.0', 1, ?, ?)`,
    ).bind(
      adminUserId,
      'Concurrency.Admin',
      username,
      record.passwordAlgorithm,
      record.passwordIterations,
      record.passwordSaltBase64,
      record.passwordHashBase64,
      attemptedAt,
      attemptedAt,
    ).run()
    const existingSessionId = '20000000-0000-4000-8000-000000000099'
    await db.prepare(
      `INSERT INTO admin_sessions (
        admin_session_id, admin_user_id, session_token_hash, csrf_token_hash,
        password_version, auth_policy_version, client_fingerprint_hash,
        user_agent_hash, created_at, last_seen_at, idle_expires_at,
        absolute_expires_at
      ) VALUES (?, ?, ?, ?, 1, 'admin-auth-1.0.0', ?, ?, ?, ?, ?, ?)`,
    ).bind(
      existingSessionId,
      adminUserId,
      'f'.repeat(64),
      '1'.repeat(64),
      '2'.repeat(64),
      '3'.repeat(64),
      attemptedAt,
      attemptedAt,
      new Date(now.getTime() + 1_800_000).toISOString(),
      new Date(now.getTime() + 28_800_000).toISOString(),
    ).run()
    await db.batch(Array.from({ length: 5 }, () => db.prepare(
      `INSERT INTO admin_login_attempts (
        attempt_id, username_hash, client_fingerprint_hash,
        outcome, request_id, attempted_at
      ) VALUES (?, ?, ?, 'failure', ?, ?)`,
    ).bind(
      crypto.randomUUID(), usernameHash, 'd'.repeat(64),
      crypto.randomUUID(), attemptedAt,
    )))

    const result = await replaceActiveAdminSession(db, {
      adminSessionId: crypto.randomUUID(),
      adminUserId,
      sessionTokenHash: 'b'.repeat(64),
      csrfTokenHash: 'c'.repeat(64),
      passwordVersion: 1,
      authPolicyVersion: 'admin-auth-1.0.0',
      clientFingerprintHash: 'd'.repeat(64),
      userAgentHash: 'e'.repeat(64),
      createdAt: attemptedAt,
      idleExpiresAt: new Date(now.getTime() + 1_800_000).toISOString(),
      absoluteExpiresAt: new Date(now.getTime() + 28_800_000).toISOString(),
      requestId: crypto.randomUUID(),
      loginAttemptId: crypto.randomUUID(),
      usernameHash,
      ratePolicy: {
        rateLimitWindowSec: 900,
        rateLimitMaxFailures: 5,
        globalRateLimitWindowSec: 3600,
        globalRateLimitMaxFailures: 30,
      },
    })

    expect(result).toEqual({ admitted: false, revokedSessionCount: 0 })
    const sessions = await db.prepare(
      'SELECT COUNT(*) AS count FROM admin_sessions',
    ).first<{ count: number }>()
    const successes = await db.prepare(
      `SELECT COUNT(*) AS count FROM admin_login_attempts WHERE outcome = 'success'`,
    ).first<{ count: number }>()
    const existingSession = await db.prepare(
      `SELECT revoked_at, revoke_reason FROM admin_sessions
       WHERE admin_session_id = ?`,
    ).bind(existingSessionId).first<{ revoked_at: string | null; revoke_reason: string | null }>()
    expect(sessions?.count).toBe(1)
    expect(existingSession).toEqual({ revoked_at: null, revoke_reason: null })
    expect(successes?.count).toBe(0)
  })
})
