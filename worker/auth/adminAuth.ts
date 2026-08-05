import type { Env } from '../env'
import { adminTerminalAuditStatement } from '../services/adminAudit'
import {
  hashAdminToken,
  isAdminToken,
  readCookie,
} from '../security/adminCookies'

export class AdminAuthError extends Error {
  constructor(
    readonly code:
      | 'ADMIN_UNAUTHORIZED'
      | 'ADMIN_SESSION_REVOKED'
      | 'ADMIN_SESSION_EXPIRED'
      | 'ADMIN_PUBLIC_MODE_NOT_READY'
      | 'ADMIN_AUTH_MODE_INVALID',
    message: string,
    readonly status: 401 | 500 | 503 = 401,
  ) {
    super(message)
    this.name = 'AdminAuthError'
  }

}

type AdminAuthRow = {
  admin_session_id: string
  admin_user_id: string
  session_token_hash: string
  csrf_token_hash: string
  session_password_version: number
  auth_policy_version: string
  client_fingerprint_hash: string | null
  created_at: string
  last_seen_at: string
  idle_expires_at: string
  absolute_expires_at: string
  revoked_at: string | null
  revoke_reason: string | null
  username: string
  user_password_version: number
  is_active: number
  session_idle_sec: number
  session_touch_interval_sec: number
}

export type PasswordAdminContext = {
  authMode: 'password'
  adminUserId: string
  username: string
  passwordVersion: number
  authPolicyVersion: string
  adminSessionId: string
  sessionTokenHash: string
  csrfTokenHash: string
  clientFingerprintHash: string | null
  createdAt: string
  lastSeenAt: string
  idleExpiresAt: string
  absoluteExpiresAt: string
  sessionIdleSec: number
  sessionTouchIntervalSec: number
}

export type PublicAdminContext = {
  authMode: 'public'
  adminUserId: string
  username: 'public-admin'
  adminSessionId: null
  clientFingerprintHash: null
}

export type AdminContext = PasswordAdminContext | PublicAdminContext

export type AdminAuthMode = 'password' | 'public'

export function adminAuthMode(env: Env): AdminAuthMode {
  const value = env.ADMIN_AUTH_MODE ?? 'password'
  if (value === 'password' || value === 'public') return value
  throw new AdminAuthError(
    'ADMIN_AUTH_MODE_INVALID',
    'Administrator authentication is temporarily unavailable.',
    500,
  )
}

function unauthorized(): AdminAuthError {
  return new AdminAuthError(
    'ADMIN_UNAUTHORIZED',
    'Administrator authentication is required.',
  )
}

async function expireSession(
  env: Env,
  row: AdminAuthRow,
  now: string,
  requestId: string,
  reason: 'idle_expired' | 'absolute_expired',
): Promise<never> {
  const action = reason === 'idle_expired'
    ? 'admin_session_idle_expired' as const
    : 'admin_session_absolute_expired' as const
  await env.DB.batch([
    env.DB.prepare(
      `UPDATE admin_sessions
       SET revoked_at = ?, revoke_reason = ?
       WHERE admin_session_id = ? AND revoked_at IS NULL`,
    ).bind(now, reason, row.admin_session_id),
    adminTerminalAuditStatement(env.DB, {
      adminUserId: row.admin_user_id,
      adminSessionId: row.admin_session_id,
      action,
      outcome: 'failure',
      targetType: 'admin_session',
      targetId: row.admin_session_id,
      requestId,
      clientFingerprintHash: row.client_fingerprint_hash,
      metadata: { reason, authPolicyVersion: row.auth_policy_version },
      createdAt: now,
    }, { revokedAt: now, revokeReason: reason }),
  ])
  throw new AdminAuthError(
    'ADMIN_SESSION_EXPIRED',
    'The administrator session has expired.',
  )
}

