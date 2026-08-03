import { afterEach, describe, expect, it } from 'vitest'
import type { Miniflare } from 'miniflare'
import { insertAdminAudit } from '../worker/services/adminAudit'
import { createWorkerRuntime } from './runtime'

let runtime: Miniflare | undefined

afterEach(async () => {
  await runtime?.dispose()
  runtime = undefined
})

const createdAt = '2026-08-02T00:00:00.000Z'
const saltBase64 = 'AAAAAAAAAAAAAAAAAAAAAA=='
const hashBase64 = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA='

async function insertAdmin(db: D1Database, suffix = '1') {
  await db.prepare(
    `INSERT INTO admin_users (
      singleton_id, admin_user_id, username, username_normalized,
      password_algorithm, password_iterations, password_salt_base64,
      password_hash_base64, password_version, auth_policy_version,
      is_active, created_at, password_updated_at
    ) VALUES (1, ?, ?, ?, 'PBKDF2-SHA256', 600000, ?, ?, 1,
      'admin-auth-1.0.0', 1, ?, ?)`,
  ).bind(
    `10000000-0000-4000-8000-00000000000${suffix}`,
    `Admin${suffix}`,
    `admin${suffix}`,
    saltBase64,
    hashBase64,
    createdAt,
    createdAt,
  ).run()
}