export async function authenticateAdmin(
  request: Request,
  env: Env,
  options: { now?: Date; requestId?: string } = {},
): Promise<AdminContext> {
  if (adminAuthMode(env) === 'public') {
    const singleton = await env.DB.prepare(
      `SELECT admin_user_id FROM admin_users
       WHERE singleton_id = 1 AND is_active = 1`,
    ).first<{ admin_user_id: string }>()
    if (!singleton) {
      throw new AdminAuthError(
        'ADMIN_PUBLIC_MODE_NOT_READY',
        'Public administrator mode is not ready.',
        503,
      )
    }
    return {
      authMode: 'public',
      adminUserId: singleton.admin_user_id,
      username: 'public-admin',
      adminSessionId: null,
      clientFingerprintHash: null,
    }
  }
  const rawToken = readCookie(request, 'mg_admin')
  if (!rawToken || !isAdminToken(rawToken)) throw unauthorized()
  const tokenHash = await hashAdminToken(rawToken)
  const row = await env.DB.prepare(
    `SELECT s.admin_session_id, s.admin_user_id, s.session_token_hash,
            s.csrf_token_hash, s.password_version AS session_password_version,
            s.auth_policy_version, s.client_fingerprint_hash, s.created_at,
            s.last_seen_at, s.idle_expires_at, s.absolute_expires_at,
            s.revoked_at, s.revoke_reason, u.username,
            u.password_version AS user_password_version, u.is_active,
            p.session_idle_sec, p.session_touch_interval_sec
     FROM admin_sessions s
     JOIN admin_users u ON u.admin_user_id = s.admin_user_id
     JOIN admin_auth_policies p
       ON p.auth_policy_version = s.auth_policy_version
     WHERE s.session_token_hash = ?`,
  ).bind(tokenHash).first<AdminAuthRow>()
  if (!row || row.session_token_hash !== tokenHash) throw unauthorized()
  if (row.revoked_at !== null) {
    throw new AdminAuthError(
      'ADMIN_SESSION_REVOKED',
      'The administrator session is no longer active.',
    )
  }
  if (
    row.is_active !== 1
    || row.session_password_version !== row.user_password_version
  ) throw unauthorized()

  const nowDate = options.now ?? new Date()
  const now = nowDate.toISOString()
  const requestId = options.requestId ?? crypto.randomUUID()
  if (nowDate.getTime() >= Date.parse(row.absolute_expires_at)) {
    return expireSession(env, row, now, requestId, 'absolute_expired')
  }
  if (nowDate.getTime() >= Date.parse(row.idle_expires_at)) {
    return expireSession(env, row, now, requestId, 'idle_expired')
  }

  let lastSeenAt = row.last_seen_at
  let idleExpiresAt = row.idle_expires_at
  if (
    nowDate.getTime() - Date.parse(row.last_seen_at)
    >= row.session_touch_interval_sec * 1000
  ) {
    const idleCandidate = nowDate.getTime() + row.session_idle_sec * 1000
    idleExpiresAt = new Date(
      Math.min(idleCandidate, Date.parse(row.absolute_expires_at)),
    ).toISOString()
    await env.DB.prepare(
      `UPDATE admin_sessions
       SET last_seen_at = ?, idle_expires_at = ?
       WHERE admin_session_id = ? AND revoked_at IS NULL`,
    ).bind(now, idleExpiresAt, row.admin_session_id).run()
    lastSeenAt = now
  }

  return {
    authMode: 'password',
    adminUserId: row.admin_user_id,
    username: row.username,
    passwordVersion: row.user_password_version,
    authPolicyVersion: row.auth_policy_version,
    adminSessionId: row.admin_session_id,
    sessionTokenHash: row.session_token_hash,
    csrfTokenHash: row.csrf_token_hash,
    clientFingerprintHash: row.client_fingerprint_hash,
    createdAt: row.created_at,
    lastSeenAt,
    idleExpiresAt,
    absoluteExpiresAt: row.absolute_expires_at,
    sessionIdleSec: row.session_idle_sec,
    sessionTouchIntervalSec: row.session_touch_interval_sec,
  }
}