describe('0011 administrator authentication and audit migration', () => {
  it('keeps the security schema and policy intact under schema version 10 without a default administrator', async () => {
    const created = await createWorkerRuntime()
    runtime = created.runtime

    const tables = await created.db.prepare(
      `SELECT name FROM sqlite_master
       WHERE type = 'table' AND name LIKE 'admin_%'
       ORDER BY name`,
    ).all<{ name: string }>()
    const metadata = await created.db.prepare(
      "SELECT value FROM app_metadata WHERE key = 'schema_version'",
    ).first<{ value: string }>()
    const policy = await created.db.prepare(
      `SELECT * FROM admin_auth_policies
       WHERE auth_policy_version = 'admin-auth-1.0.0'`,
    ).first<Record<string, unknown>>()
    const adminCount = await created.db.prepare(
      'SELECT COUNT(*) AS count FROM admin_users',
    ).first<{ count: number }>()

    expect(tables.results.map((row) => row.name)).toEqual([
      'admin_audit_logs',
      'admin_auth_policies',
      'admin_login_attempts',
      'admin_operation_receipts',
      'admin_sessions',
      'admin_users',
    ])
    expect(metadata?.value).toBe('10')
    expect(policy).toMatchObject({
      auth_policy_version: 'admin-auth-1.0.0',
      password_algorithm: 'PBKDF2',
      pbkdf2_hash: 'SHA-256',
      pbkdf2_iterations: 600000,
      salt_bytes: 16,
      derived_key_bytes: 32,
      session_absolute_sec: 28800,
      session_idle_sec: 1800,
      session_touch_interval_sec: 300,
      rate_limit_window_sec: 900,
      rate_limit_max_failures: 5,
      global_rate_limit_window_sec: 3600,
      global_rate_limit_max_failures: 30,
      status: 'published',
    })
    expect(adminCount?.count).toBe(0)
  })

  it('enforces one administrator, UUID/Base64/password constraints, and has no plaintext password column', async () => {
    const created = await createWorkerRuntime()
    runtime = created.runtime
    const columns = await created.db.prepare(
      'PRAGMA table_info(admin_users)',
    ).all<{ name: string }>()

    expect(columns.results.map((row) => row.name)).not.toEqual(
      expect.arrayContaining(['password', 'plaintext_password', 'password_hint']),
    )
    await insertAdmin(created.db)
    await expect(insertAdmin(created.db, '2')).rejects.toThrow()
    await expect(
      created.db.prepare(
        `UPDATE admin_users SET password_salt_base64 = 'not-base64'
         WHERE singleton_id = 1`,
      ).run(),
    ).rejects.toThrow()
  })

  it('enforces unique hashed tokens, foreign keys, protected session identity, and immutable audit rows', async () => {
    const created = await createWorkerRuntime()
    runtime = created.runtime
    await insertAdmin(created.db)

    const insertSession = (id: string, token: string) => created.db.prepare(
      `INSERT INTO admin_sessions (
        admin_session_id, admin_user_id, session_token_hash, csrf_token_hash,
        password_version, auth_policy_version, client_fingerprint_hash,
        user_agent_hash, created_at, last_seen_at, idle_expires_at,
        absolute_expires_at
      ) VALUES (?, ?, ?, ?, 1, 'admin-auth-1.0.0', ?, ?, ?, ?, ?, ?)`,
    ).bind(
      id,
      '10000000-0000-4000-8000-000000000001',
      token,
      'b'.repeat(64),
      'c'.repeat(64),
      'd'.repeat(64),
      createdAt,
      createdAt,
      '2026-08-02T00:30:00.000Z',
      '2026-08-02T08:00:00.000Z',
    ).run()

    await insertSession('20000000-0000-4000-8000-000000000001', 'a'.repeat(64))
    await expect(
      insertSession('20000000-0000-4000-8000-000000000002', 'a'.repeat(64)),
    ).rejects.toThrow()
    await expect(
      created.db.prepare(
        `UPDATE admin_sessions SET session_token_hash = ?
         WHERE admin_session_id = ?`,
      ).bind('e'.repeat(64), '20000000-0000-4000-8000-000000000001').run(),
    ).rejects.toThrow()
    await expect(
      created.db.prepare(
        `INSERT INTO admin_sessions (
          admin_session_id, admin_user_id, session_token_hash, csrf_token_hash,
          password_version, auth_policy_version, created_at, last_seen_at,
          idle_expires_at, absolute_expires_at
        ) VALUES (?, ?, ?, ?, 1, 'admin-auth-1.0.0', ?, ?, ?, ?)`,
      ).bind(
        '20000000-0000-4000-8000-000000000003',
        '99999999-9999-4999-8999-999999999999',
        'f'.repeat(64),
        '0'.repeat(64),
        createdAt,
        createdAt,
        '2026-08-02T00:30:00.000Z',
        '2026-08-02T08:00:00.000Z',
      ).run(),
    ).rejects.toThrow()

    await created.db.prepare(
      `INSERT INTO admin_audit_logs (
        audit_id, admin_user_id, admin_session_id, action, outcome,
        target_type, target_id, request_id, client_fingerprint_hash,
        metadata_json, created_at
      ) VALUES (?, ?, ?, 'admin_login_success', 'success', NULL, NULL, ?, ?, json('{}'), ?)`,
    ).bind(
      '30000000-0000-4000-8000-000000000001',
      '10000000-0000-4000-8000-000000000001',
      '20000000-0000-4000-8000-000000000001',
      '40000000-0000-4000-8000-000000000001',
      'c'.repeat(64),
      createdAt,
    ).run()
    await expect(
      created.db.prepare(
        'UPDATE admin_audit_logs SET outcome = ? WHERE audit_id = ?',
      ).bind('failure', '30000000-0000-4000-8000-000000000001').run(),
    ).rejects.toThrow()
    await expect(
      created.db.prepare('DELETE FROM admin_audit_logs WHERE audit_id = ?')
        .bind('30000000-0000-4000-8000-000000000001').run(),
    ).rejects.toThrow()
    await expect(insertAdminAudit(created.db, {
      auditId: '30000000-0000-4000-8000-000000000001',
      adminUserId: '10000000-0000-4000-8000-000000000001',
      adminSessionId: '20000000-0000-4000-8000-000000000001',
      action: 'admin_login_success',
      outcome: 'success',
      requestId: '40000000-0000-4000-8000-000000000002',
      clientFingerprintHash: 'c'.repeat(64),
      createdAt,
    })).rejects.toThrow()
  })

  it('keeps Stage 1-8 configuration and scoring rows intact after applying 0011', async () => {
    const created = await createWorkerRuntime()
    runtime = created.runtime
    const config = await created.db.prepare(
      `SELECT config_set_id, scoring_version, benchmark_version
       FROM configuration_sets WHERE is_active = 1`,
    ).first<Record<string, string>>()
    const scoring = await created.db.prepare(
      `SELECT scoring_version, total_rdi_enabled, level_enabled
       FROM scoring_definitions WHERE scoring_version = 'RDI-2.0-prepilot'`,
    ).first<Record<string, string | number>>()

    expect(config).toMatchObject({
      config_set_id: 'config-2026-07-v1',
      scoring_version: 'RDI-2.0-prepilot',
      benchmark_version: 'benchmark-1.0.0',
    })
    expect(scoring).toMatchObject({
      scoring_version: 'RDI-2.0-prepilot',
      total_rdi_enabled: 0,
      level_enabled: 0,
    })
  })
})
